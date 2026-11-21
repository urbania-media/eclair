import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OperationProviders } from '@eclair-js/operation';
import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { fakeModels, runOn } from './test-helpers.ts';
import { transcribe } from './transcribe.ts';

const FFMPEG = ['ffprobe', 'ffmpeg'];

describe.skipIf(skipWithoutBinaries(FFMPEG))('ai.transcribe, with a fake whisper.cpp', () => {
    let models: string;
    let providers: OperationProviders;

    beforeAll(async () => {
        models = await fakeModels('ggml-small.bin', 'ggml-silero-v6.2.0.bin');
        providers = {
            transcription: {
                name: 'local-whisper',
                settings: { modelsDir: models, defaultModel: 'small', threads: 2 },
            },
        };
    });

    afterAll(async () => {
        await rm(models, { recursive: true, force: true });
    });

    it('has its binaries', () => {
        expect(missingBinaries(FFMPEG)).toEqual([]);
    });

    it('writes JSON, WebVTT and SRT, and reports the media seconds', async () => {
        const result = await runOn(transcribe, 'audio.m4a', {}, { providers });
        try {
            expect(result.files).toEqual([
                expect.objectContaining({
                    name: 'transcript.json',
                    mime: 'application/json',
                    role: 'main',
                }),
                expect.objectContaining({
                    name: 'transcript.vtt',
                    mime: 'text/vtt',
                    role: 'subtitles',
                }),
                expect.objectContaining({
                    name: 'transcript.srt',
                    mime: 'application/x-subrip',
                    role: 'subtitles',
                }),
            ]);
            expect(result.metadata).toEqual({
                provider: 'local-whisper',
                model: 'small',
                language: 'fr',
                duration: expect.closeTo(2, 1),
                speech: true,
                segments: 2,
                words: 13,
                usage: { mediaSeconds: expect.closeTo(2, 1) },
            });
            expect(result.usage?.mediaSeconds).toBeCloseTo(2, 1);
            expect(result.progress.at(-1)).toBe(0.95);

            const json = JSON.parse(await readFile(result.files[0]?.path ?? '', 'utf8')) as {
                text: string;
                segments: { words: unknown[] }[];
            };
            expect(json.text).toBe(
                'Salut tout le monde, c\'est Émilie. On parle de "pitching" <aujourd\'hui> & demain!',
            );
            expect(json.segments[0]?.words).toHaveLength(6);
            const vtt = await readFile(result.files[1]?.path ?? '', 'utf8');
            expect(vtt).toContain(
                "00:00:00.000 --> 00:00:02.400\nSalut tout le monde, c'est Émilie.",
            );
            expect(vtt).toContain('&lt;aujourd');
            const srt = await readFile(result.files[2]?.path ?? '', 'utf8');
            expect(srt.startsWith('1\n00:00:00,000 --> 00:00:02,400\n')).toBe(true);

            // whisper.cpp read 16 kHz mono PCM, with the model, the language, the VAD and the prompt.
            const args = JSON.parse(
                await readFile(join(result.workdir, 'whisper.args.json'), 'utf8'),
            ) as string[];
            expect(args).toEqual(
                expect.arrayContaining([
                    '--language',
                    'auto',
                    '--threads',
                    '2',
                    '--output-json-full',
                    '--vad',
                ]),
            );
            expect(args[args.indexOf('--model') + 1]).toBe(join(models, 'ggml-small.bin'));
        } finally {
            await result.cleanup();
        }
    });

    it('reads the soundtrack of a video, with the language, the model and the prompt given', async () => {
        const result = await runOn(
            transcribe,
            'video.mp4',
            { language: 'fr', model: 'small', formats: ['vtt'], prompt: 'Émilie, TikTok.' },
            { providers },
        );
        try {
            expect(result.files.map((file) => [file.name, file.role])).toEqual([
                ['transcript.vtt', 'main'],
            ]);
            const args = JSON.parse(
                await readFile(join(result.workdir, 'whisper.args.json'), 'utf8'),
            ) as string[];
            expect(args).toEqual(
                expect.arrayContaining(['--language', 'fr', '--prompt', 'Émilie, TikTok.']),
            );
        } finally {
            await result.cleanup();
        }
    });

    it('runs without VAD when its model is missing', async () => {
        const directory = await fakeModels('ggml-small.bin');
        const result = await runOn(
            transcribe,
            'audio.m4a',
            {},
            {
                providers: {
                    transcription: {
                        name: 'local-whisper',
                        settings: { modelsDir: directory, defaultModel: 'small' },
                    },
                },
            },
        );
        try {
            const args = JSON.parse(
                await readFile(join(result.workdir, 'whisper.args.json'), 'utf8'),
            ) as string[];
            expect(args).not.toContain('--vad');
        } finally {
            await result.cleanup();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('writes an empty transcript for silence, without running the model', async () => {
        const result = await runOn(transcribe, 'silence.m4a', { model: 'missing' }, { providers });
        try {
            expect(result.metadata).toMatchObject({
                speech: false,
                segments: 0,
                words: 0,
                language: null,
            });
            expect(await readFile(result.files[1]?.path ?? '', 'utf8')).toBe('WEBVTT\n');
            expect(result.usage?.mediaSeconds).toBeCloseTo(3, 1);
        } finally {
            await result.cleanup();
        }
    });

    it('fails on a video without audio', async () => {
        await expect(
            runOn(transcribe, 'silent-portrait.mp4', {}, { providers }),
        ).rejects.toMatchObject({
            code: 'unsupported_input',
        });
    });

    it('fails on a model that is not installed', async () => {
        await expect(
            runOn(transcribe, 'audio.m4a', { model: 'large-v3' }, { providers }),
        ).rejects.toMatchObject({
            code: 'provider_failed',
            message: 'The model "large-v3" isn\'t installed on this worker.',
        });
    });

    it('fails on audio longer than the provider transcribes', async () => {
        await expect(
            runOn(
                transcribe,
                'audio.m4a',
                {},
                {
                    providers: {
                        transcription: {
                            name: 'local-whisper',
                            settings: { modelsDir: models, maxDuration: 1 },
                        },
                    },
                },
            ),
        ).rejects.toMatchObject({ code: 'limit_exceeded' });
    });

    it('fails with Amazon Transcribe when the project has no credentials for it', async () => {
        await expect(
            runOn(
                transcribe,
                'audio.m4a',
                {},
                {
                    providers: { transcription: { name: 'amazon-transcribe', settings: {} } },
                },
            ),
        ).rejects.toMatchObject({
            code: 'provider_failed',
            message: 'The project has no credentials, region and bucket for Amazon Transcribe.',
        });
    });

    it('fails on a provider that does not exist', async () => {
        await expect(
            runOn(
                transcribe,
                'audio.m4a',
                {},
                { providers: { transcription: { name: 'nope', settings: {} } } },
            ),
        ).rejects.toMatchObject({ code: 'provider_failed' });
    });
});

/**
 * With the real whisper.cpp and a model: set `ECLAIR_TEST_WHISPER_MODELS` to a directory with
 * `ggml-<model>.bin` (`ECLAIR_TEST_WHISPER_MODEL`, `base` by default). Never downloads anything.
 */
const realModels = process.env['ECLAIR_TEST_WHISPER_MODELS'];

describe.skipIf(realModels === undefined || skipWithoutBinaries([...FFMPEG, 'whisper-cli']))(
    'ai.transcribe, with whisper.cpp',
    () => {
        it('transcribes speech and detects its language', async () => {
            const result = await runOn(
                transcribe,
                'speech-en.mp3',
                {},
                {
                    whisper: 'whisper-cli',
                    providers: {
                        transcription: {
                            name: 'local-whisper',
                            settings: {
                                modelsDir: realModels ?? '',
                                defaultModel: process.env['ECLAIR_TEST_WHISPER_MODEL'] ?? 'base',
                            },
                        },
                    },
                },
            );
            try {
                expect(result.metadata).toMatchObject({ language: 'en', speech: true });
                const json = JSON.parse(await readFile(result.files[0]?.path ?? '', 'utf8')) as {
                    text: string;
                };
                expect(json.text.toLowerCase()).toContain(
                    'ask not what your country can do for you',
                );
            } finally {
                await result.cleanup();
            }
        });
    },
);
