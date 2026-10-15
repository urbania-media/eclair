import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';
import type { JobRequest } from '@eclair-js/protocol';

import { toJson } from '../database/values.ts';
import { ConflictError } from '../errors.ts';
import type { Project } from '../projects/projects.ts';
import { RUNS_WITH_REDIS, createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';
import type { Jobs } from './jobs.ts';
import type { Scheduler } from './scheduler.ts';
import { testRegistry } from './testing.ts';

let services: Awaited<ReturnType<typeof createTestServices>>;
let jobs: Jobs;
let scheduler: Scheduler;
let project: Project;
const ended: string[] = [];

const pipeline: JobRequest = {
    input: { url: 'https://cdn.example.com/a.mp4' },
    output: { storage: 'eclair', prefix: 'videos/42/' },
    tasks: {
        probe: { op: 'probe' },
        h264: { op: 'video.transcode', after: ['probe'] },
        hls: { op: 'video.hls', from: 'h264', keep: false },
    },
    metadata: { mediaId: 42 },
};

describe.skipIf(!RUNS_WITH_REDIS)('jobs', () => {
    beforeAll(async () => {
        services = await createTestServices({ operations: testRegistry(), queues: true });
        if (services.jobs === undefined || services.scheduler === undefined) {
            throw new Error('The test services have no jobs.');
        }
        jobs = services.jobs;
        scheduler = services.scheduler;
        scheduler.onJobEnded(async (job) => {
            ended.push(`${job.id} ${job.status}`);
        });
        project = (await services.projects.create({ slug: 'niche' })).project;
    });

    afterAll(async () => {
        await services.close();
    });

    beforeEach(async () => {
        await services.scheduler?.queues.obliterate();
    });

    /** Ends a task as a worker would, then moves its job forward. */
    async function endTask(
        jobId: string,
        name: string,
        status: 'completed' | 'failed' | 'skipped',
    ) {
        await services.database.kysely
            .updateTable('tasks')
            .set({
                status,
                ...(status === 'failed'
                    ? { error: toJson({ code: 'operation_failed', message: 'Broken.' }) }
                    : {}),
                ended_at: new Date(),
            })
            .where('job_id', '=', jobId)
            .where('name', '=', name)
            .execute();
        await scheduler.advance(jobId);
    }

    async function queued(jobId: string) {
        const tasks = await scheduler.loadTasks(jobId);
        const result: string[] = [];
        // Without a worker, an ended task stays in its BullMQ queue: only count queued tasks.
        for (const task of tasks.filter(({ status }) => status === 'queued')) {
            if (await scheduler.queues.has(task.queue, task.id)) {
                result.push(task.name);
            }
        }
        return result;
    }

    describe('create', () => {
        it('stores the resolved pipeline and enqueues the tasks that can start', async () => {
            const { job, created } = await jobs.create(project, pipeline);
            expect(created).toBe(true);
            expect(validate('Job', job).valid).toBe(true);
            expect(job).toMatchObject({
                status: 'pending',
                priority: 'normal',
                failFast: false,
                metadata: { mediaId: 42 },
                tasks: {
                    probe: { status: 'queued', op: 'probe@1', attempts: 0 },
                    h264: { status: 'pending', op: 'video.transcode@1', after: ['probe'] },
                    hls: { status: 'pending', op: 'video.hls@1', from: 'h264' },
                },
            });
            expect(await queued(job.id)).toEqual(['probe']);
        });

        it('merges a preset with the tasks of the job, and records its version', async () => {
            await services.presets.put(project.id, 'web-video', {
                tasks: { probe: { op: 'probe' }, h264: { op: 'video.transcode' } },
            });
            const { job } = await jobs.create(project, {
                input: pipeline.input,
                output: pipeline.output,
                preset: 'web-video',
                tasks: { h264: { op: 'video.transcode', options: { codec: 'vp9' } } },
            });
            expect(job.preset).toEqual({ name: 'web-video', version: 1 });
            expect(Object.keys(job.tasks)).toEqual(['probe', 'h264']);
            const tasks = await scheduler.loadTasks(job.id);
            expect(tasks.find(({ name }) => name === 'h264')?.options).toEqual({ codec: 'vp9' });
        });

        it('checks the input, the output and the pipeline, all at once', async () => {
            await expect(
                jobs.create(project, {
                    input: { storage: 'media', path: 'a/../b.mp4' },
                    preset: 'missing',
                    tasks: { h264: { op: 'video.transcode', after: ['ghost'] } },
                }),
            ).rejects.toMatchObject({
                errors: {
                    '/preset': ['there is no preset "missing"'],
                    '/tasks/h264/after': ['there is no task "ghost"'],
                    '/input/storage': ['the project has no storage "media"'],
                    '/input/path': [expect.stringContaining('not a valid storage path')],
                },
            });
            await expect(
                jobs.create(project, {
                    input: pipeline.input,
                    tasks: { h264: { op: 'video.transcode' } },
                }),
            ).rejects.toMatchObject({ errors: { '/output': ['is required: h264 write files'] } });
            await expect(
                jobs.create(project, {
                    input: { upload: 'upl_01JA2Y9F3K8M2R6T4V7W9X1Z3B' },
                    output: { storage: 'eclair', path: 'out' },
                    tasks: { h264: { op: 'video.transcode' } },
                }),
            ).rejects.toMatchObject({
                errors: {
                    '/input/upload': ['there is no upload "upl_01JA2Y9F3K8M2R6T4V7W9X1Z3B"'],
                    '/output/path': [expect.stringContaining('must contain {file}')],
                },
            });
            await expect(
                jobs.create(project, {
                    input: { url: 'https://10.0.0.1/a.mp4' },
                    tasks: { probe: { op: 'probe' } },
                }),
            ).rejects.toMatchObject({
                errors: { '/input/url': ['10.0.0.1 is not a public address.'] },
            });
        });

        it('accepts an upload of the project as input', async () => {
            const file = join(tmpdir(), `eclair-upload-${Date.now()}.bin`);
            writeFileSync(file, 'data');
            const upload = await services.uploads.createFromFile(project, file, 4, 'x'.repeat(64));
            const { job } = await jobs.create(project, {
                input: { upload: upload.id },
                tasks: { probe: { op: 'probe' } },
            });
            expect(job.input).toEqual({ upload: upload.id });
        });

        it('replays a request with the same Idempotency-Key, and refuses another one', async () => {
            const first = await jobs.create(project, pipeline, 'media-42');
            const replay = await jobs.create(project, { ...pipeline }, 'media-42');
            expect(replay).toMatchObject({ created: false, job: { id: first.job.id } });
            await expect(
                jobs.create(project, { ...pipeline, metadata: { mediaId: 43 } }, 'media-42'),
            ).rejects.toThrow(ConflictError);
        });
    });

    describe('the scheduler', () => {
        it('enqueues each task when its dependencies are done, and ends the job', async () => {
            const { job } = await jobs.create(project, pipeline);
            await endTask(job.id, 'probe', 'completed');
            expect(await queued(job.id)).toEqual(['h264']);
            await endTask(job.id, 'h264', 'completed');
            expect(await queued(job.id)).toEqual(['hls']);
            await endTask(job.id, 'hls', 'completed');
            expect((await jobs.get(project.id, job.id)).status).toBe('completed');
            expect(ended).toContain(`${job.id} completed`);
        });

        it('fails the tasks that depend on a failed one, and the job', async () => {
            const { job } = await jobs.create(project, pipeline);
            await endTask(job.id, 'probe', 'completed');
            await endTask(job.id, 'h264', 'failed');
            const result = await jobs.get(project.id, job.id);
            expect(result.status).toBe('failed');
            expect(result.tasks['hls']).toMatchObject({
                status: 'failed',
                error: { code: 'dependency_failed', message: 'h264 failed.' },
            });
        });

        it('skips a task whose input was skipped, but not one that only waits for it', async () => {
            const { job } = await jobs.create(project, {
                ...pipeline,
                tasks: {
                    h264: { op: 'video.transcode', when: { kind: ['video'] } },
                    hls: { op: 'video.hls', from: 'h264' },
                    probe: { op: 'probe', after: ['h264'] },
                },
            });
            await endTask(job.id, 'h264', 'skipped');
            const result = await jobs.get(project.id, job.id);
            expect(result.tasks['hls']?.status).toBe('skipped');
            expect(result.tasks['probe']?.status).toBe('queued');
        });

        it('cancels the rest of a fail-fast job', async () => {
            const { job } = await jobs.create(project, {
                ...pipeline,
                failFast: true,
                tasks: { probe: { op: 'probe' }, h264: { op: 'video.transcode' } },
            });
            expect(await queued(job.id)).toEqual(['probe', 'h264']);
            await endTask(job.id, 'probe', 'failed');
            const result = await jobs.get(project.id, job.id);
            expect(result.status).toBe('failed');
            expect(result.tasks['h264']?.status).toBe('canceled');
            expect(await queued(job.id)).toEqual([]);
        });
    });

    describe('cancel and retry', () => {
        it('cancel a job and take its tasks out of the queues', async () => {
            const { job } = await jobs.create(project, pipeline);
            const canceled = await jobs.cancel(project.id, job.id);
            expect(canceled.status).toBe('canceled');
            expect(Object.values(canceled.tasks).map(({ status }) => status)).toEqual([
                'canceled',
                'canceled',
                'canceled',
            ]);
            expect(await queued(job.id)).toEqual([]);
            expect(ended).toContain(`${job.id} canceled`);
            // Canceling again changes nothing.
            expect((await jobs.cancel(project.id, job.id)).status).toBe('canceled');
        });

        it('run the failed and canceled tasks again, and keep the completed ones', async () => {
            const { job } = await jobs.create(project, pipeline);
            await endTask(job.id, 'probe', 'completed');
            await endTask(job.id, 'h264', 'failed');

            const retried = await jobs.retry(project.id, job.id);
            expect(retried).toMatchObject({
                status: 'running',
                tasks: {
                    probe: { status: 'completed' },
                    h264: { status: 'queued' },
                    hls: { status: 'pending' },
                },
            });
            expect(retried.tasks['h264']).not.toHaveProperty('error');
            expect(retried).not.toHaveProperty('endedAt');
            await expect(jobs.retry(project.id, job.id)).rejects.toThrow(
                'only a failed or canceled job can be retried',
            );
        });
    });

    describe('reading', () => {
        it('lists the jobs of a project, newest first, with filters and pages', async () => {
            const other = (await services.projects.create({ slug: 'other' })).project;
            await jobs.create(other, pipeline);
            const created = [];
            for (const mediaId of [100, 101, 102]) {
                created.push(
                    (
                        await jobs.create(project, {
                            ...pipeline,
                            metadata: { mediaId, kind: 'clip' },
                        })
                    ).job.id,
                );
            }

            const first = await jobs.list(project.id, { limit: 2, metadata: { kind: 'clip' } });
            expect(validate('JobList', first).valid).toBe(true);
            expect(first.data.map(({ id }) => id)).toEqual([created[2], created[1]]);
            const second = await jobs.list(project.id, {
                limit: 2,
                metadata: { kind: 'clip' },
                cursor: first.nextCursor ?? '',
            });
            expect(second).toMatchObject({ data: [{ id: created[0] }], nextCursor: null });

            const one = await jobs.list(project.id, { limit: 10, metadata: { mediaId: '101' } });
            expect(one.data.map(({ id }) => id)).toEqual([created[1]]);
            const canceled = await jobs.list(project.id, { limit: 100, status: ['canceled'] });
            expect(canceled.data.every(({ status }) => status === 'canceled')).toBe(true);
            const recent = await jobs.list(project.id, {
                limit: 100,
                createdAfter: new Date(Date.now() + 60_000),
            });
            expect(recent.data).toEqual([]);
        });

        it("never shows another project's job", async () => {
            const other = (await services.projects.create({ slug: 'third' })).project;
            const { job } = await jobs.create(other, pipeline);
            await expect(jobs.get(project.id, job.id)).rejects.toThrow(
                `There is no job "${job.id}".`,
            );
            await expect(jobs.cancel(project.id, job.id)).rejects.toThrow('There is no job');
            await expect(jobs.get(project.id, 'not-an-id')).rejects.toThrow('There is no job');
        });

        it('lists the files of a job', async () => {
            const { job } = await jobs.create(project, pipeline);
            const tasks = await scheduler.loadTasks(job.id);
            const h264 = tasks.find(({ name }) => name === 'h264');
            for (const name of ['a.mp4', 'b.mp4']) {
                await services.database.kysely
                    .insertInto('outputs')
                    .values({
                        id: (await import('../ids.ts')).createId('output'),
                        task_id: h264?.id ?? '',
                        job_id: job.id,
                        project_id: project.id,
                        kind: 'file',
                        name,
                        storage: 'eclair',
                        path: `videos/42/h264/${name}`,
                        mime: 'video/mp4',
                        size: 10,
                        expired: false,
                        created_at: new Date(),
                    })
                    .execute();
            }
            const files = await jobs.files(project.id, job.id, { limit: 1 });
            expect(validate('JobFileList', files).valid).toBe(true);
            expect(files.data).toMatchObject([
                { task: 'h264', name: 'a.mp4', path: 'videos/42/h264/a.mp4' },
            ]);
            const next = await jobs.files(project.id, job.id, {
                limit: 1,
                cursor: files.nextCursor ?? '',
            });
            expect(next).toMatchObject({ data: [{ name: 'b.mp4' }], nextCursor: null });
            expect(
                (await jobs.files(project.id, job.id, { limit: 10, task: 'probe' })).data,
            ).toEqual([]);
            expect((await jobs.get(project.id, job.id)).tasks['h264']?.outputs?.files).toHaveLength(
                2,
            );
        });
    });

    it('reports invalid jobs as InvalidValueError', async () => {
        await expect(jobs.create(project, { input: pipeline.input, tasks: {} })).rejects.toThrow(
            InvalidValueError,
        );
    });
});
