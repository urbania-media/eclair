import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import {
    DeleteTranscriptionJobCommand,
    GetTranscriptionJobCommand,
    StartTranscriptionJobCommand,
    TranscribeClient,
} from '@aws-sdk/client-transcribe';
import type { LanguageCode, TranscriptionJob } from '@aws-sdk/client-transcribe';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Type } from 'typebox';

import { OperationError, defineAiProvider } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

import type { TranscriptionProvider } from './provider.ts';
import type { Transcript, TranscriptSegment, TranscriptWord } from './transcript.ts';

/** The credentials and settings of a project for Amazon Transcribe, stored encrypted. */
export const AmazonTranscribeCredentials = Type.Object(
    {
        accessKeyId: Type.String({ minLength: 16, maxLength: 128 }),
        secretAccessKey: Type.String({ minLength: 1 }),
        /** Region of the bucket and of the transcription jobs: `ca-central-1`. */
        region: Type.String({ pattern: '^[a-z]{2}(-[a-z]+)+-[0-9]$' }),
        /** A bucket of the project, in that region, where the audio and the transcript stay briefly. */
        bucket: Type.String({ pattern: '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' }),
        /** Key prefix in the bucket, `eclair-transcribe/` by default. Give it a lifecycle rule. */
        prefix: Type.Optional(Type.String({ pattern: '^[a-zA-Z0-9!_.*()/-]{0,200}$' })),
        /** Locales to identify the language among, comma-separated: `fr-CA,en-CA`. */
        languages: Type.Optional(
            Type.String({ pattern: '^[a-z]{2}-[A-Z]{2}(,[a-z]{2}-[A-Z]{2})*$' }),
        ),
        /** List price in US dollars per minute, to report the cost of each task: `0.006`. */
        pricePerMinute: Type.Optional(Type.String({ pattern: '^[0-9]+(\\.[0-9]+)?$' })),
    },
    { additionalProperties: false },
);

/** Declares the provider for the server: external, so a project must allow it explicitly. */
export const amazonTranscribeProvider = defineAiProvider({
    name: 'amazon-transcribe',
    title: 'Amazon Transcribe',
    capability: 'transcription',
    external: true,
    credentials: AmazonTranscribeCredentials,
});

/** Amazon Transcribe's batch limits: 8 hours and 2 GB a file, half a second at least. */
const MAX_DURATION = 8 * 3600;
const MAX_SIZE = 2 * 1024 ** 3;
const MIN_DURATION = 0.5;

/** Locales when a project gives none: the usual one of each base language. */
const DEFAULT_LOCALES: Record<string, string> = {
    fr: 'fr-CA',
    en: 'en-US',
    es: 'es-US',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-BR',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
};

export interface AmazonTranscribeSettings {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    prefix: string;
    languages: string[];
    pricePerMinute: number | undefined;
    /** Seconds of audio a task can transcribe, at most Amazon's 8 hours. */
    maxDuration: number;
    /** Milliseconds between two status requests, at first. It grows to 15 seconds. */
    pollInterval: number;
}

/** Reads the project's credentials and the operator's settings. */
export function amazonTranscribeSettings(
    credentials: Readonly<Record<string, string>> | undefined,
    settings: Readonly<Record<string, unknown>> = {},
): AmazonTranscribeSettings {
    const { accessKeyId, secretAccessKey, region, bucket } = credentials ?? {};
    if (
        accessKeyId === undefined ||
        secretAccessKey === undefined ||
        region === undefined ||
        bucket === undefined
    ) {
        throw new OperationError(
            'provider_failed',
            'The project has no credentials, region and bucket for Amazon Transcribe.',
        );
    }
    const maxDuration =
        typeof settings['maxDuration'] === 'number' && settings['maxDuration'] > 0
            ? Math.min(settings['maxDuration'], MAX_DURATION)
            : MAX_DURATION;
    const price = Number(credentials?.['pricePerMinute']);
    let prefix = credentials?.['prefix'] ?? 'eclair-transcribe/';
    if (prefix !== '' && !prefix.endsWith('/')) {
        prefix += '/';
    }
    return {
        accessKeyId,
        secretAccessKey,
        region,
        bucket,
        prefix,
        languages: (credentials?.['languages'] ?? '').split(',').filter((locale) => locale !== ''),
        pricePerMinute:
            Number.isFinite(price) && credentials?.['pricePerMinute'] !== undefined
                ? price
                : undefined,
        maxDuration,
        pollInterval:
            typeof settings['pollInterval'] === 'number' ? settings['pollInterval'] : 5000,
    };
}

/** What the provider sends to AWS: the official clients, or fakes in tests. */
export interface AwsClients {
    transcribe: Pick<TranscribeClient, 'send'>;
    s3: Pick<S3Client, 'send'>;
}

function clientsOf(settings: AmazonTranscribeSettings): AwsClients {
    const config = {
        region: settings.region,
        credentials: {
            accessKeyId: settings.accessKeyId,
            secretAccessKey: settings.secretAccessKey,
        },
        maxAttempts: 5,
    };
    return { transcribe: new TranscribeClient(config), s3: new S3Client(config) };
}

/** Amazon's batch transcript, as far as it's read here. */
interface AmazonTranscript {
    results?: {
        language_code?: string;
        items?: {
            id?: number;
            type?: 'pronunciation' | 'punctuation';
            start_time?: string;
            end_time?: string;
            alternatives?: { content?: string; confidence?: string }[];
            speaker_label?: string;
        }[];
        audio_segments?: {
            id?: number;
            transcript?: string;
            start_time?: string;
            end_time?: string;
            items?: number[];
            speaker_label?: string;
        }[];
    };
}

const SENTENCE_END = /[.!?…]$/;

/**
 * Converts Amazon's transcript to the common one. Punctuation items join the word before them.
 * Segments are Amazon's `audio_segments` when it gives them, else sentences of the words.
 */
export function parseAmazonTranscript(raw: string, language: string | undefined): Transcript {
    const json = JSON.parse(raw) as AmazonTranscript;
    const wordsById = new Map<number, TranscriptWord & { speaker?: string }>();
    const ordered: (TranscriptWord & { id: number; speaker?: string })[] = [];
    for (const [index, item] of (json.results?.items ?? []).entries()) {
        const id = item.id ?? index;
        const alternative = item.alternatives?.[0];
        const content = alternative?.content ?? '';
        if (content === '') {
            continue;
        }
        if (item.type === 'punctuation') {
            const previous = ordered.at(-1);
            if (previous !== undefined) {
                previous.text += content;
                wordsById.set(id, previous);
            }
            continue;
        }
        const confidence = Number(alternative?.confidence);
        const word = {
            id,
            start: Number(item.start_time ?? 0),
            end: Number(item.end_time ?? item.start_time ?? 0),
            text: content,
            ...(Number.isFinite(confidence) ? { probability: confidence } : {}),
            ...(item.speaker_label === undefined ? {} : { speaker: item.speaker_label }),
        };
        ordered.push(word);
        wordsById.set(id, word);
    }
    const clean = ({
        id: _id,
        speaker: _speaker,
        ...word
    }: TranscriptWord & { id?: number; speaker?: string }) => word;

    const segments: TranscriptSegment[] = [];
    const audioSegments = json.results?.audio_segments ?? [];
    if (audioSegments.length > 0) {
        for (const segment of audioSegments) {
            const words = [
                ...new Set(
                    (segment.items ?? [])
                        .map((id) => wordsById.get(id))
                        .filter((word) => word !== undefined),
                ),
            ];
            const text = segment.transcript?.trim() ?? words.map((word) => word.text).join(' ');
            if (text === '') {
                continue;
            }
            segments.push({
                start: Number(segment.start_time ?? words[0]?.start ?? 0),
                end: Number(segment.end_time ?? words.at(-1)?.end ?? 0),
                text,
                words: words.map(clean),
                ...(segment.speaker_label === undefined ? {} : { speaker: segment.speaker_label }),
            });
        }
    } else {
        let current: typeof ordered = [];
        const flush = () => {
            const first = current[0];
            const last = current.at(-1);
            if (first !== undefined && last !== undefined) {
                segments.push({
                    start: first.start,
                    end: last.end,
                    text: current.map((word) => word.text).join(' '),
                    words: current.map(clean),
                });
            }
            current = [];
        };
        for (const word of ordered) {
            current.push(word);
            if (SENTENCE_END.test(word.text) || current.length >= 40) {
                flush();
            }
        }
        flush();
    }
    const code = json.results?.language_code ?? language;
    return { language: code?.split('-')[0], segments };
}

/** The error code of an AWS error: refusals by Amazon are `provider_refused`, the rest `provider_failed`. */
function awsError(error: unknown, action: string): OperationError {
    if (error instanceof OperationError) {
        return error;
    }
    const name = (error as { name?: string }).name ?? 'Error';
    const refused = [
        'ThrottlingException',
        'LimitExceededException',
        'TooManyRequestsException',
        'SlowDown',
    ];
    return new OperationError(
        refused.includes(name) ? 'provider_refused' : 'provider_failed',
        `Amazon Transcribe couldn't ${action} (${name}).`,
        { cause: error },
    );
}

/** `s3://bucket/key` or `https://s3.region.amazonaws.com/bucket/key`: the key in the bucket. */
function keyOf(uri: string | undefined, bucket: string): string | undefined {
    if (uri === undefined) {
        return undefined;
    }
    if (uri.startsWith(`s3://${bucket}/`)) {
        return uri.slice(`s3://${bucket}/`.length);
    }
    try {
        const url = new URL(uri);
        const path = decodeURIComponent(url.pathname.slice(1));
        if (url.hostname.startsWith(`${bucket}.`)) {
            return path;
        }
        return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : undefined;
    } catch {
        return undefined;
    }
}

/** Encodes the extracted audio in FLAC: lossless, about half the size of the WAV. */
async function encodeFlac(context: OperationContext, wav: string): Promise<string> {
    const path = join(context.workdir, 'audio.flac');
    await context.exec('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-f',
        'wav',
        '-i',
        wav,
        '-c:a',
        'flac',
        '-compression_level',
        '5',
        path,
    ]);
    return path;
}

/**
 * `amazon-transcribe`: a batch job of Amazon Transcribe. The audio goes to the project's bucket
 * under an unpredictable key, the job has a name derived from the task, so a task that runs again
 * finds its job, and the audio, the transcript and the job are deleted at the end, after a failure
 * or a cancel too.
 */
export function amazonTranscribe(
    settings: AmazonTranscribeSettings,
    clients: AwsClients = clientsOf(settings),
): TranscriptionProvider {
    return {
        name: 'amazon-transcribe',
        maxDuration: settings.maxDuration,

        async transcribe(context, request) {
            if (request.duration < MIN_DURATION) {
                throw new OperationError(
                    'unsupported_input',
                    'The audio is shorter than half a second.',
                );
            }
            const flac = await encodeFlac(context, request.audio);
            const { size } = await stat(flac);
            if (size > MAX_SIZE) {
                throw new OperationError(
                    'limit_exceeded',
                    'The audio is larger than the 2 GB Amazon Transcribe takes.',
                );
            }

            // A name per task, so that an attempt after a crash finds the job of the first one.
            const name =
                `eclair-${(context.taskId ?? randomUUID()).replace(/[^0-9A-Za-z._-]/g, '-')}`.slice(
                    0,
                    200,
                );
            const folder = `${settings.prefix}${randomUUID()}/`;
            const mediaKey = `${folder}audio.flac`;
            const outputKey = `${folder}transcript.json`;
            const toDelete = new Set<string>([mediaKey]);
            let jobStarted = false;

            const locale =
                request.language === undefined
                    ? undefined
                    : request.language.includes('-')
                      ? request.language
                      : (settings.languages.find((option) =>
                            option.startsWith(`${request.language}-`),
                        ) ?? DEFAULT_LOCALES[request.language]);
            if (request.language !== undefined && locale === undefined) {
                throw new OperationError(
                    'unsupported_input',
                    `Amazon Transcribe has no locale for "${request.language}" here.`,
                );
            }

            try {
                try {
                    await clients.s3.send(
                        new PutObjectCommand({
                            Bucket: settings.bucket,
                            Key: mediaKey,
                            Body: await readFile(flac),
                            ContentType: 'audio/flac',
                        }),
                        { abortSignal: context.signal },
                    );
                } catch (error) {
                    throw awsError(error, 'receive the audio in the bucket');
                }
                context.progress(0.2);

                let job: TranscriptionJob | undefined;
                try {
                    const result = await clients.transcribe.send(
                        new StartTranscriptionJobCommand({
                            TranscriptionJobName: name,
                            Media: { MediaFileUri: `s3://${settings.bucket}/${mediaKey}` },
                            MediaFormat: 'flac',
                            OutputBucketName: settings.bucket,
                            OutputKey: outputKey,
                            ...(locale !== undefined
                                ? { LanguageCode: locale as LanguageCode }
                                : settings.languages.length >= 2
                                  ? {
                                        IdentifyLanguage: true,
                                        LanguageOptions: settings.languages as LanguageCode[],
                                    }
                                  : settings.languages.length === 1
                                    ? { LanguageCode: settings.languages[0] as LanguageCode }
                                    : { IdentifyLanguage: true }),
                        }),
                        { abortSignal: context.signal },
                    );
                    job = result.TranscriptionJob;
                    jobStarted = true;
                } catch (error) {
                    if ((error as { name?: string }).name !== 'ConflictException') {
                        throw awsError(error, 'start the job');
                    }
                    // The job of an earlier attempt of this task: follow it, and delete what it left.
                    jobStarted = true;
                    context.log.info('Following the job of an earlier attempt.', { job: name });
                }

                const started = Date.now();
                let interval = settings.pollInterval;
                for (;;) {
                    if (
                        job?.TranscriptionJobStatus === 'COMPLETED' ||
                        job?.TranscriptionJobStatus === 'FAILED'
                    ) {
                        break;
                    }
                    if (job !== undefined) {
                        await sleep(interval, undefined, { signal: context.signal }).catch(() => {
                            throw new OperationError('operation_failed', 'The task was canceled.');
                        });
                        interval = Math.min(interval * 1.5, 15_000);
                    }
                    try {
                        job = (
                            await clients.transcribe.send(
                                new GetTranscriptionJobCommand({ TranscriptionJobName: name }),
                                { abortSignal: context.signal },
                            )
                        ).TranscriptionJob;
                    } catch (error) {
                        throw awsError(error, 'tell the state of the job');
                    }
                    for (const key of [
                        keyOf(job?.Media?.MediaFileUri, settings.bucket),
                        keyOf(job?.Transcript?.TranscriptFileUri, settings.bucket),
                    ]) {
                        if (key !== undefined && key.startsWith(settings.prefix)) {
                            toDelete.add(key);
                        }
                    }
                    // Amazon takes about a third of the audio's duration: progress up to 90 %.
                    context.progress(
                        Math.min(
                            0.9,
                            0.2 +
                                (0.7 * (Date.now() - started)) /
                                    1000 /
                                    Math.max(30, request.duration / 3),
                        ),
                    );
                }

                if (job.TranscriptionJobStatus === 'FAILED') {
                    const reason = job.FailureReason ?? 'no reason given';
                    throw new OperationError(
                        /duration|length|size|too (long|large)/i.test(reason)
                            ? 'limit_exceeded'
                            : 'provider_failed',
                        `Amazon Transcribe failed: ${reason}`,
                    );
                }
                const transcriptKey =
                    keyOf(job.Transcript?.TranscriptFileUri, settings.bucket) ?? outputKey;
                toDelete.add(transcriptKey);
                let raw: string;
                try {
                    const object = await clients.s3.send(
                        new GetObjectCommand({ Bucket: settings.bucket, Key: transcriptKey }),
                        { abortSignal: context.signal },
                    );
                    raw = (await object.Body?.transformToString('utf8')) ?? '';
                } catch (error) {
                    throw awsError(error, 'give the transcript');
                }
                const billed = request.duration;
                return {
                    transcript: parseAmazonTranscript(raw, job.LanguageCode ?? locale),
                    model: undefined,
                    usage: {
                        mediaSeconds: request.duration,
                        ...(settings.pricePerMinute === undefined
                            ? {}
                            : {
                                  cost:
                                      Math.round((billed / 60) * settings.pricePerMinute * 1e6) /
                                      1e6,
                              }),
                    },
                };
            } finally {
                // Never with the task's signal: the cleanup runs after a cancel too.
                await cleanup(
                    context,
                    clients,
                    settings.bucket,
                    [...toDelete],
                    jobStarted ? name : undefined,
                );
            }
        },
    };
}

async function cleanup(
    context: OperationContext,
    clients: AwsClients,
    bucket: string,
    keys: string[],
    job: string | undefined,
): Promise<void> {
    const failures: string[] = [];
    if (job !== undefined) {
        try {
            await clients.transcribe.send(
                new DeleteTranscriptionJobCommand({ TranscriptionJobName: job }),
            );
        } catch (error) {
            if ((error as { name?: string }).name !== 'NotFoundException') {
                failures.push(`job: ${(error as { name?: string }).name ?? 'Error'}`);
            }
        }
    }
    for (const key of keys) {
        try {
            await clients.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        } catch (error) {
            failures.push(`object: ${(error as { name?: string }).name ?? 'Error'}`);
        }
    }
    if (failures.length > 0) {
        // The bucket's lifecycle rule on the prefix deletes what's left.
        context.log.warn('Some files or the job of Amazon Transcribe could not be deleted.', {
            failures,
        });
    }
}
