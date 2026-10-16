import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createId } from '../ids.ts';
import { testRegistry } from '../jobs/testing.ts';
import type { Project } from '../projects/projects.ts';
import { RUNS_WITH_REDIS, createTestServices } from '../testing.ts';
import { Maintenance } from './maintenance.ts';

let services: Awaited<ReturnType<typeof createTestServices>>;
let maintenance: Maintenance;
let project: Project;
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const DAY = 24 * 3_600_000;

describe.skipIf(!RUNS_WITH_REDIS)('Maintenance', () => {
    beforeAll(async () => {
        services = await createTestServices({ operations: testRegistry(), queues: true });
        if (services.redis === undefined || services.scheduler === undefined) {
            throw new Error('No Redis.');
        }
        maintenance = new Maintenance({
            database: services.database,
            redis: services.redis,
            queues: services.scheduler.queues,
            projects: services.projects,
            uploads: services.uploads,
            temporary: services.resolver.temporary,
            logger: silent,
            jobRetention: 30 * DAY,
            lostAfter: 1000,
        });
        project = (await services.projects.create({ slug: 'niche' })).project;
    });

    afterAll(async () => {
        await services?.close();
    });

    /** A job with one task that wrote a file to the temporary storage. */
    async function jobWithFile(options: { keep: boolean; ended: Date | null; expiresAt: Date }) {
        const { job } = await (services.jobs as NonNullable<typeof services.jobs>).create(project, {
            input: { url: 'https://cdn.example.com/a.mp4' },
            output: { storage: 'eclair' },
            tasks: { h264: { op: 'video.transcode', keep: options.keep } },
        });
        const [task] = await (
            services.scheduler as NonNullable<typeof services.scheduler>
        ).loadTasks(job.id);
        const path = `jobs/${job.id}/h264/out.mp4`;
        const local = join(tmpdir(), `eclair-maintenance-${job.id}`);
        writeFileSync(local, 'video');
        await services.resolver.temporary
            .forProject(project.id)
            .write(path, local, { mime: 'video/mp4', size: 5, sha256: '' });
        await services.database.kysely
            .insertInto('outputs')
            .values({
                id: createId('output'),
                task_id: task?.id ?? '',
                job_id: job.id,
                project_id: project.id,
                kind: 'file',
                name: 'out.mp4',
                storage: 'eclair',
                path,
                size: 5,
                expires_at: options.expiresAt,
                expired: false,
                created_at: new Date(),
            })
            .execute();
        await services.database.kysely
            .updateTable('jobs')
            .set({
                status: options.ended === null ? 'running' : 'completed',
                ended_at: options.ended,
            })
            .where('id', '=', job.id)
            .execute();
        return { job, file: join(services.temporaryRoot, project.id, path) };
    }

    it('expires the files of the temporary storage', async () => {
        const { job, file } = await jobWithFile({
            keep: true,
            ended: null,
            expiresAt: new Date(Date.now() - 1000),
        });
        const report = await maintenance.run();
        expect(report.expiredOutputs).toBeGreaterThanOrEqual(1);
        expect(existsSync(file)).toBe(false);
        const files = await services.jobs?.files(project.id, job.id, { limit: 10 });
        expect(files?.data[0]).toMatchObject({ expired: true });
        expect(files?.data[0]).not.toHaveProperty('url');
    });

    it('deletes the intermediate files of an ended job', async () => {
        const kept = await jobWithFile({
            keep: true,
            ended: new Date(),
            expiresAt: new Date(Date.now() + DAY),
        });
        const intermediate = await jobWithFile({
            keep: false,
            ended: new Date(),
            expiresAt: new Date(Date.now() + DAY),
        });
        const running = await jobWithFile({
            keep: false,
            ended: null,
            expiresAt: new Date(Date.now() + DAY),
        });
        await maintenance.run();
        expect(existsSync(intermediate.file)).toBe(false);
        expect(existsSync(kept.file)).toBe(true);
        expect(existsSync(running.file)).toBe(true);
    });

    it('prunes the jobs older than the retention, and keeps their usage', async () => {
        const old = await jobWithFile({
            keep: true,
            ended: new Date(Date.now() - 31 * DAY),
            expiresAt: new Date(Date.now() + DAY),
        });
        await services.database.kysely
            .insertInto('usage')
            .values({
                id: createId('usage'),
                project_id: project.id,
                job_id: old.job.id,
                operation: 'video.transcode@1',
                cpu_ms: 1000,
                media_ms: 0,
                bytes_in: 5,
                bytes_out: 5,
                bytes_stored: 5,
                created_at: new Date(),
            })
            .execute();
        const report = await maintenance.run();
        expect(report.prunedJobs).toBe(1);
        await expect(services.jobs?.get(project.id, old.job.id)).rejects.toThrow('There is no job');
        expect(existsSync(old.file)).toBe(false);
        const usage = await services.database.kysely
            .selectFrom('usage')
            .select('id')
            .where('job_id', '=', old.job.id)
            .execute();
        expect(usage).toHaveLength(1);
    });

    it('puts back in their queue the tasks that Redis lost', async () => {
        const { job } = await (services.jobs as NonNullable<typeof services.jobs>).create(project, {
            input: { url: 'https://cdn.example.com/a.mp4' },
            tasks: { probe: { op: 'probe' } },
        });
        const queues = services.scheduler?.queues;
        const [task] = (await services.scheduler?.loadTasks(job.id)) ?? [];
        await queues?.obliterate();
        expect(await queues?.has('probe', task?.id ?? '')).toBe(false);
        await services.database.kysely
            .updateTable('tasks')
            .set({ updated_at: new Date(Date.now() - 60_000) })
            .where('id', '=', task?.id ?? '')
            .execute();
        const report = await maintenance.run();
        expect(report.requeuedTasks).toBe(1);
        expect(await queues?.has('probe', task?.id ?? '')).toBe(true);
        expect((await maintenance.run()).requeuedTasks).toBe(0);
    });

    it('runs in one process at a time', async () => {
        const [first, second] = await Promise.all([
            maintenance.runIfFree(),
            maintenance.runIfFree(),
        ]);
        expect([first, second].filter((report) => report === undefined)).toHaveLength(1);
    });

    it('purges the expired uploads', async () => {
        const local = join(tmpdir(), `eclair-maintenance-upload-${Date.now()}`);
        writeFileSync(local, 'upload');
        const upload = await services.uploads.createFromFile(project, local, 6, 'x'.repeat(64));
        await services.database.kysely
            .updateTable('uploads')
            .set({ expires_at: new Date(Date.now() - 1000) })
            .where('id', '=', upload.id)
            .execute();
        expect((await maintenance.run()).uploads).toBe(1);
    });
});
