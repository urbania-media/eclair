import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { CAPABILITIES } from '@eclair-js/operation';
import type { Capability } from '@eclair-js/operation';

import type { Priority } from '../projects/projects.ts';
import { REDIS_PREFIX } from '../redis.ts';

/** What a queue carries: the task to run. Everything else is read from the database. */
export interface TaskMessage {
    taskId: string;
    jobId: string;
    projectId: string;
}

const RANKS: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/**
 * The BullMQ priority of a task, from 1 (first) to 9: the project's priority first, then the
 * job's, so that a project's high-priority job never goes before a higher-priority project.
 */
export function taskPriority(projectPriority: Priority, jobPriority: Priority): number {
    return 1 + RANKS[projectPriority] * 3 + RANKS[jobPriority];
}

export interface TaskQueueOptions {
    /** Runs of a task when it fails for a reason that may pass (storage, a crashed worker). */
    attempts?: number;
    /** Milliseconds before the first retry; it doubles each time. */
    backoff?: number;
}

/** The task queues, one per capability (decision 0006). */
export class TaskQueues {
    readonly #queues: Map<Capability, Queue>;
    readonly #attempts: number;
    readonly #backoff: number;

    constructor(connection: Redis, options: TaskQueueOptions = {}) {
        this.#attempts = options.attempts ?? 3;
        this.#backoff = options.backoff ?? 10_000;
        this.#queues = new Map(
            CAPABILITIES.map((capability) => [
                capability,
                new Queue<TaskMessage>(capability, { connection, prefix: REDIS_PREFIX }),
            ]),
        );
    }

    #queue(capability: Capability): Queue {
        const queue = this.#queues.get(capability);
        if (queue === undefined) {
            throw new Error(`There is no queue for ${capability}.`);
        }
        return queue;
    }

    /**
     * Adds a task to its queue. The BullMQ job id is the task id, so adding a task twice adds it
     * once. Finished BullMQ jobs are removed: the database keeps the history, and a retried task
     * can be added again.
     */
    async enqueue(capability: Capability, message: TaskMessage, priority: number): Promise<void> {
        await this.#queue(capability).add('task', message, {
            jobId: message.taskId,
            priority,
            attempts: this.#attempts,
            backoff: { type: 'exponential', delay: this.#backoff },
            removeOnComplete: true,
            removeOnFail: true,
        });
    }

    /** Removes a task that no worker took yet. Does nothing for a running or missing task. */
    async remove(capability: Capability, taskId: string): Promise<void> {
        const job = await this.#queue(capability).getJob(taskId);
        const state = await job?.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
            await job?.remove();
        }
    }

    /** Whether a task is in its queue, waiting or running. */
    async has(capability: Capability, taskId: string): Promise<boolean> {
        return (await this.#queue(capability).getJob(taskId)) !== undefined;
    }

    async close(): Promise<void> {
        await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    }

    /** Empties every queue. Only for tests. */
    async obliterate(): Promise<void> {
        await Promise.all(
            [...this.#queues.values()].map((queue) => queue.obliterate({ force: true })),
        );
    }
}
