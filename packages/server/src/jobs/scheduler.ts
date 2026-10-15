import type { JobStatus, TaskError, TaskStatus } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import { toJson } from '../database/values.ts';
import type { Projects } from '../projects/projects.ts';
import type { TaskQueues } from './queues.ts';
import { taskPriority } from './queues.ts';
import { ENDED_JOB_STATUSES, ENDED_TASK_STATUSES, toJobRecord, toTaskRecord } from './records.ts';
import type { JobRecord, TaskRecord } from './records.ts';

/** Called when a job ends, to send its webhook. */
export type JobEndedListener = (job: JobRecord) => Promise<void>;

/** Called to stop tasks that a worker runs, when their job is canceled. */
export type CancelRunningTasks = (taskIds: string[]) => Promise<void>;

/**
 * Moves jobs forward (decision 0004): enqueues the tasks whose dependencies are done, fails or
 * skips the tasks that can't run, and ends a job once every task has ended. Every change is a
 * conditional update, so several processes can move the same job at once: a task is enqueued once
 * and a job ends once.
 */
export class Scheduler {
    readonly #database: Database;
    readonly #queues: TaskQueues;
    readonly #projects: Projects;
    #onJobEnded: JobEndedListener | undefined;
    #cancelRunning: CancelRunningTasks | undefined;

    constructor(database: Database, queues: TaskQueues, projects: Projects) {
        this.#database = database;
        this.#queues = queues;
        this.#projects = projects;
    }

    get queues(): TaskQueues {
        return this.#queues;
    }

    onJobEnded(listener: JobEndedListener): void {
        this.#onJobEnded = listener;
    }

    onCancelRunning(cancel: CancelRunningTasks): void {
        this.#cancelRunning = cancel;
    }

    async loadJob(jobId: string): Promise<JobRecord | undefined> {
        const row = await this.#database.kysely
            .selectFrom('jobs')
            .selectAll()
            .where('id', '=', jobId)
            .executeTakeFirst();
        return row === undefined ? undefined : toJobRecord(row);
    }

    async loadTasks(jobId: string): Promise<TaskRecord[]> {
        const rows = await this.#database.kysely
            .selectFrom('tasks')
            .selectAll()
            .where('job_id', '=', jobId)
            .orderBy('id')
            .execute();
        return rows.map(toTaskRecord);
    }

    /**
     * Ends a task that hasn't run, if it is still `from`. Returns whether this call changed it.
     */
    async #endTask(
        task: TaskRecord,
        from: TaskStatus[],
        status: TaskStatus,
        error?: TaskError,
    ): Promise<boolean> {
        const now = new Date();
        const result = await this.#database.kysely
            .updateTable('tasks')
            .set({
                status,
                ...(error === undefined ? {} : { error: toJson(error) }),
                ended_at: now,
                updated_at: now,
            })
            .where('id', '=', task.id)
            .where('status', 'in', from)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            return false;
        }
        task.status = status;
        task.error = error ?? task.error;
        task.endedAt = now;
        return true;
    }

    /**
     * Moves a job forward. Call it when a job is created or retried, and when one of its tasks
     * ends. Safe to call any time, from any process.
     */
    async advance(jobId: string): Promise<void> {
        const job = await this.loadJob(jobId);
        if (job === undefined || ENDED_JOB_STATUSES.includes(job.status)) {
            return;
        }
        const tasks = await this.loadTasks(jobId);
        const byName = new Map(tasks.map((task) => [task.name, task]));

        // Settle the tasks that can't run, until nothing changes: a failure goes down the graph.
        let changed = true;
        while (changed) {
            changed = false;
            for (const task of tasks.filter(({ status }) => status === 'pending')) {
                const dependencies = task.dependencies.flatMap((name) => byName.get(name) ?? []);
                const failed = dependencies.find(({ status }) => status === 'failed');
                const canceled = dependencies.find(({ status }) => status === 'canceled');
                const source = task.source === undefined ? undefined : byName.get(task.source.task);
                if (failed !== undefined) {
                    if (
                        await this.#endTask(task, ['pending'], 'failed', {
                            code: 'dependency_failed',
                            message: `${failed.name} failed.`,
                        })
                    ) {
                        changed = true;
                    }
                } else if (canceled !== undefined) {
                    if (await this.#endTask(task, ['pending'], 'canceled')) {
                        changed = true;
                    }
                } else if (source?.status === 'skipped') {
                    // Its input doesn't exist.
                    if (await this.#endTask(task, ['pending'], 'skipped')) {
                        changed = true;
                    }
                }
            }
        }

        if (job.failFast && tasks.some(({ status }) => status === 'failed')) {
            await this.#cancelTasks(tasks);
        } else {
            await this.#enqueueReady(job, tasks, byName);
        }

        await this.#finishIfDone(job, tasks);
    }

    async #enqueueReady(
        job: JobRecord,
        tasks: TaskRecord[],
        byName: Map<string, TaskRecord>,
    ): Promise<void> {
        const ready = tasks.filter(
            (task) =>
                task.status === 'pending' &&
                task.dependencies.every((name) => {
                    const status = byName.get(name)?.status;
                    return status === 'completed' || status === 'skipped';
                }),
        );
        if (ready.length === 0) {
            return;
        }
        const project = await this.#projects.get(job.projectId);
        const priority = taskPriority(project.priority, job.priority);
        for (const task of ready) {
            const now = new Date();
            const result = await this.#database.kysely
                .updateTable('tasks')
                .set({ status: 'queued', queued_at: now, updated_at: now })
                .where('id', '=', task.id)
                .where('status', '=', 'pending')
                .executeTakeFirst();
            if (result.numUpdatedRows === 0n) {
                continue;
            }
            task.status = 'queued';
            await this.#queues.enqueue(
                task.queue,
                { taskId: task.id, jobId: job.id, projectId: job.projectId },
                priority,
            );
        }
    }

    /** Cancels the tasks that haven't ended: removed from their queue, or stopped by their worker. */
    async #cancelTasks(tasks: TaskRecord[]): Promise<void> {
        for (const task of tasks.filter(
            ({ status }) => status === 'pending' || status === 'queued',
        )) {
            const wasQueued = task.status === 'queued';
            if ((await this.#endTask(task, ['pending', 'queued'], 'canceled')) && wasQueued) {
                await this.#queues.remove(task.queue, task.id);
            }
        }
        const running = tasks.filter(({ status }) => status === 'running').map(({ id }) => id);
        if (running.length > 0) {
            await this.#cancelRunning?.(running);
        }
    }

    /** Ends the job once every task has ended: failed if one failed, completed otherwise. */
    async #finishIfDone(job: JobRecord, tasks: TaskRecord[]): Promise<void> {
        if (!tasks.every(({ status }) => ENDED_TASK_STATUSES.includes(status))) {
            return;
        }
        const status: JobStatus = tasks.some(({ status }) => status === 'failed')
            ? 'failed'
            : 'completed';
        await this.#endJob(job, status);
    }

    async #endJob(job: JobRecord, status: JobStatus): Promise<void> {
        const now = new Date();
        const result = await this.#database.kysely
            .updateTable('jobs')
            .set({ status, ended_at: now, updated_at: now })
            .where('id', '=', job.id)
            .where('ended_at', 'is', null)
            .executeTakeFirst();
        if (result.numUpdatedRows > 0n) {
            await this.#onJobEnded?.({ ...job, status, endedAt: now });
        }
    }

    /** Cancels a job: its tasks that haven't ended, then the job itself. */
    async cancel(jobId: string): Promise<void> {
        const job = await this.loadJob(jobId);
        if (job === undefined || ENDED_JOB_STATUSES.includes(job.status)) {
            return;
        }
        await this.#cancelTasks(await this.loadTasks(jobId));
        await this.#endJob(job, 'canceled');
    }

    /**
     * Runs a failed or canceled job again: its failed and canceled tasks go back to `pending`, the
     * completed and skipped ones stay. Returns `false` when the job isn't failed or canceled.
     */
    async retry(jobId: string): Promise<boolean> {
        const job = await this.loadJob(jobId);
        if (job === undefined || (job.status !== 'failed' && job.status !== 'canceled')) {
            return false;
        }
        const tasks = await this.loadTasks(jobId);
        const now = new Date();
        const reset = tasks.filter(({ status }) => status === 'failed' || status === 'canceled');
        await this.#database.kysely.transaction().execute(async (transaction) => {
            if (reset.length > 0) {
                await transaction
                    .updateTable('tasks')
                    .set({
                        status: 'pending',
                        error: null,
                        progress: null,
                        worker: null,
                        queued_at: null,
                        started_at: null,
                        ended_at: null,
                        updated_at: now,
                    })
                    .where(
                        'id',
                        'in',
                        reset.map(({ id }) => id),
                    )
                    .execute();
            }
            await transaction
                .updateTable('jobs')
                .set({
                    status: tasks.some(({ status }) => status === 'completed')
                        ? 'running'
                        : 'pending',
                    ended_at: null,
                    updated_at: now,
                })
                .where('id', '=', jobId)
                .execute();
        });
        await this.advance(jobId);
        return true;
    }
}
