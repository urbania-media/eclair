import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OperationError, defineEmbedOperation, defineOperation } from '@eclair-js/operation';
import type { Job } from '@eclair-js/protocol';

import type { JobRecord } from '../jobs/records.ts';
import { testEmbedProvider } from '../jobs/testing.ts';
import { redisOperationCache } from '../operations/embeds.ts';
import { OperationRegistry } from '../operations/registry.ts';
import type { Project } from '../projects/projects.ts';
import { createRedis } from '../redis.ts';
import type { Services } from '../services.ts';
import { RUNS_WITH_REDIS, createTestServices, testRedisUrl } from '../testing.ts';
import type { Webhooks } from '../webhooks/webhooks.ts';
import { CancelBus } from './cancel.ts';
import { TaskRunner } from './runner.ts';
import { ProjectSlots } from './slots.ts';
import { TaskWorkers } from './workers.ts';

const empty = Type.Object({}, { additionalProperties: false });
/** A ThumbHash, as an operation gives it to a file. */
const HASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI';
let flakyRuns = 0;
let running = 0;
let mostRunning = 0;
const progressSent: { job: string; task: string }[] = [];
/** The provider of the embed tests: a local server that answers the id it is asked for. */
let provider: Server;
let providerUrl = '';
const providerRequests: string[] = [];

const operations = [
    defineEmbedOperation({
        name: 'test.fetch',
        version: 1,
        description: 'Downloads an embed from the local provider',
        capability: 'cpu',
        binaries: [],
        downloads: true,
        options: Type.Object({ path: Type.String({ default: 'download.txt' }) }),
        outputs: { files: true, metadata: true },
        async run(context, options) {
            const { size } = await context.download(
                `${providerUrl}/files/${context.input.id}`,
                options.path,
            );
            context.output('download.txt', join(context.workdir, options.path), { role: 'main' });
            return { metadata: { size, limits: context.limits } };
        },
    }),
    defineEmbedOperation({
        name: 'test.embed',
        version: 1,
        description: 'Reads an embed from the local provider',
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: false, metadata: true },
        async run(context) {
            const response = await context.http(`${providerUrl}/videos/${context.input.id}`);
            const cached = await context.cache.get(context.input.id);
            await context.cache.set(context.input.id, 'seen', 60);
            return {
                metadata: {
                    kind: 'video',
                    mime: 'text/html',
                    duration: 12,
                    embed: {
                        provider: context.input.provider,
                        id: context.input.id,
                        url: context.input.url,
                    },
                    answer: await response.json(),
                    token: context.credentials?.['token'],
                    cached,
                },
            };
        },
    }),
    defineOperation({
        name: 'test.copy',
        version: 1,
        description: 'Copies its input',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: true, metadata: true },
        async run(context) {
            const path = join(context.workdir, 'copy.txt');
            await copyFile(context.input.path, path);
            context.progress(0.5);
            context.output('copy.txt', path, { mime: 'text/plain', role: 'main', thumbhash: HASH });
            return { metadata: { size: context.input.size, kind: context.input.kind } };
        },
    }),
    defineOperation({
        name: 'test.shout',
        version: 1,
        description: 'Upper-cases its input with a binary',
        accepts: { kinds: ['other'] },
        capability: 'cpu',
        binaries: ['node'],
        options: empty,
        outputs: { files: true, metadata: false },
        async run(context) {
            const { stdout } = await context.exec('node', [
                '-e',
                'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8").toUpperCase())',
                context.input.path,
            ]);
            const path = join(context.workdir, 'shout.txt');
            await writeFile(path, stdout);
            context.output('shout.txt', path);
            return {};
        },
    }),
    defineOperation({
        name: 'test.placeholder',
        version: 1,
        description: 'Gives its file a placeholder that is not a ThumbHash',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: true, metadata: false },
        async run(context) {
            const path = join(context.workdir, 'copy.txt');
            await copyFile(context.input.path, path);
            context.output('copy.txt', path, { thumbhash: 'not a "hash"' });
            return {};
        },
    }),
    defineOperation({
        name: 'test.video',
        version: 1,
        description: 'Only reads videos',
        accepts: { kinds: ['video'] },
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: false, metadata: true },
        run: async () => ({ metadata: {} }),
    }),
    defineOperation({
        name: 'test.fail',
        version: 1,
        description: 'Fails',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: false, metadata: true },
        run: async () => {
            throw new OperationError('input_unreadable', 'The input is broken.');
        },
    }),
    defineOperation({
        name: 'test.flaky',
        version: 1,
        description: 'Fails unexpectedly once',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: false, metadata: true },
        run: async () => {
            flakyRuns += 1;
            if (flakyRuns === 1) {
                throw new Error('ECONNRESET');
            }
            return { metadata: { runs: flakyRuns } };
        },
    }),
    defineOperation({
        name: 'test.wait',
        version: 1,
        description: 'Waits, or until it is stopped',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: Type.Object(
            { milliseconds: Type.Integer({ default: 10_000 }) },
            { additionalProperties: false },
        ),
        outputs: { files: false, metadata: true },
        async run(context, options) {
            running += 1;
            mostRunning = Math.max(mostRunning, running);
            try {
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, options.milliseconds);
                    context.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
            } finally {
                running -= 1;
            }
            return { metadata: {} };
        },
    }),
    defineOperation({
        name: 'test.slow',
        version: 1,
        description: 'Reports its progress for a few seconds',
        accepts: {},
        capability: 'cpu',
        binaries: [],
        options: empty,
        outputs: { files: false, metadata: true },
        async run(context) {
            for (const progress of [0.25, 0.5, 0.75]) {
                context.progress(progress);
                await new Promise((resolve) => setTimeout(resolve, 1100));
            }
            return { metadata: {} };
        },
    }),
];

let services: Awaited<ReturnType<typeof createTestServices>>;
let workers: TaskWorkers;
let project: Project;
let redis: NonNullable<Awaited<ReturnType<typeof createTestServices>>['redis']>;

async function waitForJob(projectId: string, id: string, timeout = 15_000): Promise<Job> {
    const deadline = Date.now() + timeout;
    for (;;) {
        const job = await services.jobs?.get(projectId, id);
        if (job !== undefined && ['completed', 'failed', 'canceled'].includes(job.status)) {
            return job;
        }
        if (Date.now() > deadline) {
            throw new Error(`Job ${id} is still ${job?.status} after ${timeout} ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function waitForTask(
    projectId: string,
    id: string,
    name: string,
    status: string,
): Promise<void> {
    const deadline = Date.now() + 10_000;
    while ((await services.jobs?.get(projectId, id))?.tasks[name]?.status !== status) {
        if (Date.now() > deadline) {
            throw new Error(`Task ${name} isn't ${status}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

/** Writes a text file to the project's temporary storage, as the input of a job. */
async function input(name: string, content: string, owner: Project = project) {
    const local = join(tmpdir(), `eclair-input-${Date.now()}-${name}`);
    await writeFile(local, content);
    await services.resolver.temporary.forProject(owner.id).write(`inputs/${name}`, local, {
        mime: 'text/plain',
        size: content.length,
        sha256: '',
    });
    return { storage: 'eclair', path: `inputs/${name}` };
}

describe.skipIf(!RUNS_WITH_REDIS)('workers', () => {
    beforeAll(async () => {
        // Fast retries for the tests.
        services = await createTestServices({
            operations: new OperationRegistry(operations, [testEmbedProvider]),
            queues: { attempts: 2, backoff: 50 },
        });
        redis = services.redis as NonNullable<typeof services.redis>;
        const cancel = new CancelBus(redis);
        services.scheduler?.onCancelRunning((taskIds) => cancel.publish(taskIds));
        if (services.scheduler === undefined || services.operations === undefined) {
            throw new Error('No scheduler.');
        }
        const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        workers = new TaskWorkers({
            connection: redis,
            queues: [{ name: 'cpu', concurrency: 4 }],
            runner: new TaskRunner({
                database: services.database,
                scheduler: services.scheduler,
                operations: services.operations,
                projects: services.projects,
                resolver: services.resolver,
                uploads: services.uploads,
                config: {
                    binaries: { node: process.execPath } as never,
                    tmpDir: services.limits.tmpDir,
                    taskTimeout: 60_000,
                    maxInputSize: 1024 ** 2,
                    tempRetention: 3_600_000,
                    tempMaxRetention: 7_200_000,
                    providerCredentials: { example: { token: 'operator' } },
                },
                worker: 'test-worker',
                logger,
                credentials: services.credentials,
                cache: redisOperationCache(redis),
                // The provider of the embed tests is a local server.
                guard: { allowHttp: true, allowPrivateAddresses: true },
                // Records the progress webhooks the runner asks for.
                webhooks: {
                    sendProgress: (job: JobRecord, task: string) => {
                        progressSent.push({ job: job.id, task });
                        return Promise.resolve();
                    },
                } as unknown as Webhooks,
            }),
            slots: new ProjectSlots(redis),
            cancel,
            projects: services.projects,
            logger,
            slotDelay: 50,
        });
        await workers.start();
        project = (await services.projects.create({ slug: 'niche' })).project;
        provider = createServer((request, response) => {
            if (request.url?.startsWith('/files/') === true) {
                const body = `downloaded ${request.url.slice('/files/'.length)}`;
                response.writeHead(200, { 'content-length': String(body.length) }).end(body);
                return;
            }
            providerRequests.push(request.url ?? '');
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ path: request.url }));
        });
        await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
        providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await workers?.close();
        await services?.close();
        await new Promise<void>((resolve) => provider?.close(() => resolve()));
    });

    it('downloads an embed for the tasks that read it, within the limits of the project', async () => {
        const jobs = services.jobs as NonNullable<Services['jobs']>;
        const owner = (
            await services.projects.create({
                slug: `downloads-${Date.now()}`,
                settings: {
                    embedProviders: ['example'],
                    embedDownload: ['example'],
                    embedMaxDuration: 600,
                },
            })
        ).project;
        const request = (options: Record<string, unknown> = {}) => ({
            input: { embed: 'https://video.example.com/abc' },
            output: { storage: 'eclair', prefix: 'imports/' },
            tasks: {
                download: { op: 'test.fetch', options },
                shout: { op: 'test.shout', from: 'download' },
            },
        });
        const done = await waitForJob(owner.id, (await jobs.create(owner, request())).job.id);
        expect(done).toMatchObject({
            status: 'completed',
            tasks: {
                download: {
                    status: 'completed',
                    outputs: {
                        metadata: {
                            size: 14,
                            limits: { maxSize: 1024 ** 2, maxDuration: 600 },
                        },
                        files: [{ name: 'download.txt', path: 'imports/download/download.txt' }],
                    },
                },
                shout: { status: 'completed' },
            },
        });
        const shouted = join(services.temporaryRoot, owner.id, 'imports', 'shout', 'shout.txt');
        expect(await readFile(shouted, 'utf8')).toBe('DOWNLOADED ABC');
        const usage = await services.database.kysely
            .selectFrom('usage')
            .select(['operation', 'bytes_in'])
            .where('job_id', '=', done.id)
            .execute();
        expect(usage).toContainEqual({ operation: 'test.fetch@1', bytes_in: 14 });

        // Outside its work directory, or larger than the project's limit: refused.
        const escaped = await waitForJob(
            owner.id,
            (await jobs.create(owner, request({ path: '../escape.txt' }))).job.id,
        );
        expect(escaped.tasks['download']?.error?.code).toBe('operation_failed');
        await services.projects.update(owner.id, { settings: { maxInputSize: 10 } });
        const limited = await waitForJob(owner.id, (await jobs.create(owner, request())).job.id);
        expect(limited.tasks['download']?.error?.code).toBe('limit_exceeded');
    });

    it("runs an embed task without fetching the embed, with the project's credentials and cache", async () => {
        const jobs = services.jobs as NonNullable<Services['jobs']>;
        const owner = (
            await services.projects.create({
                slug: `embeds-${Date.now()}`,
                settings: { embedProviders: ['example'] },
            })
        ).project;
        const request = {
            input: { embed: 'https://video.example.com/abc' },
            tasks: { probe: { op: 'test.embed' } },
        };

        const first = await waitForJob(owner.id, (await jobs.create(owner, request)).job.id);
        expect(first).toMatchObject({
            status: 'completed',
            tasks: {
                probe: {
                    status: 'completed',
                    outputs: {
                        metadata: {
                            kind: 'video',
                            embed: {
                                provider: 'example',
                                id: 'abc',
                                url: 'https://video.example.com/abc',
                            },
                            answer: { path: '/videos/abc' },
                            // No credentials of its own: the operator's.
                            token: 'operator',
                        },
                    },
                },
            },
        });
        expect(first.tasks['probe']?.outputs?.metadata).not.toHaveProperty('cached');
        // The page itself was never requested: only the provider, once.
        expect(providerRequests).toEqual(['/videos/abc']);

        await services.credentials.set(owner.id, 'example', { token: 'project' });
        const second = await waitForJob(owner.id, (await jobs.create(owner, request)).job.id);
        expect(second.tasks['probe']?.outputs?.metadata).toMatchObject({
            token: 'project',
            cached: 'seen',
        });

        // Another project has its own cache.
        const other = (
            await services.projects.create({
                slug: `embeds-other-${Date.now()}`,
                settings: { embedProviders: ['example'] },
            })
        ).project;
        const third = await waitForJob(other.id, (await jobs.create(other, request)).job.id);
        expect(third.tasks['probe']?.outputs?.metadata).not.toHaveProperty('cached');

        const usage = await services.database.kysely
            .selectFrom('usage')
            .selectAll()
            .where('project_id', '=', owner.id)
            .execute();
        // PostgreSQL gives 64-bit integers as strings.
        expect(usage.map(({ media_ms, bytes_in }) => [Number(media_ms), Number(bytes_in)])).toEqual(
            [
                [12_000, 0],
                [12_000, 0],
            ],
        );
    });

    it('runs a pipeline, with an intermediate output, and records it all', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('hello.txt', 'hello'),
            output: { storage: 'eclair', prefix: 'out/' },
            tasks: {
                copy: { op: 'test.copy', keep: false },
                shout: { op: 'test.shout', from: 'copy' },
            },
        });
        const done = await waitForJob(project.id, job.id);
        expect(done).toMatchObject({
            status: 'completed',
            tasks: {
                copy: {
                    status: 'completed',
                    attempts: 1,
                    outputs: { metadata: { size: 5, kind: 'other' } },
                },
                shout: {
                    status: 'completed',
                    outputs: {
                        files: [{ name: 'shout.txt', path: 'out/shout/shout.txt', size: 5 }],
                    },
                },
            },
        });
        expect(done.startedAt).toBeDefined();
        expect(done.tasks['shout']?.outputs?.files?.[0]).not.toHaveProperty('thumbhash');
        expect(done.tasks['copy']?.outputs?.files?.[0]).toMatchObject({
            path: `jobs/${job.id}/copy/copy.txt`,
            role: 'main',
            mime: 'text/plain',
            checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
            thumbhash: HASH,
            expiresAt: expect.any(String),
            // A local temporary storage: a signed link on ECLAIR_PUBLIC_URL.
            url: expect.stringMatching(/^https:\/\/eclair\.test\/v1\/files\/[\w-]+\.[\w-]+$/),
        });

        const stored = join(services.temporaryRoot, project.id, 'out', 'shout', 'shout.txt');
        expect(await readFile(stored, 'utf8')).toBe('HELLO');

        const usage = await services.database.kysely
            .selectFrom('usage')
            .selectAll()
            .where('job_id', '=', job.id)
            .execute();
        expect(usage).toHaveLength(2);
    });

    it('sends the progress of a task, throttled, to a project that subscribes', async () => {
        const subscribed = (
            await services.projects.create({
                slug: 'progress',
                settings: { progressWebhooks: true, progressWebhookInterval: 1000 },
            })
        ).project;
        const jobs = services.jobs as NonNullable<Services['jobs']>;
        const { job } = await jobs.create(subscribed, {
            input: await input('slow.txt', 'slow', subscribed),
            tasks: { slow: { op: 'test.slow' } },
        });
        const other = await jobs.create(project, {
            input: await input('slow.txt', 'slow'),
            tasks: { slow: { op: 'test.slow' } },
        });

        await waitForJob(subscribed.id, job.id);
        await waitForJob(project.id, other.job.id);
        // The first progress comes before the interval: the second and the third go out.
        expect(progressSent.filter((sent) => sent.job === job.id)).toEqual([
            { job: job.id, task: 'slow' },
            { job: job.id, task: 'slow' },
        ]);
        expect(progressSent.filter((sent) => sent.job === other.job.id)).toEqual([]);
    });

    it('fails a task with its error, and the tasks after it', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('a.txt', 'a'),
            tasks: {
                broken: { op: 'test.fail' },
                after: { op: 'test.copy', after: ['broken'], keep: false },
            },
        });
        const done = await waitForJob(project.id, job.id);
        expect(done).toMatchObject({
            status: 'failed',
            tasks: {
                broken: {
                    status: 'failed',
                    attempts: 1,
                    error: { code: 'input_unreadable', message: 'The input is broken.' },
                },
                after: { status: 'failed', error: { code: 'dependency_failed' } },
            },
        });
    });

    it('fails a task that gives a file a placeholder that is not a ThumbHash', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('b.txt', 'b'),
            tasks: { placeholder: { op: 'test.placeholder', keep: false } },
        });
        const done = await waitForJob(project.id, job.id);
        expect(done.tasks['placeholder']).toMatchObject({
            status: 'failed',
            error: { code: 'operation_failed' },
        });
    });

    it('refuses an input the operation does not read, and skips a task whose condition is not met', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('b.txt', 'b'),
            tasks: {
                video: { op: 'test.video' },
                skipped: { op: 'test.copy', when: { kind: ['video'] }, keep: false },
            },
        });
        const done = await waitForJob(project.id, job.id);
        expect(done.tasks['video']).toMatchObject({
            status: 'failed',
            error: {
                code: 'unsupported_input',
                message: "test.video@1 doesn't read application/octet-stream files.",
            },
        });
        expect(done.tasks['skipped']?.status).toBe('skipped');
    });

    it('retries a task that failed unexpectedly', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('c.txt', 'c'),
            tasks: { flaky: { op: 'test.flaky' } },
        });
        const done = await waitForJob(project.id, job.id);
        expect(done.tasks['flaky']).toMatchObject({
            status: 'completed',
            attempts: 2,
            outputs: { metadata: { runs: 2 } },
        });
        expect(done.tasks['flaky']).not.toHaveProperty('error');
    });

    it('stops a running task when its job is canceled', async () => {
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(project, {
            input: await input('d.txt', 'd'),
            tasks: { wait: { op: 'test.wait' } },
        });
        await waitForTask(project.id, job.id, 'wait', 'running');
        await services.jobs?.cancel(project.id, job.id);
        const deadline = Date.now() + 5000;
        while (
            (await services.jobs?.get(project.id, job.id))?.tasks['wait']?.status !== 'canceled'
        ) {
            expect(Date.now()).toBeLessThan(deadline);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect((await services.jobs?.get(project.id, job.id))?.status).toBe('canceled');
    });

    it("stops a task at the project's time limit", async () => {
        const slow = (
            await services.projects.create({ slug: 'slow', settings: { taskTimeout: 1000 } })
        ).project;
        const previous = project;
        project = slow;
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(slow, {
            input: await input('e.txt', 'e'),
            tasks: { wait: { op: 'test.wait' } },
        });
        project = previous;
        const done = await waitForJob(slow.id, job.id);
        expect(done.tasks['wait']).toMatchObject({ status: 'failed', error: { code: 'timeout' } });
    });

    it('runs no more tasks of a project at once than its concurrency', async () => {
        const narrow = (
            await services.projects.create({ slug: 'narrow', settings: { concurrency: 1 } })
        ).project;
        const previous = project;
        project = narrow;
        running = 0;
        mostRunning = 0;
        const { job } = await (services.jobs as NonNullable<Services['jobs']>).create(narrow, {
            input: await input('f.txt', 'f'),
            tasks: {
                a: { op: 'test.wait', options: { milliseconds: 200 } },
                b: { op: 'test.wait', options: { milliseconds: 200 } },
                c: { op: 'test.wait', options: { milliseconds: 200 } },
            },
        });
        project = previous;
        const done = await waitForJob(narrow.id, job.id);
        expect(done.status).toBe('completed');
        expect(mostRunning).toBe(1);
    });
});

describe.skipIf(!RUNS_WITH_REDIS)('ProjectSlots', () => {
    it('limits, keeps, releases and expires slots', async () => {
        const connection = createRedis(testRedisUrl() ?? '', 'eclair-test-slots');
        try {
            const slots = new ProjectSlots(connection, 200);
            const project = `prj_slots_${Date.now()}`;
            expect(await slots.acquire(project, 'tsk_1', 2)).toBe(true);
            expect(await slots.acquire(project, 'tsk_2', 2)).toBe(true);
            expect(await slots.acquire(project, 'tsk_3', 2)).toBe(false);
            // A task that has a slot keeps it.
            expect(await slots.acquire(project, 'tsk_1', 2)).toBe(true);
            await slots.release(project, 'tsk_2');
            expect(await slots.acquire(project, 'tsk_3', 2)).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 250));
            expect(await slots.count(project)).toBe(0);
        } finally {
            connection.disconnect();
        }
    });
});
