import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OperationError, execBinary } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';
import { skipWithoutBinaries } from '@eclair-js/operation/testing';

import {
    amazonTranscribe,
    amazonTranscribeSettings,
    parseAmazonTranscript,
} from './amazon-transcribe.ts';
import type { AwsClients } from './amazon-transcribe.ts';
import type { TranscriptionRequest } from './provider.ts';
import { fixture } from './test-helpers.ts';

const CREDENTIALS = {
    accessKeyId: 'AKIAEXAMPLEEXAMPLE',
    secretAccessKey: 'secret',
    region: 'ca-central-1',
    bucket: 'media-transcribe',
    languages: 'fr-CA,en-US',
    pricePerMinute: '0.006',
    jobPrefix: 'media-',
};

describe('parseAmazonTranscript', () => {
    it('converts audio segments and words, with punctuation joined to the words', async () => {
        const transcript = parseAmazonTranscript(
            await readFile(fixture('amazon-transcript.json'), 'utf8'),
            undefined,
        );
        expect(transcript.language).toBe('fr');
        expect(transcript.segments.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
            { start: 0.04, end: 1.2, text: 'Salut tout le monde.' },
            { start: 2.4, end: 3.9, text: "On parle de pitching aujourd'hui." },
        ]);
        expect(transcript.segments[0]?.words.at(-1)).toEqual({
            start: 0.82,
            end: 1.2,
            text: 'monde.',
            probability: 0.99,
        });
    });

    it('makes sentences of the words without audio segments', () => {
        const raw = JSON.stringify({
            results: {
                items: [
                    {
                        type: 'pronunciation',
                        start_time: '0',
                        end_time: '1',
                        alternatives: [{ content: 'Oui', confidence: '1' }],
                    },
                    { type: 'punctuation', alternatives: [{ content: '.' }] },
                    {
                        type: 'pronunciation',
                        start_time: '1',
                        end_time: '2',
                        alternatives: [{ content: 'Non', confidence: '1' }],
                    },
                ],
            },
        });
        expect(parseAmazonTranscript(raw, 'en-US')).toEqual({
            language: 'en',
            segments: [
                {
                    start: 0,
                    end: 1,
                    text: 'Oui.',
                    words: [{ start: 0, end: 1, text: 'Oui.', probability: 1 }],
                },
                {
                    start: 1,
                    end: 2,
                    text: 'Non',
                    words: [{ start: 1, end: 2, text: 'Non', probability: 1 }],
                },
            ],
        });
    });
});

describe('amazonTranscribeSettings', () => {
    it('reads the credentials, and needs a region and a bucket', () => {
        expect(amazonTranscribeSettings(CREDENTIALS, { maxDuration: 99_999 })).toMatchObject({
            region: 'ca-central-1',
            bucket: 'media-transcribe',
            prefix: 'eclair-transcribe/',
            jobPrefix: 'media-',
            languages: ['fr-CA', 'en-US'],
            pricePerMinute: 0.006,
            maxDuration: 8 * 3600,
        });
        expect(() => amazonTranscribeSettings({ accessKeyId: 'a', secretAccessKey: 'b' })).toThrow(
            OperationError,
        );
    });
});

interface Sent {
    command: string;
    input: Record<string, unknown>;
}

/** Fake AWS clients: they record each command and answer with `answer`. */
function fakeClients(
    answer: (command: string, input: Record<string, unknown>) => unknown,
): AwsClients & { sent: Sent[] } {
    const sent: Sent[] = [];
    const send = (command: { constructor: { name: string }; input: unknown }) => {
        const entry = {
            command: command.constructor.name.replace(/Command$/, ''),
            input: command.input as Record<string, unknown>,
        };
        sent.push(entry);
        try {
            return Promise.resolve(answer(entry.command, entry.input));
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    };
    return { sent, transcribe: { send } as never, s3: { send } as never };
}

function awsError(name: string): Error {
    const error = new Error(name);
    error.name = name;
    return error;
}

describe.skipIf(skipWithoutBinaries(['ffmpeg']))('amazon-transcribe, with fake AWS clients', () => {
    let workdir: string;
    let controller: AbortController;
    let context: OperationContext;
    let request: TranscriptionRequest;
    const progress: number[] = [];
    const warnings: unknown[] = [];

    beforeEach(async () => {
        workdir = await mkdtemp(join(tmpdir(), 'eclair-amazon-'));
        controller = new AbortController();
        const audio = join(workdir, 'audio.wav');
        execFileSync('ffmpeg', [
            '-v',
            'error',
            '-i',
            fixture('audio.m4a'),
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'pcm_s16le',
            audio,
        ]);
        context = {
            input: {
                path: fixture('audio.m4a'),
                kind: 'audio',
                mime: 'audio/mp4',
                extension: 'm4a',
                size: 1,
                probe: undefined,
            },
            workdir,
            exec: (binary, args, options) =>
                execBinary(binary, args, { cwd: workdir, ...options, signal: controller.signal }),
            progress: (ratio) => progress.push(ratio),
            log: { debug: () => {}, info: () => {}, warn: (_message, data) => warnings.push(data) },
            signal: controller.signal,
            output: () => {},
            taskId: 'tsk_01TEST',
        };
        request = { audio, duration: 2, language: 'fr', model: undefined, prompt: undefined };
        progress.length = 0;
        warnings.length = 0;
    });

    afterEach(async () => {
        await rm(workdir, { recursive: true, force: true });
    });

    const settings = (extra: Record<string, unknown> = {}) => ({
        ...amazonTranscribeSettings(CREDENTIALS),
        pollInterval: 1,
        ...extra,
    });

    function completedJob(status = 'COMPLETED', extra: Record<string, unknown> = {}) {
        return {
            TranscriptionJob: {
                TranscriptionJobName: 'media-tsk_01TEST',
                TranscriptionJobStatus: status,
                LanguageCode: 'fr-CA',
                Media: { MediaFileUri: 's3://media-transcribe/eclair-transcribe/old/audio.flac' },
                Transcript: {
                    TranscriptFileUri:
                        'https://s3.ca-central-1.amazonaws.com/media-transcribe/eclair-transcribe/old/transcript.json',
                },
                ...extra,
            },
        };
    }

    it('uploads FLAC under an unpredictable key, follows the job, converts and deletes everything', async () => {
        const transcript = await readFile(fixture('amazon-transcript.json'), 'utf8');
        let polls = 0;
        const clients = fakeClients((command) => {
            switch (command) {
                case 'StartTranscriptionJob':
                    return { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } };
                case 'GetTranscriptionJob':
                    polls++;
                    return polls < 2
                        ? { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } }
                        : completedJob();
                case 'GetObject':
                    return { Body: { transformToString: () => Promise.resolve(transcript) } };
                default:
                    return {};
            }
        });
        const result = await amazonTranscribe(settings(), clients).transcribe(context, request);

        expect(result.transcript.language).toBe('fr');
        expect(result.transcript.segments).toHaveLength(2);
        expect(result.usage).toEqual({ mediaSeconds: 2, cost: 0.0002 });

        const put = clients.sent[0];
        expect(put?.command).toBe('PutObject');
        expect(put?.input).toMatchObject({ Bucket: 'media-transcribe', ContentType: 'audio/flac' });
        const key = String(put?.input['Key']);
        expect(key).toMatch(/^eclair-transcribe\/[0-9a-f-]{36}\/audio\.flac$/);
        expect((put?.input['Body'] as Buffer).subarray(0, 4).toString()).toBe('fLaC');

        expect(clients.sent[1]).toEqual({
            command: 'StartTranscriptionJob',
            input: {
                TranscriptionJobName: 'media-tsk_01TEST',
                Media: { MediaFileUri: `s3://media-transcribe/${key}` },
                MediaFormat: 'flac',
                OutputBucketName: 'media-transcribe',
                OutputKey: key.replace('audio.flac', 'transcript.json'),
                LanguageCode: 'fr-CA',
            },
        });
        const commands = clients.sent.map((entry) => entry.command);
        expect(commands.slice(-5)).toEqual([
            'DeleteTranscriptionJob',
            'DeleteObject',
            'DeleteObject',
            'DeleteObject',
            'DeleteObject',
        ]);
        expect(
            clients.sent
                .filter((entry) => entry.command === 'DeleteObject')
                .map((entry) => entry.input['Key']),
        ).toEqual(
            expect.arrayContaining([
                key,
                key.replace('audio.flac', '.write_access_check_file.temp'),
                'eclair-transcribe/old/audio.flac',
                'eclair-transcribe/old/transcript.json',
            ]),
        );
        expect(progress.at(-1)).toBeLessThanOrEqual(0.9);
    });

    it('identifies the language among the project locales', async () => {
        const clients = fakeClients((command) =>
            command === 'StartTranscriptionJob'
                ? completedJob('FAILED', { FailureReason: 'x' })
                : {},
        );
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, {
                ...request,
                language: undefined,
            }),
        ).rejects.toBeInstanceOf(OperationError);
        expect(clients.sent[1]?.input).toMatchObject({
            IdentifyLanguage: true,
            LanguageOptions: ['fr-CA', 'en-US'],
        });
        expect(clients.sent[1]?.input).not.toHaveProperty('LanguageCode');
    });

    it('follows the job of an earlier attempt of the task', async () => {
        const clients = fakeClients((command) => {
            if (command === 'StartTranscriptionJob') {
                throw awsError('ConflictException');
            }
            if (command === 'GetTranscriptionJob') {
                return completedJob();
            }
            if (command === 'GetObject') {
                return {
                    Body: {
                        transformToString: () =>
                            readFile(fixture('amazon-transcript.json'), 'utf8'),
                    },
                };
            }
            return {};
        });
        const result = await amazonTranscribe(settings(), clients).transcribe(context, request);
        expect(result.transcript.segments).toHaveLength(2);
        expect(clients.sent.find((entry) => entry.command === 'GetObject')?.input).toEqual({
            Bucket: 'media-transcribe',
            Key: 'eclair-transcribe/old/transcript.json',
        });
        expect(
            clients.sent.filter((entry) => entry.command === 'DeleteTranscriptionJob'),
        ).toHaveLength(1);
    });

    it('fails with the reason of a failed job, after deleting it', async () => {
        const clients = fakeClients((command) =>
            command === 'GetTranscriptionJob' || command === 'StartTranscriptionJob'
                ? completedJob('FAILED', { FailureReason: 'The media file is too long.' })
                : {},
        );
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({
            code: 'limit_exceeded',
            message: 'Amazon Transcribe failed: The media file is too long.',
        });
        expect(clients.sent.map((entry) => entry.command)).toContain('DeleteTranscriptionJob');
    });

    it('deletes the audio and the job when the task is canceled', async () => {
        const clients = fakeClients((command) => {
            if (command === 'GetTranscriptionJob') {
                controller.abort();
            }
            return command === 'GetTranscriptionJob' || command === 'StartTranscriptionJob'
                ? { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } }
                : {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({
            message: 'The task was canceled.',
        });
        const commands = clients.sent.map((entry) => entry.command);
        expect(commands).toContain('DeleteTranscriptionJob');
        expect(commands.at(-1)).toBe('DeleteObject');
    });

    it('reports throttling as a refusal, and a failed cleanup as a warning', async () => {
        const clients = fakeClients((command) => {
            if (command === 'StartTranscriptionJob') {
                throw awsError('ThrottlingException');
            }
            if (command === 'DeleteObject') {
                throw awsError('AccessDenied');
            }
            return {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({
            code: 'provider_refused',
        });
        expect(clients.sent.map((entry) => entry.command)).not.toContain('DeleteTranscriptionJob');
        expect(warnings).toEqual([{ failures: ['object: AccessDenied', 'object: AccessDenied'] }]);
    });

    it('refuses audio shorter than half a second and a language without a locale', async () => {
        const clients = fakeClients(() => ({}));
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, {
                ...request,
                duration: 0.2,
            }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, {
                ...request,
                language: 'tlh',
            }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
        expect(clients.sent).toEqual([]);
    });
});

/**
 * Against Amazon Transcribe, which costs money: set `ECLAIR_TEST_AMAZON_TRANSCRIBE` to a JSON of
 * the project credentials (`accessKeyId`, `secretAccessKey`, `region`, `bucket`). Never in CI.
 */
const realCredentials = process.env['ECLAIR_TEST_AMAZON_TRANSCRIBE'];

describe.skipIf(realCredentials === undefined || skipWithoutBinaries(['ffmpeg']))(
    'amazon-transcribe, with AWS',
    () => {
        it('transcribes speech and cleans up', async () => {
            const workdir = await mkdtemp(join(tmpdir(), 'eclair-amazon-'));
            try {
                const audio = join(workdir, 'audio.wav');
                execFileSync('ffmpeg', [
                    '-v',
                    'error',
                    '-i',
                    fixture('speech-en.mp3'),
                    '-ac',
                    '1',
                    '-ar',
                    '16000',
                    audio,
                ]);
                const controller = new AbortController();
                const provider = amazonTranscribe(
                    amazonTranscribeSettings(
                        JSON.parse(realCredentials ?? '{}') as Record<string, string>,
                    ),
                );
                const result = await provider.transcribe(
                    {
                        input: {
                            path: audio,
                            kind: 'audio',
                            mime: 'audio/wav',
                            extension: 'wav',
                            size: 1,
                            probe: undefined,
                        },
                        workdir,
                        exec: (binary, args, options) =>
                            execBinary(binary, args, { cwd: workdir, ...options }),
                        progress: () => {},
                        log: { debug: () => {}, info: () => {}, warn: () => {} },
                        signal: controller.signal,
                        output: () => {},
                    },
                    { audio, duration: 11, language: 'en', model: undefined, prompt: undefined },
                );
                expect(
                    result.transcript.segments
                        .map((segment) => segment.text)
                        .join(' ')
                        .toLowerCase(),
                ).toContain('ask not what your country can do for you');
            } finally {
                await rm(workdir, { recursive: true, force: true });
            }
        }, 600_000);
    },
);
