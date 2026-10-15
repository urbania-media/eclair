import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, requireSettings } from './config.ts';

function problemsOf(env: NodeJS.ProcessEnv): string[] {
    try {
        loadConfig(env);
    } catch (error) {
        if (error instanceof ConfigError) {
            return error.problems;
        }
        throw error;
    }
    return [];
}

describe('loadConfig', () => {
    it('applies the defaults', () => {
        const config = loadConfig({});
        expect(config).toMatchObject({
            databaseUrl: undefined,
            host: '0.0.0.0',
            port: 8080,
            tmpDir: '/tmp/eclair',
            tempStorage: 'file:///var/lib/eclair/storage',
            tempRetention: 24 * 3_600_000,
            tempMaxRetention: 7 * 24 * 3_600_000,
            plugins: [],
            maxInputSize: 2 * 1024 ** 3,
            taskTimeout: 3_600_000,
            logLevel: 'info',
        });
        expect(config.queues).toEqual([
            { name: 'cpu', concurrency: availableParallelism() },
            { name: 'probe', concurrency: 2 },
        ]);
        expect(config.binaries.ffmpeg).toBe('ffmpeg');
    });

    it('reads every variable', () => {
        const key = randomBytes(32).toString('base64');
        const config = loadConfig({
            DATABASE_URL: 'postgres://eclair:secret@db/eclair',
            REDIS_URL: 'redis://redis:6379',
            ECLAIR_PORT: '9000',
            ECLAIR_PUBLIC_URL: 'https://eclair.example.com/',
            ECLAIR_SECRET_KEY: key,
            ECLAIR_ADMIN_TOKEN: 'a'.repeat(32),
            ECLAIR_QUEUES: 'cpu:4,video:1,probe:0',
            ECLAIR_PLUGINS: '@acme/eclair-ops, eclair-plugin-x',
            ECLAIR_MAX_INPUT_SIZE: '500MB',
            ECLAIR_LOG_LEVEL: 'debug',
            FFMPEG_BIN: '/opt/ffmpeg/bin/ffmpeg',
        });
        expect(config).toMatchObject({
            databaseUrl: 'postgres://eclair:secret@db/eclair',
            redisUrl: 'redis://redis:6379',
            port: 9000,
            publicUrl: 'https://eclair.example.com',
            adminToken: 'a'.repeat(32),
            queues: [
                { name: 'cpu', concurrency: 4 },
                { name: 'video', concurrency: 1 },
            ],
            plugins: ['@acme/eclair-ops', 'eclair-plugin-x'],
            maxInputSize: 500 * 1024 ** 2,
            logLevel: 'debug',
        });
        expect(config.secretKey).toEqual(Buffer.from(key, 'base64'));
        expect(config.binaries.ffmpeg).toBe('/opt/ffmpeg/bin/ffmpeg');
    });

    it('treats empty variables as unset', () => {
        expect(loadConfig({ ECLAIR_PLUGINS: '', DATABASE_URL: ' ' }).databaseUrl).toBeUndefined();
    });

    it('reports every invalid variable at once', () => {
        expect(
            problemsOf({
                DATABASE_URL: 'oracle://db',
                ECLAIR_PORT: 'eighty',
                ECLAIR_SECRET_KEY: 'short',
                ECLAIR_TASK_TIMEOUT: 'forever',
            }),
        ).toEqual([
            'DATABASE_URL must be a mysql://, postgres:// or sqlite: URL.',
            'ECLAIR_PORT must be a port number.',
            'ECLAIR_SECRET_KEY must be 32 random bytes in base64 (eclair key:generate).',
            'ECLAIR_TASK_TIMEOUT must be a duration (1h).',
        ]);
    });

    it('checks values that a pattern cannot', () => {
        expect(
            problemsOf({
                ECLAIR_PORT: '70000',
                ECLAIR_QUEUES: 'cpu,turbo',
                ECLAIR_TEMP_RETENTION: '30d',
            }),
        ).toEqual([
            'ECLAIR_PORT must be between 0 and 65535.',
            'ECLAIR_QUEUES: "turbo" is not a queue (cpu, video, gpu, ai, probe).',
            'ECLAIR_TEMP_RETENTION must not be longer than ECLAIR_TEMP_MAX_RETENTION.',
        ]);
    });

    it('never puts a value in a message', () => {
        const problems = problemsOf({ DATABASE_URL: 'ftp://user:hunter2@db' });
        expect(problems.join()).not.toContain('hunter2');
    });
});

describe('the temporary storage', () => {
    it('needs credentials for a bucket', () => {
        expect(problemsOf({ ECLAIR_TEMP_STORAGE: 's3://bucket/eclair' })).toEqual([
            'ECLAIR_TEMP_S3_ACCESS_KEY_ID and ECLAIR_TEMP_S3_SECRET_ACCESS_KEY are required with an s3:// ECLAIR_TEMP_STORAGE.',
        ]);
        expect(
            loadConfig({
                ECLAIR_TEMP_STORAGE: 's3://bucket/eclair',
                ECLAIR_TEMP_S3_ACCESS_KEY_ID: 'id',
                ECLAIR_TEMP_S3_SECRET_ACCESS_KEY: 'secret',
            }).tempStorageCredentials,
        ).toEqual({ accessKeyId: 'id', secretAccessKey: 'secret' });
    });
});

describe('requireSettings', () => {
    it('lists the missing settings', () => {
        const config = loadConfig({ REDIS_URL: 'redis://localhost' });
        expect(() =>
            requireSettings(config, ['DATABASE_URL', 'REDIS_URL', 'ECLAIR_SECRET_KEY']),
        ).toThrow(new ConfigError(['DATABASE_URL is required.', 'ECLAIR_SECRET_KEY is required.']));
    });
});
