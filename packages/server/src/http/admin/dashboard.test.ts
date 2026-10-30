import type { FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';
import type {
    AdminJob,
    Job,
    JobRequest,
    ServerStatus,
    Stats,
    StorageCheck,
} from '@eclair-js/protocol';

import { toJson } from '../../database/values.ts';
import { HostRegistry } from '../../hosts.ts';
import { createId } from '../../ids.ts';
import { TaskQueues } from '../../jobs/queues.ts';
import { testRegistry } from '../../jobs/testing.ts';
import type { Project } from '../../projects/projects.ts';
import { RUNS_WITH_REDIS, createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';
import type { AppOptions } from '../app.ts';

const ADMIN_TOKEN = 'admin-'.repeat(8);

function inject(app: FastifyInstance, method: 'GET' | 'POST', url: string) {
    return app.inject({
        method,
        url: `/admin/v1${url}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
}

describe('/admin/v1 for the dashboard', () => {
    let services: Awaited<ReturnType<typeof createTestServices>>;
    let app: FastifyInstance;
    const admin = (method: 'GET' | 'POST', url: string) => inject(app, method, url);

    beforeAll(async () => {
        services = await createTestServices();
        app = buildApp({
            version: 'test',
            services,
            adminToken: ADMIN_TOKEN,
            checks: [
                { name: 'database', check: () => services.database.ping() },
                {
                    name: 'binaries',
                    check: () => Promise.reject(new Error('no ffmpeg at /secret/path')),
                },
            ],
        });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await services.close();
    });

    describe('GET /status', () => {
        it('has the checks of /ready, every queue and the temporary storage', async () => {
            mkdirSync(join(services.temporaryRoot, 'prj_x'), { recursive: true });
            writeFileSync(join(services.temporaryRoot, 'prj_x', 'a.bin'), Buffer.alloc(1000));

            const response = await admin('GET', '/status');
            expect(response.statusCode).toBe(200);
            const status = response.json<ServerStatus>();
            expect(validate('ServerStatus', status).valid).toBe(true);
            expect(status).toMatchObject({
                version: 'test',
                ready: false,
                checks: { database: 'ok', binaries: 'failed' },
                // Without Redis, no host is known and no worker serves a queue.
                hosts: [],
                tempStorage: { kind: 'local', files: 1, bytes: 1000 },
            });
            expect(response.body).not.toContain('/secret/path');
            expect(status.tempStorage?.freeBytes).toBeGreaterThan(0);
            expect(status.queues.map(({ name }) => name)).toEqual([
                'cpu',
                'video',
                'gpu',
                'ai',
                'probe',
            ]);
            expect(status.queues[0]).toEqual({
                name: 'cpu',
                waiting: 0,
                active: 0,
                slots: 0,
                oldestWaitingAt: null,
            });
        });
    });

    describe('GET /stats', () => {
        const at = (time: string) => new Date(`2026-01-01T${time}Z`);

        async function insertJob(projectId: string, createdAt: Date) {
            const id = createId('job');
            await services.database.kysely
                .insertInto('jobs')
                .values({
                    id,
                    project_id: projectId,
                    status: 'running',
                    priority: 'normal',
                    input: toJson({ url: 'https://cdn.example.com/a.mp4' }),
                    metadata: toJson({}),
                    fail_fast: false,
                    created_at: createdAt,
                    updated_at: createdAt,
                })
                .execute();
            return id;
        }

        async function insertTask(
            jobId: string,
            projectId: string,
            operation: string,
            status: string,
            startedAt: Date | null,
            endedAt: Date | null,
        ) {
            await services.database.kysely
                .insertInto('tasks')
                .values({
                    id: createId('task'),
                    job_id: jobId,
                    project_id: projectId,
                    name: createId('task').slice(-12).toLowerCase(),
                    operation,
                    operation_version: 1,
                    queue: 'cpu',
                    options: toJson({}),
                    dependencies: toJson({ all: [], after: [] }),
                    keep: true,
                    status,
                    attempts: 1,
                    started_at: startedAt,
                    ended_at: endedAt,
                    created_at: at('00:00:00'),
                    updated_at: at('00:00:00'),
                })
                .execute();
        }

        async function insertDelivery(
            jobId: string,
            projectId: string,
            status: string,
            createdAt: Date,
        ) {
            await services.database.kysely
                .insertInto('webhook_deliveries')
                .values({
                    id: createId('delivery'),
                    project_id: projectId,
                    job_id: jobId,
                    event: 'job.completed',
                    url: 'https://app.example.com/hook',
                    status,
                    attempts: 1,
                    created_at: createdAt,
                    updated_at: createdAt,
                })
                .execute();
        }

        beforeAll(async () => {
            const a = (await services.projects.create({ slug: 'stats-a' })).project.id;
            const b = (await services.projects.create({ slug: 'stats-b' })).project.id;
            const jobA = await insertJob(a, at('10:15:00'));
            const jobB = await insertJob(b, new Date('2025-12-31T23:00:00Z'));
            await insertTask(jobA, a, 'probe', 'completed', at('10:00:00'), at('10:00:02'));
            await insertTask(jobA, a, 'probe', 'completed', at('10:30:00'), at('10:30:04'));
            await insertTask(jobA, a, 'probe', 'completed', at('11:00:00'), at('11:00:10'));
            await insertTask(jobA, a, 'video.transcode', 'failed', at('11:10:00'), at('11:10:05'));
            await insertTask(jobA, a, 'video.transcode', 'canceled', null, at('11:20:00'));
            await insertTask(jobA, a, 'probe', 'skipped', null, at('11:30:00'));
            await insertTask(
                jobA,
                a,
                'probe',
                'completed',
                new Date('2026-01-02T00:59:00Z'),
                new Date('2026-01-02T01:00:00Z'),
            );
            await insertTask(jobA, a, 'probe', 'running', at('11:40:00'), null);
            await insertTask(
                jobB,
                b,
                'video.transcode',
                'completed',
                at('12:00:00'),
                at('12:01:00'),
            );
            await insertDelivery(jobA, a, 'delivered', at('10:20:00'));
            await insertDelivery(jobA, a, 'failed', at('10:21:00'));
            await insertDelivery(jobA, a, 'pending', at('10:22:00'));
            await insertDelivery(jobB, b, 'delivered', new Date('2025-12-31T23:30:00Z'));
        });

        it('counts the tasks per hour, the operations, the webhooks and the jobs', async () => {
            const response = await admin(
                'GET',
                '/stats?since=2026-01-01T00:00:00Z&until=2026-01-02T00:00:00Z',
            );
            expect(response.statusCode).toBe(200);
            const stats = response.json<Stats>();
            expect(validate('Stats', stats).valid).toBe(true);
            expect(stats).toMatchObject({
                since: '2026-01-01T00:00:00.000Z',
                until: '2026-01-02T00:00:00.000Z',
                interval: 'hour',
                operations: [
                    { name: 'probe', completed: 3, failed: 0, p50: 4, p95: 10 },
                    { name: 'video.transcode', completed: 1, failed: 1, p50: 60, p95: 60 },
                ],
                webhooks: { delivered: 1, pending: 1, failed: 1 },
                jobs: { created: 1 },
            });
            expect(stats.tasks).toHaveLength(24);
            expect(stats.tasks[0]).toEqual({
                start: '2026-01-01T00:00:00.000Z',
                completed: 0,
                failed: 0,
                canceled: 0,
                skipped: 0,
            });
            expect(stats.tasks.slice(10, 13)).toEqual([
                {
                    start: '2026-01-01T10:00:00.000Z',
                    completed: 2,
                    failed: 0,
                    canceled: 0,
                    skipped: 0,
                },
                {
                    start: '2026-01-01T11:00:00.000Z',
                    completed: 1,
                    failed: 1,
                    canceled: 1,
                    skipped: 1,
                },
                {
                    start: '2026-01-01T12:00:00.000Z',
                    completed: 1,
                    failed: 0,
                    canceled: 0,
                    skipped: 0,
                },
            ]);
        });

        it('counts per day, and for one project', async () => {
            const days = (
                await admin(
                    'GET',
                    '/stats?since=2026-01-01T00:00:00Z&until=2026-01-03T00:00:00Z&interval=day',
                )
            ).json<Stats>();
            expect(days.tasks.map(({ start, completed }) => [start, completed])).toEqual([
                ['2026-01-01T00:00:00.000Z', 4],
                ['2026-01-02T00:00:00.000Z', 1],
            ]);

            const project = (
                await admin(
                    'GET',
                    '/stats?project=stats-b&since=2026-01-01T00:00:00Z&until=2026-01-02T00:00:00Z',
                )
            ).json<Stats>();
            expect(project).toMatchObject({
                operations: [
                    { name: 'video.transcode', completed: 1, failed: 0, p50: 60, p95: 60 },
                ],
                webhooks: { delivered: 0, pending: 0, failed: 0 },
                jobs: { created: 0 },
            });
        });

        it('covers the last 24 hours by default', async () => {
            const stats = (await admin('GET', '/stats')).json<Stats>();
            expect(new Date(stats.until).getTime() - new Date(stats.since).getTime()).toBe(
                24 * 3_600_000,
            );
            expect(stats.tasks.length).toBeGreaterThanOrEqual(24);
            expect(stats.jobs.created).toBe(0);
        });

        it('checks the query', async () => {
            const invalid = async (query: string) => {
                const response = await admin('GET', `/stats?${query}`);
                expect(response.statusCode).toBe(422);
                return Object.keys(response.json<{ errors: object }>().errors);
            };
            expect(await invalid('interval=week')).toEqual(['?interval']);
            expect(await invalid('since=yesterday')).toEqual(['?since']);
            expect(await invalid('since=2026-01-02T00:00:00Z&until=2026-01-01T00:00:00Z')).toEqual([
                '?since',
            ]);
            expect(await invalid('since=2026-01-01T00:00:00Z&until=2026-03-01T00:00:00Z')).toEqual([
                '?since',
            ]);
            expect(
                (
                    await admin(
                        'GET',
                        '/stats?since=2026-01-01T00:00:00Z&until=2026-03-01T00:00:00Z&interval=day',
                    )
                ).statusCode,
            ).toBe(200);
            expect((await admin('GET', '/stats?project=nobody')).statusCode).toBe(404);
        });
    });

    describe('POST /projects/{project}/storages/{storage}/check', () => {
        let receiver: Server;
        let base: string;
        let answer = 404;
        const paths: string[] = [];

        beforeAll(async () => {
            await services.projects.create({ slug: 'checked' });
            receiver = createServer((request, response) => {
                paths.push(`${request.method} ${request.url}`);
                response.writeHead(answer).end('');
            });
            await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
            base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
        });

        afterAll(async () => {
            await new Promise<void>((resolve) => receiver.close(() => resolve()));
        });

        it('only reads an http storage: a missing file must answer 404', async () => {
            await services.storages.set('checked', 'app', 'http', { url: `${base}/eclair` });
            const response = await admin('POST', '/projects/checked/storages/app/check');
            expect(response.statusCode).toBe(200);
            const check = response.json<StorageCheck>();
            expect(validate('StorageCheck', check).valid).toBe(true);
            expect(check).toMatchObject({ ok: true, read: 'ok', write: 'skipped' });
            expect(paths.at(-1)).toMatch(/^GET \/eclair\/\.eclair\/check-[0-9a-f]+\.txt$/);

            answer = 200;
            const wrong = (
                await admin('POST', '/projects/checked/storages/app/check')
            ).json<StorageCheck>();
            expect(wrong).toMatchObject({ ok: false, read: 'failed', write: 'skipped' });
            expect(wrong.message).toContain('404');

            answer = 500;
            const failing = (
                await admin('POST', '/projects/checked/storages/app/check')
            ).json<StorageCheck>();
            expect(failing).toMatchObject({ ok: false, read: 'failed' });
            expect(failing.message).toContain('500');
        });

        it('says why an s3 storage fails, without its credentials', async () => {
            await services.storages.set('checked', 'closed', 's3', {
                bucket: 'checked-bucket',
                endpoint: 'http://127.0.0.1:1',
                accessKeyId: 'AKIA-CHECK-ID',
                secretAccessKey: 'check-secret-key',
                forcePathStyle: true,
            });
            const response = await admin('POST', '/projects/checked/storages/closed/check');
            expect(response.statusCode).toBe(200);
            const check = response.json<StorageCheck>();
            expect(validate('StorageCheck', check).valid).toBe(true);
            expect(check).toMatchObject({ ok: false, write: 'failed', read: 'skipped' });
            expect(check.message).toMatch(/Could not write \.eclair\/check-/);
            expect(response.body).not.toContain('check-secret-key');
            expect(response.body).not.toContain('AKIA-CHECK-ID');
        }, 30_000);

        it.runIf(process.env['ECLAIR_TEST_S3_ENDPOINT'] !== undefined)(
            'writes, reads back and deletes a file in an s3 storage',
            async () => {
                await services.storages.set('checked', 'bucket', 's3', {
                    bucket: process.env['ECLAIR_TEST_S3_BUCKET'] ?? 'eclair-test',
                    endpoint: process.env['ECLAIR_TEST_S3_ENDPOINT'],
                    prefix: `check-${Date.now()}/`,
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    forcePathStyle: true,
                });
                const check = (
                    await admin('POST', '/projects/checked/storages/bucket/check')
                ).json<StorageCheck>();
                expect(check).toMatchObject({ ok: true, write: 'ok', read: 'ok' });
                expect(check).not.toHaveProperty('message');
            },
        );

        it('answers 404 for an unknown project or storage', async () => {
            expect((await admin('POST', '/projects/checked/storages/none/check')).statusCode).toBe(
                404,
            );
            expect((await admin('POST', '/projects/nobody/storages/app/check')).statusCode).toBe(
                404,
            );
        });
    });
});

describe.skipIf(!RUNS_WITH_REDIS)('/admin/v1 jobs and live status', () => {
    let services: Awaited<ReturnType<typeof createTestServices>>;
    let app: FastifyInstance;
    let hosts: HostRegistry;
    let queues: TaskQueues;
    const created: Job[] = [];
    const admin = (method: 'GET' | 'POST', url: string) => inject(app, method, url);

    const body = {
        input: { url: 'https://cdn.example.com/a.mp4' },
        output: { storage: 'eclair', prefix: 'videos/' },
    };

    beforeAll(async () => {
        services = await createTestServices({ operations: testRegistry(), queues: true });
        const redis = services.redis;
        const jobs = services.jobs;
        if (redis === undefined || jobs === undefined) {
            throw new Error('The test needs Redis.');
        }
        const niche = (await services.projects.create({ slug: 'niche' })).project;
        const other = (await services.projects.create({ slug: 'other' })).project;
        for (const [project, request] of [
            [
                niche,
                {
                    ...body,
                    tasks: {
                        probe: { op: 'probe' },
                        h264: { op: 'video.transcode', after: ['probe'] },
                    },
                    metadata: { mediaId: 1 },
                },
            ],
            [other, { ...body, tasks: { probe: { op: 'probe' } }, metadata: { mediaId: 1 } }],
            [niche, { ...body, tasks: { probe: { op: 'probe' } }, metadata: { mediaId: 2 } }],
        ] as [Project, JobRequest][]) {
            created.push((await jobs.create(project, request)).job);
        }

        hosts = new HostRegistry(redis, 'dashboard-test', 30_000, {
            version: '9.9.9',
            queues: [{ name: 'probe', concurrency: 2 }],
        });
        await hosts.register();
        queues = new TaskQueues(redis);
        const options: AppOptions = {
            version: 'test',
            services,
            adminToken: ADMIN_TOKEN,
            hosts,
            queues,
        };
        app = buildApp(options);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await hosts.stop();
        await services.redis?.zrem('eclair:hosts', 'dashboard-test');
        await queues.close();
        await services.close();
    });

    const ids = (jobs: { id: string }[]) => jobs.map(({ id }) => id);
    const first = () => created[0]?.id ?? '';
    const second = () => created[1]?.id ?? '';
    const third = () => created[2]?.id ?? '';

    it('lists the jobs of every project, newest first, with their project', async () => {
        const response = await admin('GET', '/jobs');
        expect(response.statusCode).toBe(200);
        const list = response.json<{ data: AdminJob[]; nextCursor: string | null }>();
        expect(validate('AdminJobList', list).valid).toBe(true);
        expect(ids(list.data)).toEqual([third(), second(), first()]);
        expect(list.data.map(({ project }) => project)).toEqual(['niche', 'other', 'niche']);
        expect(list.nextCursor).toBeNull();
        // The job as /v1 shows it, with its project.
        const { project, ...job } = list.data[2] ?? ({} as AdminJob);
        expect(project).toBe('niche');
        const niche = await services.projects.get('niche');
        expect(job).toEqual(await services.jobs?.get(niche.id, first()));
    });

    it('filters by project, operation, status, dates and metadata, a page at a time', async () => {
        const list = async (query: string) =>
            ids((await admin('GET', `/jobs?${query}`)).json<{ data: AdminJob[] }>().data);
        expect(await list('project=other')).toEqual([second()]);
        expect(await list('operation=video.transcode')).toEqual([first()]);
        expect(await list('metadata[mediaId]=1')).toEqual([second(), first()]);
        expect(await list('project=niche&metadata[mediaId]=1')).toEqual([first()]);
        expect(await list('status=completed,failed')).toEqual([]);
        expect(await list('createdBefore=2020-01-01T00:00:00Z')).toEqual([]);
        expect(
            await list('createdAfter=2020-01-01T00:00:00Z&createdBefore=2100-01-01T00:00:00Z'),
        ).toHaveLength(3);

        const page = (await admin('GET', '/jobs?limit=2')).json<{
            data: AdminJob[];
            nextCursor: string;
        }>();
        expect(ids(page.data)).toEqual([third(), second()]);
        expect(await list(`limit=2&cursor=${page.nextCursor}`)).toEqual([first()]);

        expect((await admin('GET', '/jobs?project=nobody')).statusCode).toBe(404);
        const invalid = await admin('GET', '/jobs?status=lost&createdBefore=never&limit=0');
        expect(invalid.statusCode).toBe(422);
        expect(Object.keys(invalid.json<{ errors: object }>().errors).sort()).toEqual([
            '?createdBefore',
            '?status',
        ]);
    });

    it('shows, cancels and retries any project’s job', async () => {
        const read = await admin('GET', `/jobs/${second()}`);
        expect(read.statusCode).toBe(200);
        expect(validate('AdminJob', read.json()).valid).toBe(true);
        expect(read.json()).toMatchObject({ id: second(), project: 'other' });
        expect((await admin('GET', `/jobs/${createId('job')}`)).statusCode).toBe(404);
        expect((await admin('GET', '/jobs/not-an-id')).statusCode).toBe(404);

        const canceled = await admin('POST', `/jobs/${third()}/cancel`);
        expect(canceled.statusCode).toBe(200);
        expect(canceled.json()).toMatchObject({ project: 'niche', status: 'canceled' });

        const retried = await admin('POST', `/jobs/${third()}/retry`);
        expect(retried.statusCode).toBe(200);
        expect(validate('AdminJob', retried.json()).valid).toBe(true);
        expect(retried.json<AdminJob>().status).not.toBe('canceled');

        expect((await admin('POST', `/jobs/${first()}/retry`)).statusCode).toBe(409);
        expect((await admin('POST', `/jobs/${createId('job')}/cancel`)).statusCode).toBe(404);
    });

    it("lists a job's webhooks, newest first, with the task of task events", async () => {
        const jobId = second();
        await services.database.kysely
            .updateTable('jobs')
            .set({ webhook_url: 'https://app.example.com/hook' })
            .where('id', '=', jobId)
            .execute();
        const record = await services.scheduler?.loadJob(jobId);
        if (record === undefined) {
            throw new Error('No job.');
        }
        // Nothing sends them in this test: they stay pending.
        await services.webhooks?.send(record, 'job.completed');
        await services.webhooks?.send(record, 'task.completed', 'probe');

        const response = await admin('GET', `/jobs/${jobId}/deliveries`);
        expect(response.statusCode).toBe(200);
        const list = response.json<{ data: unknown[] }>();
        expect(validate('WebhookDeliveryList', list).valid).toBe(true);
        expect(list.data).toMatchObject([
            {
                event: 'task.completed',
                task: 'probe',
                url: 'https://app.example.com/hook',
                status: 'pending',
                attempts: 0,
                responseStatus: null,
                deliveredAt: null,
            },
            { event: 'job.completed', task: null, status: 'pending' },
        ]);

        expect((await admin('GET', `/jobs/${first()}/deliveries`)).json()).toEqual({ data: [] });
        expect((await admin('GET', `/jobs/${createId('job')}/deliveries`)).statusCode).toBe(404);
    });

    it('shows the live hosts, and each queue’s tasks and slots', async () => {
        const response = await admin('GET', '/status');
        expect(response.statusCode).toBe(200);
        const status = response.json<ServerStatus>();
        expect(validate('ServerStatus', status).valid).toBe(true);
        expect(status.hosts).toContainEqual({
            name: 'dashboard-test',
            version: '9.9.9',
            queues: [{ name: 'probe', concurrency: 2 }],
            seenAt: expect.any(String),
        });

        const queued = await services.database.kysely
            .selectFrom('tasks')
            .select(['queue', 'queued_at'])
            .where('status', '=', 'queued')
            .execute();
        const probe = status.queues.find(({ name }) => name === 'probe');
        expect(probe?.waiting).toBe(queued.filter(({ queue }) => queue === 'probe').length);
        expect(probe?.waiting).toBeGreaterThan(0);
        expect(probe?.active).toBe(0);
        expect(probe?.oldestWaitingAt).not.toBeNull();
        // Slots are summed over the live hosts: other test files may have left some.
        expect(probe?.slots).toBe(
            status.hosts
                .flatMap(({ queues }) => queues)
                .filter(({ name }) => name === 'probe')
                .reduce((sum, { concurrency }) => sum + concurrency, 0),
        );
        expect(probe?.slots).toBeGreaterThanOrEqual(2);
        // The transcode waits for its probe: nothing is queued for video.
        expect(status.queues.find(({ name }) => name === 'video')).toMatchObject({
            waiting: 0,
            oldestWaitingAt: null,
        });
    });
});
