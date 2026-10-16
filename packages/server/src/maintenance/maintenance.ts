import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';

import type { Capability } from '@eclair-js/operation';

import type { Database } from '../database/connection.ts';
import type { TaskQueues } from '../jobs/queues.ts';
import { taskPriority } from '../jobs/queues.ts';
import type { Projects } from '../projects/projects.ts';
import { REDIS_PREFIX } from '../redis.ts';
import { TEMPORARY_STORAGE } from '../storages/storages.ts';
import type { TemporaryStorage } from '../storages/temporary.ts';
import type { Uploads } from '../uploads/uploads.ts';
import type { RunnerLogger } from '../workers/runner.ts';

const LOCK_KEY = `${REDIS_PREFIX}:maintenance`;

/** Rows handled per step and per run, so that a run stays short. */
const BATCH = 200;

export interface MaintenanceOptions {
    database: Database;
    redis: Redis;
    queues: TaskQueues;
    projects: Projects;
    uploads: Uploads;
    temporary: TemporaryStorage;
    logger: RunnerLogger;
    /** How long ended jobs are kept, in milliseconds (`ECLAIR_JOB_RETENTION`). */
    jobRetention: number;
    /** How long a queued task can be missing from its queue before it's queued again. */
    lostAfter?: number;
}

export interface MaintenanceReport {
    uploads: number;
    expiredOutputs: number;
    intermediateOutputs: number;
    prunedJobs: number;
    requeuedTasks: number;
}

/**
 * Keeps a deployment tidy: expired uploads and temporary files are deleted, intermediate files go
 * once their job ended, old jobs are pruned, and tasks that Redis lost go back to their queue
 * (PostgreSQL or MySQL is the source of truth, decision 0007). One process runs it at a time.
 */
export class Maintenance {
    readonly #options: MaintenanceOptions;
    #timer: NodeJS.Timeout | undefined;
    #running: Promise<unknown> | undefined;

    constructor(options: MaintenanceOptions) {
        this.#options = options;
    }

    /** Runs every `interval` milliseconds, in the process that gets the lock. */
    start(interval = 60_000): void {
        this.#timer = setInterval(() => {
            this.#running ??= this.runIfFree(interval)
                .catch((error: unknown) => {
                    this.#options.logger.error({ err: error }, 'Maintenance failed');
                })
                .finally(() => {
                    this.#running = undefined;
                });
        }, interval);
    }

    async stop(): Promise<void> {
        clearInterval(this.#timer);
        await this.#running;
    }

    /** Runs once if no other process does. Returns `undefined` when another process has the lock. */
    async runIfFree(lockFor = 60_000): Promise<MaintenanceReport | undefined> {
        const token = randomBytes(8).toString('hex');
        const locked = await this.#options.redis.set(LOCK_KEY, token, 'PX', lockFor, 'NX');
        if (locked !== 'OK') {
            return undefined;
        }
        try {
            return await this.run();
        } finally {
            // Release only our own lock.
            await this.#options.redis.eval(
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
                1,
                LOCK_KEY,
                token,
            );
        }
    }

    async run(now = new Date()): Promise<MaintenanceReport> {
        const report: MaintenanceReport = {
            uploads: await this.#options.uploads.purgeExpired(now, BATCH),
            expiredOutputs: await this.#expireOutputs(now),
            intermediateOutputs: await this.#deleteIntermediateOutputs(),
            prunedJobs: await this.#pruneJobs(now),
            requeuedTasks: await this.#requeueLostTasks(now),
        };
        if (Object.values(report).some((count) => count > 0)) {
            this.#options.logger.info({ ...report }, 'Maintenance');
        }
        return report;
    }

    /** Deletes a file of the temporary storage and marks its output expired. */
    async #expire(output: { id: string; project_id: string; path: string | null }): Promise<void> {
        if (output.path !== null) {
            await this.#options.temporary.forProject(output.project_id).delete(output.path);
        }
        await this.#options.database.kysely
            .updateTable('outputs')
            .set({ expired: true })
            .where('id', '=', output.id)
            .execute();
    }

    async #expireOutputs(now: Date): Promise<number> {
        const outputs = await this.#options.database.kysely
            .selectFrom('outputs')
            .select(['id', 'project_id', 'path'])
            .where('storage', '=', TEMPORARY_STORAGE)
            .where('expired', '=', false)
            .where('expires_at', '<=', now)
            .limit(BATCH)
            .execute();
        for (const output of outputs) {
            await this.#expire(output);
        }
        return outputs.length;
    }

    /** Intermediate files (`keep: false`) are only for their job: they go when it ends. */
    async #deleteIntermediateOutputs(): Promise<number> {
        const outputs = await this.#options.database.kysely
            .selectFrom('outputs')
            .innerJoin('tasks', 'tasks.id', 'outputs.task_id')
            .innerJoin('jobs', 'jobs.id', 'outputs.job_id')
            .select(['outputs.id', 'outputs.project_id', 'outputs.path'])
            .where('outputs.storage', '=', TEMPORARY_STORAGE)
            .where('outputs.kind', '=', 'file')
            .where('outputs.expired', '=', false)
            .where('tasks.keep', '=', false)
            .where('jobs.ended_at', 'is not', null)
            .limit(BATCH)
            .execute();
        for (const output of outputs) {
            await this.#expire(output);
        }
        return outputs.length;
    }

    /** Deletes the jobs that ended before the retention, with their temporary files. Usage stays. */
    async #pruneJobs(now: Date): Promise<number> {
        const before = new Date(now.getTime() - this.#options.jobRetention);
        const jobs = await this.#options.database.kysely
            .selectFrom('jobs')
            .select('id')
            .where('ended_at', '<', before)
            .limit(BATCH)
            .execute();
        for (const { id } of jobs) {
            const outputs = await this.#options.database.kysely
                .selectFrom('outputs')
                .select(['id', 'project_id', 'path'])
                .where('job_id', '=', id)
                .where('storage', '=', TEMPORARY_STORAGE)
                .where('expired', '=', false)
                .execute();
            for (const output of outputs) {
                await this.#expire(output);
            }
            await this.#options.database.kysely.deleteFrom('jobs').where('id', '=', id).execute();
        }
        return jobs.length;
    }

    /**
     * Puts back in their queue the queued tasks that aren't in it anymore, if Redis lost its data.
     * Running tasks are BullMQ's: a worker that dies leaves a stalled job that another one takes.
     */
    async #requeueLostTasks(now: Date): Promise<number> {
        const lostAfter = this.#options.lostAfter ?? 5 * 60_000;
        const tasks = await this.#options.database.kysely
            .selectFrom('tasks')
            .innerJoin('jobs', 'jobs.id', 'tasks.job_id')
            .select([
                'tasks.id',
                'tasks.job_id',
                'tasks.project_id',
                'tasks.queue',
                'jobs.priority',
            ])
            .where('tasks.status', '=', 'queued')
            .where('tasks.updated_at', '<', new Date(now.getTime() - lostAfter))
            .limit(BATCH)
            .execute();
        let requeued = 0;
        for (const task of tasks) {
            const queue = task.queue as Capability;
            if (await this.#options.queues.has(queue, task.id)) {
                continue;
            }
            const project = await this.#options.projects.find(task.project_id);
            if (project === undefined) {
                continue;
            }
            await this.#options.queues.enqueue(
                queue,
                { taskId: task.id, jobId: task.job_id, projectId: task.project_id },
                taskPriority(project.priority, task.priority as 'normal'),
            );
            requeued += 1;
        }
        return requeued;
    }
}
