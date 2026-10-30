import { availableParallelism } from 'node:os';
import { Type } from 'typebox';
import type { Static } from 'typebox';

import { CAPABILITIES } from '@eclair-js/operation';

import { createAjv } from '../validation.ts';
import { DURATION_PATTERN, SIZE_PATTERN, parseDuration, parseSize } from './units.ts';

/** Queues a worker can serve: one per capability, the probe queue included (decision 0012). */
export const QUEUE_NAMES = CAPABILITIES;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Binaries the built-in operations call, and the variables that override their paths. */
export const BINARIES = {
    ffmpeg: 'FFMPEG_BIN',
    ffprobe: 'FFPROBE_BIN',
    magick: 'MAGICK_BIN',
    vips: 'VIPS_BIN',
    gs: 'GS_BIN',
    pdfinfo: 'PDFINFO_BIN',
    pdftoppm: 'PDFTOPPM_BIN',
    audiowaveform: 'AUDIOWAVEFORM_BIN',
    fonttools: 'FONTTOOLS_BIN',
    'whisper-cli': 'WHISPER_BIN',
} as const;

export type BinaryName = keyof typeof BINARIES;

const duration = (fallback: string, description: string) =>
    Type.String({ pattern: DURATION_PATTERN, default: fallback, description });

const size = (fallback: string, description: string) =>
    Type.String({ pattern: SIZE_PATTERN, default: fallback, description });

/** The environment variables Eclair reads. `description` says what a valid value looks like. */
const EnvironmentSchema = Type.Object({
    DATABASE_URL: Type.Optional(
        Type.String({
            pattern: '^(mysql|postgres|postgresql|sqlite):',
            description: 'a mysql://, postgres:// or sqlite: URL',
        }),
    ),
    REDIS_URL: Type.Optional(
        Type.String({ pattern: '^rediss?://', description: 'a redis:// or rediss:// URL' }),
    ),
    ECLAIR_HOST: Type.String({ minLength: 1, default: '0.0.0.0', description: 'a host name' }),
    ECLAIR_PORT: Type.String({
        pattern: '^[0-9]{1,5}$',
        default: '8080',
        description: 'a port number',
    }),
    ECLAIR_PUBLIC_URL: Type.Optional(
        Type.String({ pattern: '^https?://[^/]', description: 'an http:// or https:// URL' }),
    ),
    ECLAIR_SECRET_KEY: Type.Optional(
        Type.String({
            pattern: '^[A-Za-z0-9+/]{43}=$',
            description: '32 random bytes in base64 (eclair key:generate)',
        }),
    ),
    ECLAIR_ADMIN_TOKEN: Type.Optional(
        Type.String({ minLength: 32, description: 'at least 32 characters' }),
    ),
    ECLAIR_DASHBOARD: Type.Union([Type.Literal('true'), Type.Literal('false')], {
        default: 'true',
        description: 'true or false',
    }),
    ECLAIR_QUEUES: Type.String({
        pattern: '^[a-z]+(:[0-9]+)?(,[a-z]+(:[0-9]+)?)*$',
        default: 'cpu',
        description: 'queue names with an optional concurrency: cpu:4,video:1',
    }),
    ECLAIR_TMP_DIR: Type.String({ minLength: 1, default: '/tmp/eclair', description: 'a path' }),
    ECLAIR_TEMP_STORAGE: Type.String({
        pattern: '^(file|s3)://',
        default: 'file:///var/lib/eclair/storage',
        description: 'a file:// or s3:// URL',
    }),
    ECLAIR_TEMP_S3_ACCESS_KEY_ID: Type.Optional(
        Type.String({ minLength: 1, description: 'an access key id' }),
    ),
    ECLAIR_TEMP_S3_SECRET_ACCESS_KEY: Type.Optional(
        Type.String({ minLength: 1, description: 'a secret access key' }),
    ),
    ECLAIR_TEMP_RETENTION: duration('24h', 'a duration (24h)'),
    ECLAIR_TEMP_MAX_RETENTION: duration('7d', 'a duration (7d)'),
    ECLAIR_PLUGINS: Type.String({ default: '', description: 'package names, comma-separated' }),
    ECLAIR_MAX_INPUT_SIZE: size('2GB', 'a size (2GB)'),
    ECLAIR_TASK_TIMEOUT: duration('1h', 'a duration (1h)'),
    ECLAIR_JOB_RETENTION: duration('30d', 'a duration (30d)'),
    ECLAIR_LOG_LEVEL: Type.Union(
        LOG_LEVELS.map((level) => Type.Literal(level)),
        { default: 'info', description: LOG_LEVELS.join(', ') },
    ),
});

type Environment = Static<typeof EnvironmentSchema>;

export interface QueueConfig {
    name: QueueName;
    concurrency: number;
}

export interface Config {
    databaseUrl: string | undefined;
    redisUrl: string | undefined;
    host: string;
    port: number;
    publicUrl: string | undefined;
    /** 32 bytes that encrypt storage credentials and provider keys. */
    secretKey: Buffer | undefined;
    adminToken: string | undefined;
    /** Serves the dashboard at `/dashboard/`, with the admin API. */
    dashboard: boolean;
    queues: QueueConfig[];
    tmpDir: string;
    /**
     * Backend of the temporary storage: `file:///path`, or `s3://bucket/prefix?endpoint=…&region=…`
     * with the `ECLAIR_TEMP_S3_*` credentials.
     */
    tempStorage: string;
    tempStorageCredentials: { accessKeyId: string; secretAccessKey: string } | undefined;
    /** Milliseconds. */
    tempRetention: number;
    /** Milliseconds. */
    tempMaxRetention: number;
    plugins: string[];
    /** Bytes. */
    maxInputSize: number;
    /** Milliseconds. */
    taskTimeout: number;
    /** Milliseconds. */
    jobRetention: number;
    logLevel: LogLevel;
    binaries: Record<BinaryName, string>;
}

/** The configuration is invalid. `problems` lists every invalid variable, one sentence each. */
export class ConfigError extends Error {
    readonly problems: string[];

    constructor(problems: string[]) {
        super(
            `The configuration is invalid:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
        );
        this.name = 'ConfigError';
        this.problems = problems;
    }
}

const validateEnvironment = createAjv().compile<Environment>(EnvironmentSchema);

const DESCRIPTIONS: Record<string, string> = Object.fromEntries(
    Object.entries(EnvironmentSchema.properties).map(([name, schema]) => [
        name,
        String((schema as { description?: unknown }).description ?? 'a valid value'),
    ]),
);

/** The default concurrency of a queue on this machine, when `ECLAIR_QUEUES` doesn't set one. */
function defaultConcurrency(name: QueueName): number {
    switch (name) {
        case 'cpu':
            return availableParallelism();
        case 'probe':
            return 2;
        default:
            return 1;
    }
}

function parseQueues(value: string, problems: string[]): QueueConfig[] {
    const queues = new Map<QueueName, number>();
    for (const entry of value.split(',')) {
        const [name = '', concurrency] = entry.split(':');
        const queue = QUEUE_NAMES.find((candidate) => candidate === name);
        if (queue === undefined) {
            problems.push(`ECLAIR_QUEUES: "${name}" is not a queue (${QUEUE_NAMES.join(', ')}).`);
            continue;
        }
        queues.set(
            queue,
            concurrency === undefined ? defaultConcurrency(queue) : Number(concurrency),
        );
    }
    // Every worker serves probes unless ECLAIR_QUEUES says probe:0 (decision 0012).
    if (!queues.has('probe')) {
        queues.set('probe', defaultConcurrency('probe'));
    }
    return [...queues]
        .filter(([, concurrency]) => concurrency > 0)
        .map(([name, concurrency]) => ({ name, concurrency }));
}

/**
 * Reads the configuration from environment variables. Empty variables count as unset. Throws a
 * `ConfigError` that lists every invalid variable at once.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const raw: Record<string, string> = {};
    for (const name of Object.keys(EnvironmentSchema.properties)) {
        const value = env[name]?.trim();
        if (value !== undefined && value !== '') {
            raw[name] = value;
        }
    }

    if (!validateEnvironment(raw)) {
        const problems = (validateEnvironment.errors ?? []).map((error) => {
            const name = error.instancePath.slice(1);
            return `${name} must be ${DESCRIPTIONS[name] ?? 'a valid value'}.`;
        });
        throw new ConfigError([...new Set(problems)]);
    }
    const environment = raw as Environment;

    const problems: string[] = [];
    const port = Number(environment.ECLAIR_PORT);
    if (port > 65535) {
        problems.push('ECLAIR_PORT must be between 0 and 65535.');
    }
    const queues = parseQueues(environment.ECLAIR_QUEUES, problems);
    const tempRetention = parseDuration(environment.ECLAIR_TEMP_RETENTION);
    const tempMaxRetention = parseDuration(environment.ECLAIR_TEMP_MAX_RETENTION);
    if (
        environment.ECLAIR_TEMP_STORAGE.startsWith('s3://') &&
        (environment.ECLAIR_TEMP_S3_ACCESS_KEY_ID === undefined ||
            environment.ECLAIR_TEMP_S3_SECRET_ACCESS_KEY === undefined)
    ) {
        problems.push(
            'ECLAIR_TEMP_S3_ACCESS_KEY_ID and ECLAIR_TEMP_S3_SECRET_ACCESS_KEY are required with an s3:// ECLAIR_TEMP_STORAGE.',
        );
    }
    if (tempRetention > tempMaxRetention) {
        problems.push('ECLAIR_TEMP_RETENTION must not be longer than ECLAIR_TEMP_MAX_RETENTION.');
    }
    if (problems.length > 0) {
        throw new ConfigError(problems);
    }

    const binaries = Object.fromEntries(
        Object.entries(BINARIES).map(([name, variable]) => [name, env[variable]?.trim() || name]),
    ) as Record<BinaryName, string>;

    return {
        databaseUrl: environment.DATABASE_URL,
        redisUrl: environment.REDIS_URL,
        host: environment.ECLAIR_HOST,
        port,
        publicUrl: environment.ECLAIR_PUBLIC_URL?.replace(/\/+$/, ''),
        secretKey:
            environment.ECLAIR_SECRET_KEY === undefined
                ? undefined
                : Buffer.from(environment.ECLAIR_SECRET_KEY, 'base64'),
        adminToken: environment.ECLAIR_ADMIN_TOKEN,
        dashboard: environment.ECLAIR_DASHBOARD === 'true',
        queues,
        tmpDir: environment.ECLAIR_TMP_DIR,
        tempStorage: environment.ECLAIR_TEMP_STORAGE,
        tempStorageCredentials:
            environment.ECLAIR_TEMP_S3_ACCESS_KEY_ID === undefined ||
            environment.ECLAIR_TEMP_S3_SECRET_ACCESS_KEY === undefined
                ? undefined
                : {
                      accessKeyId: environment.ECLAIR_TEMP_S3_ACCESS_KEY_ID,
                      secretAccessKey: environment.ECLAIR_TEMP_S3_SECRET_ACCESS_KEY,
                  },
        tempRetention,
        tempMaxRetention,
        plugins: environment.ECLAIR_PLUGINS.split(',')
            .map((name) => name.trim())
            .filter((name) => name !== ''),
        maxInputSize: parseSize(environment.ECLAIR_MAX_INPUT_SIZE),
        taskTimeout: parseDuration(environment.ECLAIR_TASK_TIMEOUT),
        jobRetention: parseDuration(environment.ECLAIR_JOB_RETENTION),
        logLevel: environment.ECLAIR_LOG_LEVEL,
        binaries,
    };
}

/** The settings a command can't run without, by their variable names. */
export type RequiredSetting =
    'DATABASE_URL' | 'REDIS_URL' | 'ECLAIR_SECRET_KEY' | 'ECLAIR_ADMIN_TOKEN';

const SETTINGS: Record<RequiredSetting, keyof Config> = {
    DATABASE_URL: 'databaseUrl',
    REDIS_URL: 'redisUrl',
    ECLAIR_SECRET_KEY: 'secretKey',
    ECLAIR_ADMIN_TOKEN: 'adminToken',
};

/** Throws a `ConfigError` listing the settings that are missing. */
export function requireSettings(config: Config, settings: RequiredSetting[]): void {
    const missing = settings.filter((setting) => config[SETTINGS[setting]] === undefined);
    if (missing.length > 0) {
        throw new ConfigError(missing.map((setting) => `${setting} is required.`));
    }
}
