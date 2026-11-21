import { describe, expect, it } from 'vitest';

import { cuesOf, formatTimestamp, toJson, toSrt, toWebVtt } from './formats.ts';
import type { Transcript, TranscriptWord } from './transcript.ts';

function words(text: string, start = 0, step = 0.3): TranscriptWord[] {
    return text.split(' ').map((word, index) => ({
        start: start + index * step,
        end: start + (index + 1) * step,
        text: word,
    }));
}

const transcript: Transcript = {
    language: 'fr',
    segments: [
        { start: 0, end: 1.2, text: ' Salut tout le monde.', words: words('Salut tout le monde.') },
        { start: 1.5, end: 3, text: 'Sans mots <ici> & là', words: [] },
    ],
};

describe('formatTimestamp', () => {
    it('writes hours, minutes, seconds and milliseconds', () => {
        expect(formatTimestamp(3725.0456, '.')).toBe('01:02:05.046');
        expect(formatTimestamp(0.9999, ',')).toBe('00:00:01,000');
        expect(formatTimestamp(-1, ',')).toBe('00:00:00,000');
    });
});

describe('cuesOf', () => {
    it('keeps a short segment in one cue, and segments without words as they are', () => {
        expect(cuesOf(transcript)).toEqual([
            { start: 0, end: 1.2, lines: ['Salut tout le monde.'] },
            { start: 1.5, end: 3, lines: ['Sans mots <ici> & là'] },
        ]);
    });

    it('splits a long segment into cues of two lines of 42 characters', () => {
        const text =
            'Alors aujourd’hui on va parler de quelque chose de vraiment important pour tous les créateurs qui commencent sur les plateformes';
        const cues = cuesOf({
            language: 'fr',
            segments: [{ start: 0, end: 6, text, words: words(text, 0, 0.1) }],
        });
        expect(cues.length).toBeGreaterThan(1);
        for (const cue of cues) {
            expect(cue.lines.length).toBeLessThanOrEqual(2);
            for (const line of cue.lines) {
                expect(line.length).toBeLessThanOrEqual(42);
            }
        }
        expect(cues.flatMap((cue) => cue.lines).join(' ')).toBe(text);
    });

    it('breaks after the end of a sentence and after 7 seconds', () => {
        const cues = cuesOf({
            language: 'fr',
            segments: [
                {
                    start: 0,
                    end: 12,
                    text: 'Oui. Non',
                    words: [
                        { start: 0, end: 0.5, text: 'Bon,' },
                        { start: 0.5, end: 1, text: 'oui.' },
                        { start: 1, end: 2, text: 'Non' },
                        { start: 9, end: 10, text: 'peut-être' },
                    ],
                },
            ],
        });
        expect(cues.map((cue) => cue.lines.join(' '))).toEqual(['Bon, oui.', 'Non', 'peut-être']);
    });

    it('never lets a cue end after the next one starts', () => {
        const cues = cuesOf({
            language: 'fr',
            segments: [
                { start: 0, end: 2.5, text: 'Un', words: [] },
                { start: 2, end: 3, text: 'Deux', words: [] },
            ],
        });
        expect(cues[0]?.end).toBe(2);
    });
});

describe('toWebVtt', () => {
    it('writes a WebVTT file with escaped text and the language', () => {
        expect(toWebVtt(transcript)).toBe(
            'WEBVTT\nLanguage: fr\n\n' +
                '00:00:00.000 --> 00:00:01.200\nSalut tout le monde.\n\n' +
                '00:00:01.500 --> 00:00:03.000\nSans mots &lt;ici&gt; &amp; là\n',
        );
    });

    it('writes only the header for an empty transcript', () => {
        expect(toWebVtt({ language: undefined, segments: [] })).toBe('WEBVTT\n');
    });
});

describe('toSrt', () => {
    it('writes numbered cues', () => {
        expect(toSrt(transcript)).toBe(
            '1\n00:00:00,000 --> 00:00:01,200\nSalut tout le monde.\n\n' +
                '2\n00:00:01,500 --> 00:00:03,000\nSans mots <ici> & là\n',
        );
    });
});

describe('toJson', () => {
    it('writes the transcript, its text and its words', () => {
        const json = JSON.parse(
            toJson(
                {
                    language: 'fr',
                    segments: [
                        {
                            start: 0.12345,
                            end: 1,
                            text: ' Salut.',
                            words: [
                                { start: 0.12345, end: 1, text: 'Salut.', probability: 0.87654 },
                            ],
                        },
                    ],
                },
                { duration: 2.0004, provider: 'local-whisper', model: 'small', words: true },
            ),
        ) as unknown;
        expect(json).toEqual({
            version: 1,
            language: 'fr',
            duration: 2,
            provider: 'local-whisper',
            model: 'small',
            text: 'Salut.',
            segments: [
                {
                    start: 0.123,
                    end: 1,
                    text: 'Salut.',
                    words: [{ start: 0.123, end: 1, text: 'Salut.', probability: 0.877 }],
                },
            ],
        });
    });

    it('leaves the words out when asked', () => {
        const json = JSON.parse(
            toJson(transcript, {
                duration: 3,
                provider: 'local-whisper',
                model: undefined,
                words: false,
            }),
        ) as { segments: object[]; model: unknown };
        expect(json.model).toBeNull();
        expect(json.segments[0]).not.toHaveProperty('words');
    });
});
