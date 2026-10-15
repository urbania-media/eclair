import { DelayedError, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { QueueConfig } from '../config/config.ts';
import type { TaskMessage } from '../jobs/queues.ts';
import type { Projects } from '../projects/projects.ts';
import { REDIS_PREFIX } from '../redis.ts';
import type { CancelBus } from './cancel.ts';
import type { RunnerLogger, TaskRunner } from './runner.ts';
import type { ProjectSlots } from './slots.ts';

export interface TaskWorkersOptions {
    connection: Redis;
    queues: QueueConfig[];
    runner: TaskRunner;
    slots: ProjectSlots;
    cancel: CancelBus;
    projects: Projects;
    logger: RunnerLogger;
    /** Milliseconds a task waits when its project already runs as many tasks as it may. */
    slotDelay?: number;
}

/** Thrown to make BullMQ run a task again later, with its backoff. */
class RetryLater extends Error {
    constructor(taskId: string) {
        super(`Task ${taskId} will run again.`);
        this.name = 'RetryLater';
    }
}

/**
 * The BullMQ workers of a process: one per queue of `ECLAIR_QUEUES`, with its concurrency
 * (decision 0006). Each task takes a slot of its project first, so a project never runs more
 * tasks than its `concurrency` setting over every worker (decision 0003).
 */
export class TaskWorkers {
    readonly #options: TaskWorkersOptions;
    readonly #workers: Worker<TaskMessage>[] = [];
    readonly #slotDelay: number;

    constructor(options: TaskWorkersOptions) {
        this.#options = options;
        this.#slotDelay = options.slotDelay ?? 2000;
    }

    async start(): Promise<void> {
        await this.#options.cancel.listen();
        for (const { name, concurrency } of this.#options.queues) {
            const worker = new Worker<TaskMessage>(
                name,
                (job, token) => this.#process(job, token),
                {
                    connection: this.#options.connection,
                    prefix: REDIS_PREFIX,
                    concurrency,
                },
            );
            worker.on('error', (error) => {
                this.#options.logger.error({ err: error, queue: name }, 'Worker error');
            });
            this.#workers.push(worker);
        }
        await Promise.all(this.#workers.map((worker) => worker.waitUntilReady()));
    }

    async #process(job: Job<TaskMessage>, token: string | undefined): Promise<void> {
        const { taskId, projectId } = job.data;
        const { slots, runner, cancel, logger } = this.#options;
        const project = await this.#options.projects.find(projectId);
        if (project === undefined) {
            return;
        }

        if (!(await slots.acquire(projectId, taskId, project.settings.concurrency))) {
            // The project is busy: wait, without counting it as an attempt.
            await job.moveToDelayed(
                Date.now() + this.#slotDelay + Math.floor(Math.random() * this.#slotDelay),
                token,
            );
            throw new DelayedError();
        }

        const controller = new AbortController();
        const stopWatching = cancel.watch(taskId, () => controller.abort());
        const heartbeat = setInterval(() => {
            slots.refresh(projectId, taskId).catch(() => {});
        }, 20_000);
        try {
            const attempts = job.opts.attempts ?? 1;
            const outcome = await runner.run(taskId, {
                canRetry: job.attemptsMade + 1 < attempts,
                signal: controller.signal,
                onProgress: (progress) => {
                    job.updateProgress(progress).catch(() => {});
                },
            });
            logger.debug({ task: taskId, outcome }, 'Task ended');
            if (outcome === 'retry') {
                throw new RetryLater(taskId);
            }
        } finally {
            clearInterval(heartbeat);
            stopWatching();
            await slots.release(projectId, taskId).catch(() => {});
        }
    }

    /** Stops taking tasks and waits for the running ones to end. */
    async close(): Promise<void> {
        await Promise.all(this.#workers.map((worker) => worker.close()));
        await this.#options.cancel.close();
    }
}
