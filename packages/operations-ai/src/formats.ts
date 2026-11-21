import type { Transcript, TranscriptWord } from './transcript.ts';
import { roundTime, transcriptText } from './transcript.ts';

/** A subtitle cue: up to two lines on screen between two times. */
export interface Cue {
    start: number;
    end: number;
    lines: string[];
}

export interface CueOptions {
    /** Characters on a line. 42 is the usual limit of broadcast subtitles. */
    lineLength: number;
    /** Lines in a cue. */
    lines: number;
    /** Seconds a cue stays on screen at most. */
    maxDuration: number;
}

const CUE_DEFAULTS: CueOptions = { lineLength: 42, lines: 2, maxDuration: 7 };

/** Words end a sentence when they end with one of these, so a cue breaks after them first. */
const SENTENCE_END = /[.!?…]["»”)]*$/;

/** Splits a text into lines of at most `length` characters, on spaces. */
function wrap(text: string, length: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter((part) => part !== '')) {
        if (line !== '' && line.length + 1 + word.length > length) {
            lines.push(line);
            line = word;
        } else {
            line = line === '' ? word : `${line} ${word}`;
        }
    }
    if (line !== '') {
        lines.push(line);
    }
    return lines;
}

/** Cues of a segment's words: a new cue when the text would overflow, after a sentence or a long cue. */
function cuesOfWords(words: TranscriptWord[], options: CueOptions): Cue[] {
    const cues: Cue[] = [];
    const capacity = options.lineLength * options.lines;
    let current: TranscriptWord[] = [];
    const flush = () => {
        const first = current[0];
        const last = current.at(-1);
        if (first !== undefined && last !== undefined) {
            const text = current.map((word) => word.text).join(' ');
            cues.push({ start: first.start, end: last.end, lines: wrap(text, options.lineLength) });
        }
        current = [];
    };
    for (const word of words) {
        const text = [...current, word].map((item) => item.text).join(' ');
        const first = current[0];
        if (
            first !== undefined &&
            (text.length > capacity ||
                wrap(text, options.lineLength).length > options.lines ||
                word.end - first.start > options.maxDuration)
        ) {
            flush();
        }
        current.push(word);
        if (SENTENCE_END.test(word.text) && current.length > 1) {
            flush();
        }
    }
    flush();
    return cues;
}

/**
 * The cues of a transcript, for WebVTT and SRT. Segments with word timings are split into cues of
 * two lines of 42 characters and 7 seconds at most; segments without them are one cue each.
 */
export function cuesOf(transcript: Transcript, options: Partial<CueOptions> = {}): Cue[] {
    const settings = { ...CUE_DEFAULTS, ...options };
    const cues: Cue[] = [];
    for (const segment of transcript.segments) {
        if (segment.text.trim() === '') {
            continue;
        }
        if (segment.words.length > 0) {
            cues.push(...cuesOfWords(segment.words, settings));
        } else {
            cues.push({
                start: segment.start,
                end: segment.end,
                lines: wrap(segment.text.trim(), settings.lineLength),
            });
        }
    }
    // A cue never ends after the next one starts.
    for (let index = 0; index < cues.length - 1; index++) {
        const cue = cues[index];
        const next = cues[index + 1];
        if (cue !== undefined && next !== undefined && cue.end > next.start) {
            cue.end = Math.max(cue.start, next.start);
        }
    }
    return cues;
}

/** `HH:MM:SS.mmm` for WebVTT, `HH:MM:SS,mmm` for SRT. */
export function formatTimestamp(seconds: number, separator: '.' | ','): string {
    const total = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const secs = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

/** Text of a cue, safe in WebVTT: `&`, `<` and `>` are escaped, and `-->` can't appear. */
function vttText(line: string): string {
    return line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function toWebVtt(transcript: Transcript): string {
    const blocks = cuesOf(transcript).map(
        (cue) =>
            `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n` +
            cue.lines.map(vttText).join('\n'),
    );
    const header =
        transcript.language === undefined ? 'WEBVTT' : `WEBVTT\nLanguage: ${transcript.language}`;
    return [header, ...blocks].join('\n\n') + '\n';
}

export function toSrt(transcript: Transcript): string {
    return cuesOf(transcript)
        .map(
            (cue, index) =>
                `${index + 1}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n` +
                // A blank line would end the cue.
                cue.lines.join('\n'),
        )
        .map((block) => `${block}\n`)
        .join('\n');
}

/** The JSON output: the transcript, with its text, times rounded to the millisecond. */
export function toJson(
    transcript: Transcript,
    details: { duration: number; provider: string; model: string | undefined; words: boolean },
): string {
    return (
        JSON.stringify(
            {
                version: 1,
                language: transcript.language ?? null,
                duration: roundTime(details.duration),
                provider: details.provider,
                model: details.model ?? null,
                text: transcriptText(transcript),
                segments: transcript.segments.map((segment) => ({
                    start: roundTime(segment.start),
                    end: roundTime(segment.end),
                    text: segment.text.trim(),
                    ...(segment.speaker === undefined ? {} : { speaker: segment.speaker }),
                    ...(details.words
                        ? {
                              words: segment.words.map((word) => ({
                                  start: roundTime(word.start),
                                  end: roundTime(word.end),
                                  text: word.text,
                                  ...(word.probability === undefined
                                      ? {}
                                      : {
                                            probability: Math.round(word.probability * 1000) / 1000,
                                        }),
                              })),
                          }
                        : {}),
                })),
            },
            null,
            2,
        ) + '\n'
    );
}
