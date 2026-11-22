/** A word, with its timings in seconds from the start of the media. */
export interface TranscriptWord {
    start: number;
    end: number;
    /** The word as written, with its punctuation, without the space before it. */
    text: string;
    /** How sure the model is of the word, from 0 to 1, when the provider says. */
    probability?: number;
}

/** A segment: a sentence or a part of one, as the provider splits the speech. */
export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
    /** Empty when the provider gives no word timings. */
    words: TranscriptWord[];
    /** The speaker's label, when the provider tells speakers apart. */
    speaker?: string;
}

/** What a transcription provider returns, whatever the provider. */
export interface Transcript {
    /** ISO 639 code of the language (`fr`, `yue`), the given one or the one the provider detected. */
    language: string | undefined;
    segments: TranscriptSegment[];
}

/** Rounds seconds to the millisecond, for the JSON output. */
export function roundTime(seconds: number): number {
    return Math.round(seconds * 1000) / 1000;
}

/** Languages written without spaces between words. */
const WITHOUT_SPACES = new Set(['ja', 'zh', 'yue', 'th', 'lo', 'km', 'my', 'bo']);

/**
 * The whole text of a transcript: its segments joined by spaces, or without them in the languages
 * written without spaces (`ja`, `zh`, `th`…).
 */
export function transcriptText(transcript: Transcript): string {
    return transcript.segments
        .map((segment) => segment.text.trim())
        .filter((text) => text !== '')
        .join(WITHOUT_SPACES.has(transcript.language ?? '') ? '' : ' ');
}
