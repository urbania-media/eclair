import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BINARIES, loadConfig } from '../config/config.ts';
import { HostRegistry } from '../hosts.ts';
import { createRedis } from '../redis.ts';
import { RUNS_WITH_REDIS, testRedisUrl } from '../testing.ts';
import { VERSION } from '../version.ts';
import { EXIT, runCli } from './run.ts';
import type { CliIo } from './run.ts';

function createIo(env: NodeJS.ProcessEnv = {}, stop: Promise<void> = Promise.resolve()) {
    const output = { stdout: '', stderr: '' };
    const io: CliIo = {
        stdout: (text) => {
            output.stdout += text;
        },
        stderr: (text) => {
            output.stderr += text;
        },
        env,
        waitForStop: () => stop,
    };
    return { io, output };
}

const SECRET_KEY = randomBytes(32).toString('base64');
const directories: string[] = [];

/** A new SQLite database in a temporary directory. */
function sqliteUrl(): string {
    const directory = mkdtempSync(join(tmpdir(), 'eclair-cli-'));
    directories.push(directory);
    return `sqlite://${join(directory, 'eclair.db')}`;
}

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('runCli', () => {
    it('prints the help', async () => {
        const { io, output } = createIo();
        expect(await runCli(['--help'], io)).toBe(EXIT.ok);
        expect(output.stdout).toContain('Usage: eclair <command>');
    });

    it('prints the version', async () => {
        const { io, output } = createIo();
        expect(await runCli(['--version'], io)).toBe(EXIT.ok);
        expect(output.stdout).toBe(`${VERSION}\n`);
    });

    it('generates a secret key that the configuration accepts', async () => {
        const { io, output } = createIo();
        await runCli(['key:generate'], io);
        const key = output.stdout.trim();
        expect(Buffer.from(key, 'base64')).toHaveLength(32);
        expect(loadConfig({ ECLAIR_SECRET_KEY: key }).secretKey).toHaveLength(32);
    });

    it('refuses unknown commands and extra arguments', async () => {
        const unknown = createIo();
        expect(await runCli(['serve'], unknown.io)).toBe(EXIT.usage);
        expect(unknown.output.stderr).toContain('unknown command "serve"');

        const extra = createIo();
        expect(await runCli(['api', '--port', '80'], extra.io)).toBe(EXIT.usage);
        expect(extra.output.stderr).toContain("Unknown option '--port'");
    });

    it('refuses to start with an invalid configuration', async () => {
        const { io, output } = createIo({ ECLAIR_PORT: 'eighty' });
        expect(await runCli(['api'], io)).toBe(EXIT.config);
        expect(output.stderr).toContain('ECLAIR_PORT must be a port number.');
    });

    it('needs a database to start the API', async () => {
        const { io, output } = createIo();
        expect(await runCli(['api'], io)).toBe(EXIT.config);
        expect(output.stderr).toContain('DATABASE_URL is required.');
        expect(output.stderr).toContain('REDIS_URL is required.');
        expect(output.stderr).toContain('ECLAIR_SECRET_KEY is required.');
    });

    it('refuses to start the API before the migrations', async () => {
        const { io, output } = createIo({
            DATABASE_URL: sqliteUrl(),
            // Never reached: the migrations are checked first.
            REDIS_URL: 'redis://127.0.0.1:1',
            ECLAIR_SECRET_KEY: SECRET_KEY,
        });
        expect(await runCli(['api'], io)).toBe(EXIT.unavailable);
        expect(output.stderr).toContain(
            'run eclair migrate (pending: 0001-initial, 0002-upload-parts)',
        );
    });

    it.runIf(RUNS_WITH_REDIS)(
        'migrates, then starts the API and stops it on the stop signal',
        async () => {
            const env = {
                DATABASE_URL: sqliteUrl(),
                REDIS_URL: testRedisUrl() ?? 'redis://127.0.0.1:6379',
                ECLAIR_SECRET_KEY: SECRET_KEY,
                ECLAIR_PORT: '0',
                ECLAIR_LOG_LEVEL: 'silent',
            };

            const status = createIo(env);
            expect(await runCli(['migrate', '--status'], status.io)).toBe(EXIT.ok);
            expect(status.output.stdout).toBe('pending 0001-initial\npending 0002-upload-parts\n');

            const migrate = createIo(env);
            expect(await runCli(['migrate'], migrate.io)).toBe(EXIT.ok);
            expect(migrate.output.stdout).toBe('ran 0001-initial\nran 0002-upload-parts\nDone.\n');

            const again = createIo(env);
            expect(await runCli(['migrate'], again.io)).toBe(EXIT.ok);
            expect(again.output.stdout).toBe('Nothing to migrate.\n');

            let stop = () => {};
            const stopped = new Promise<void>((resolve) => {
                stop = resolve;
            });
            const api = createIo(env, stopped);
            const running = runCli(['api'], api.io);
            stop();
            expect(await running).toBe(EXIT.ok);
            expect(api.output.stderr).toBe('');
        },
    );

    it.runIf(RUNS_WITH_REDIS)(
        'refuses to run on SQLite when another machine runs Eclair',
        async () => {
            const env = {
                DATABASE_URL: sqliteUrl(),
                REDIS_URL: testRedisUrl() ?? '',
                ECLAIR_SECRET_KEY: SECRET_KEY,
                ECLAIR_LOG_LEVEL: 'silent',
            };
            expect(await runCli(['migrate'], createIo(env).io)).toBe(EXIT.ok);
            const redis = createRedis(testRedisUrl() ?? '', 'eclair-test-guard');
            try {
                await new HostRegistry(redis, 'another-machine').register();
                const { io, output } = createIo(env);
                expect(await runCli(['worker'], io)).toBe(EXIT.unavailable);
                expect(output.stderr).toContain('Eclair also runs on another-machine');
            } finally {
                await redis.zrem('eclair:hosts', 'another-machine');
                redis.disconnect();
            }
        },
    );

    it('needs a database, Redis and the secret key to start a worker', async () => {
        const { io, output } = createIo();
        expect(await runCli(['worker'], io)).toBe(EXIT.config);
        expect(output.stderr).toContain('REDIS_URL is required.');
    });

    it.runIf(RUNS_WITH_REDIS)(
        'runs a job end to end with eclair all: upload, job, worker, result',
        async () => {
            const directory = mkdtempSync(join(tmpdir(), 'eclair-all-'));
            directories.push(directory);
            const port = 40_000 + Math.floor(Math.random() * 20_000);
            const env = {
                DATABASE_URL: `sqlite://${join(directory, 'eclair.db')}`,
                REDIS_URL: testRedisUrl() ?? '',
                ECLAIR_SECRET_KEY: SECRET_KEY,
                ECLAIR_HOST: '127.0.0.1',
                ECLAIR_PORT: String(port),
                ECLAIR_LOG_LEVEL: 'silent',
                ECLAIR_QUEUES: 'cpu:1',
                ECLAIR_TMP_DIR: join(directory, 'tmp'),
                ECLAIR_TEMP_STORAGE: pathToFileURL(join(directory, 'storage')).href,
            };
            expect(await runCli(['migrate'], createIo(env).io)).toBe(EXIT.ok);
            expect(await runCli(['projects:create', 'niche'], createIo(env).io)).toBe(EXIT.ok);
            const key = createIo(env);
            await runCli(['keys:create', 'niche'], key.io);
            const token = /ek_[\w-]+/.exec(key.output.stdout)?.[0] ?? '';

            let stop = () => {};
            const stopped = new Promise<void>((resolve) => {
                stop = resolve;
            });
            const all = createIo(env, stopped);
            const running = runCli(['all'], all.io);
            const base = `http://127.0.0.1:${port}`;
            const headers = { authorization: `Bearer ${token}` };
            try {
                // Wait for the API.
                const deadline = Date.now() + 10_000;
                while (
                    !(await fetch(`${base}/health`).then(
                        (response) => response.ok,
                        () => false,
                    ))
                ) {
                    expect(Date.now(), all.output.stderr).toBeLessThan(deadline);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }

                const upload = await fetch(`${base}/v1/uploads`, {
                    method: 'POST',
                    headers: { ...headers, 'content-type': 'application/octet-stream' },
                    body: 'plain text, probed without a binary',
                }).then((response) => response.json() as Promise<{ id: string }>);

                const created = await fetch(`${base}/v1/jobs`, {
                    method: 'POST',
                    headers: { ...headers, 'content-type': 'application/json' },
                    body: JSON.stringify({
                        input: { upload: upload.id },
                        tasks: { probe: { op: 'probe' } },
                    }),
                });
                expect(created.status).toBe(202);
                const { id } = (await created.json()) as { id: string };

                let job: {
                    status: string;
                    tasks: Record<string, { outputs?: { metadata?: unknown } }>;
                };
                do {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    job = (await fetch(`${base}/v1/jobs/${id}`, { headers }).then((response) =>
                        response.json(),
                    )) as typeof job;
                } while (job.status === 'pending' || job.status === 'running');
                expect(job.status).toBe('completed');
                expect(job.tasks['probe']?.outputs?.metadata).toEqual({
                    kind: 'other',
                    mime: 'application/octet-stream',
                    size: 35,
                });
            } finally {
                stop();
                expect(await running).toBe(EXIT.ok);
            }
        },
        30_000,
    );

    it('reports the configuration problems in doctor', async () => {
        const { io, output } = createIo({ ECLAIR_QUEUES: 'turbo' });
        expect(await runCli(['doctor'], io)).toBe(EXIT.config);
        expect(output.stdout).toContain('error ECLAIR_QUEUES: "turbo" is not a queue');
    });

    it('reports missing settings and binaries in doctor', async () => {
        // Missing binaries answer at once: the test doesn't depend on what this machine has.
        const binaries = Object.fromEntries(
            Object.entries(BINARIES).map(([name, variable]) => [variable, `/nonexistent/${name}`]),
        );
        const { io, output } = createIo(binaries);
        expect(await runCli(['doctor'], io)).toBe(EXIT.failure);
        expect(output.stdout).toContain('error DATABASE_URL is not set');
        expect(output.stdout).toContain('warn  ffmpeg: not found (/nonexistent/ffmpeg)');
    });
});
