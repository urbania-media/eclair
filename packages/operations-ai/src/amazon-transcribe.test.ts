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
    amazonTranscribeProvider,
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

    it('keeps the polling interval above 100 ms, and only the locales Amazon identifies', () => {
        const read = amazonTranscribeSettings(
            { ...CREDENTIALS, languages: 'fr-CA,en-CA,en-US' },
            { pollInterval: 0, cleanupWait: -5 },
        );
        expect(read.pollInterval).toBe(100);
        expect(read.cleanupWait).toBe(0);
        expect(read.languages).toEqual(['fr-CA', 'en-US']);
    });
});

describe('amazonTranscribeProvider.checkOptions', () => {
    const check = (language: string) => amazonTranscribeProvider.checkOptions?.({ language });

    it('accepts the languages Amazon transcribes, and refuses the others when the job is created', () => {
        expect(check('auto')).toBeUndefined();
        expect(check('fr')).toBeUndefined();
        expect(check('fr-CA')).toBeUndefined();
        expect(check('nl')).toBeUndefined();
        expect(check('en-CA')).toEqual({
            language: expect.stringContaining(
                "doesn't transcribe en-CA: use en or one of en-AB",
            ) as string,
        });
        expect(check('tlh')).toEqual({ language: 'Amazon Transcribe doesn\'t transcribe "tlh"' });
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

/** An error of AWS: answered by Amazon with a status, or without one (the request never arrived). */
function awsError(name: string, status: number | undefined = 400): Error {
    const error = new Error(name);
    error.name = name;
    if (status !== undefined) {
        Object.assign(error, { $metadata: { httpStatusCode: status } });
    }
    return error;
}

/** The bytes the fake S3 received: the provider streams the file. */
async function uploaded(clients: { sent: Sent[] }): Promise<Buffer> {
    const body = clients.sent.find((entry) => entry.command === 'PutObject')?.input['Body'];
    return readFile(String((body as { path: string }).path));
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
        cleanupWait: 50,
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
        // Amazon bills 15 seconds at least.
        expect(result.usage).toEqual({ mediaSeconds: 2, cost: 0.0015 });

        const put = clients.sent[0];
        expect(put?.command).toBe('PutObject');
        expect(put?.input).toMatchObject({ Bucket: 'media-transcribe', ContentType: 'audio/flac' });
        const key = String(put?.input['Key']);
        expect(key).toMatch(/^eclair-transcribe\/[0-9a-f-]{36}\/audio\.flac$/);
        const bytes = await uploaded(clients);
        expect(bytes.subarray(0, 4).toString()).toBe('fLaC');
        expect(put?.input['ContentLength']).toBe(bytes.length);

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
        expect(commands.slice(-7)).toEqual([
            'DeleteTranscriptionJob',
            ...Array<string>(6).fill('DeleteObject'),
        ]);
        expect(
            clients.sent
                .filter((entry) => entry.command === 'DeleteObject')
                .map((entry) => entry.input['Key']),
        ).toEqual(
            expect.arrayContaining([
                key,
                key.replace('audio.flac', '.write_access_check_file.temp'),
                key.replace('audio.flac', 'transcript.json'),
                'eclair-transcribe/old/audio.flac',
                'eclair-transcribe/old/transcript.json',
                'eclair-transcribe/old/.write_access_check_file.temp',
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
        // What the earlier attempt left in its own folder, Amazon's access check included.
        expect(
            clients.sent
                .filter((entry) => entry.command === 'DeleteObject')
                .map((entry) => entry.input['Key']),
        ).toEqual(
            expect.arrayContaining([
                'eclair-transcribe/old/audio.flac',
                'eclair-transcribe/old/.write_access_check_file.temp',
            ]),
        );
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

    it("keeps the project's bucket and keys out of a failure reason", async () => {
        const clients = fakeClients((command) =>
            command === 'StartTranscriptionJob'
                ? completedJob('FAILED', {
                      FailureReason:
                          'Unsupported audio in s3://media-transcribe/eclair-transcribe/x/audio.flac.',
                  })
                : {},
        );
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({
            code: 'provider_failed',
            message: 'Amazon Transcribe failed: Unsupported audio in the file',
        });
    });

    it('waits for a canceled job to end, then deletes it with its late transcript', async () => {
        const clients = fakeClients((command) => {
            if (command === 'GetTranscriptionJob' && !controller.signal.aborted) {
                controller.abort();
                return { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } };
            }
            if (command === 'GetTranscriptionJob') {
                return completedJob('COMPLETED', { Media: undefined, Transcript: undefined });
            }
            return command === 'StartTranscriptionJob'
                ? { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } }
                : {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({
            message: 'The task was canceled.',
        });
        const commands = clients.sent.map((entry) => entry.command);
        // Amazon refuses to delete a running job: the cleanup asks until it has ended.
        expect(commands.indexOf('DeleteTranscriptionJob')).toBeGreaterThan(
            commands.lastIndexOf('GetTranscriptionJob'),
        );
        const key = String(clients.sent[0]?.input['Key']);
        expect(
            clients.sent
                .filter((entry) => entry.command === 'DeleteObject')
                .map((entry) => entry.input['Key']),
        ).toEqual(expect.arrayContaining([key, key.replace('audio.flac', 'transcript.json')]));
        expect(warnings).toEqual([]);
    });

    it('leaves a job that is still running after a timeout, and says so', async () => {
        const clients = fakeClients((command, input) => {
            if (command === 'GetTranscriptionJob') {
                controller.abort('timeout');
                return { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } };
            }
            if (command === 'DeleteTranscriptionJob') {
                // What Amazon answers for a running job.
                throw awsError('BadRequestException');
            }
            return command === 'StartTranscriptionJob' ? { TranscriptionJob: input } : {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({ message: 'The task was canceled.' });
        const commands = clients.sent.map((entry) => entry.command);
        expect(commands).not.toContain('DeleteTranscriptionJob');
        expect(commands.filter((command) => command === 'DeleteObject')).toHaveLength(3);
        expect(warnings).toEqual([
            { failures: ['job: still IN_PROGRESS'], job: 'media-tsk_01TEST' },
        ]);
    });

    it('cleans up a job whose start was cut by a cancel', async () => {
        const clients = fakeClients((command) => {
            if (command === 'StartTranscriptionJob') {
                // The request may have reached Amazon: there's no answer to tell.
                controller.abort();
                throw awsError('AbortError', undefined);
            }
            return command === 'GetTranscriptionJob' ? completedJob() : {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, request),
        ).rejects.toMatchObject({ message: 'The task was canceled.' });
        expect(clients.sent.map((entry) => entry.command)).toContain('DeleteTranscriptionJob');
    });

    it('asks again when a status request fails, and gives up after five in a row', async () => {
        const transcript = await readFile(fixture('amazon-transcript.json'), 'utf8');
        let polls = 0;
        const flaky = fakeClients((command) => {
            if (command === 'GetTranscriptionJob') {
                polls++;
                if (polls <= 2) {
                    throw awsError('InternalFailureException', 500);
                }
                return completedJob();
            }
            if (command === 'GetObject') {
                return { Body: { transformToString: () => Promise.resolve(transcript) } };
            }
            return command === 'StartTranscriptionJob'
                ? { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } }
                : {};
        });
        const result = await amazonTranscribe(settings(), flaky).transcribe(context, request);
        expect(result.transcript.segments).toHaveLength(2);

        warnings.length = 0;
        const down = fakeClients((command) => {
            if (command === 'GetTranscriptionJob') {
                throw awsError('InternalFailureException', 500);
            }
            return command === 'StartTranscriptionJob'
                ? { TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } }
                : {};
        });
        await expect(
            amazonTranscribe(settings(), down).transcribe(context, request),
        ).rejects.toMatchObject({
            code: 'provider_failed',
            message:
                "Amazon Transcribe couldn't tell the state of the job (InternalFailureException).",
        });
        // Without knowing whether the job ended, the cleanup doesn't delete it.
        expect(down.sent.map((entry) => entry.command)).not.toContain('DeleteTranscriptionJob');
        expect(warnings.at(-1)).toMatchObject({ failures: ['job: still unknown'] });
    });

    it('reads the transcript again when a request fails', async () => {
        const transcript = await readFile(fixture('amazon-transcript.json'), 'utf8');
        let reads = 0;
        const clients = fakeClients((command) => {
            if (command === 'GetObject') {
                reads++;
                if (reads === 1) {
                    throw awsError('InternalError', 500);
                }
                return { Body: { transformToString: () => Promise.resolve(transcript) } };
            }
            return command === 'StartTranscriptionJob' ? completedJob() : {};
        });
        const result = await amazonTranscribe(settings(), clients).transcribe(context, request);
        expect(result.transcript.segments).toHaveLength(2);
        expect(reads).toBe(2);
    });

    it('reports throttling as a refusal, and a failed cleanup as a warning', async () => {
        const clients = fakeClients((command) => {
            if (command === 'StartTranscriptionJob') {
                // Answered by Amazon: there is no job to delete.
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
        expect(warnings).toEqual([{ failures: Array<string>(3).fill('object: AccessDenied') }]);
    });

    it('pads audio shorter than half a second with silence, as Amazon needs', async () => {
        const short = join(workdir, 'short.wav');
        execFileSync('ffmpeg', ['-v', 'error', '-i', request.audio, '-t', '0.2', short]);
        let duration = 0;
        const clients = fakeClients((command, input) => {
            if (command === 'PutObject') {
                duration = Number(
                    execFileSync('ffprobe', [
                        '-v',
                        'error',
                        '-show_entries',
                        'format=duration',
                        '-of',
                        'csv=p=0',
                        String((input['Body'] as { path: string }).path),
                    ]).toString(),
                );
            }
            return command === 'StartTranscriptionJob'
                ? completedJob('FAILED', { FailureReason: 'x' })
                : {};
        });
        await expect(
            amazonTranscribe(settings(), clients).transcribe(context, {
                ...request,
                audio: short,
                duration: 0.2,
            }),
        ).rejects.toMatchObject({ code: 'provider_failed' });
        expect(duration).toBeGreaterThanOrEqual(0.5);
    });

    it('refuses a language Amazon does not transcribe, before sending anything', async () => {
        const clients = fakeClients(() => ({}));
        for (const language of ['tlh', 'en-CA']) {
            await expect(
                amazonTranscribe(settings(), clients).transcribe(context, { ...request, language }),
            ).rejects.toMatchObject({ code: 'unsupported_input' });
        }
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
