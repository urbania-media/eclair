import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LOCAL_WHISPER_DEFAULTS, localWhisperSettings, parseWhisperJson } from './local-whisper.ts';
import { fixture } from './test-helpers.ts';

describe('parseWhisperJson', () => {
    const transcript = parseWhisperJson(readFileSync(fixture('whisper-full.json'), 'utf8'));

    it('reads the detected language and the segments, in seconds', () => {
        expect(transcript.language).toBe('fr');
        expect(transcript.segments.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
            { start: 0, end: 2.4, text: "Salut tout le monde, c'est Émilie." },
            { start: 2.4, end: 4, text: 'On parle de "pitching" <aujourd\'hui> & demain!' },
        ]);
    });

    it('merges tokens into words, with punctuation, without special tokens', () => {
        expect(transcript.segments[0]?.words.map((word) => word.text)).toEqual([
            'Salut',
            'tout',
            'le',
            'monde,',
            "c'est",
            'Émilie.',
        ]);
        expect(transcript.segments[0]?.words[5]).toEqual({
            start: 1.65,
            end: 2.4,
            text: 'Émilie.',
            probability: expect.closeTo(0.733, 3),
        });
    });

    it('reads control characters that whisper.cpp leaves unescaped', () => {
        const raw =
            '{"result":{"language":"en"},"transcription":[{"offsets":{"from":0,"to":1000},"text":" a\tb","tokens":[]}]}';
        expect(parseWhisperJson(raw).segments[0]?.text).toBe('a\tb');
    });

    it('skips empty segments', () => {
        const raw =
            '{"result":{"language":"fr"},"transcription":[{"offsets":{"from":0,"to":1000},"text":"  "}]}';
        expect(parseWhisperJson(raw).segments).toEqual([]);
    });
});

describe('localWhisperSettings', () => {
    it('reads the settings over the defaults, and ignores invalid ones', () => {
        expect(localWhisperSettings({})).toEqual(LOCAL_WHISPER_DEFAULTS);
        expect(
            localWhisperSettings({
                modelsDir: '/models',
                threads: 4.5,
                maxDuration: -1,
                vadModel: null,
            }),
        ).toEqual({
            ...LOCAL_WHISPER_DEFAULTS,
            modelsDir: '/models',
            threads: 4,
            vadModel: undefined,
        });
    });
});
