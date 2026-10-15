import type { Redis } from 'ioredis';

import { REDIS_PREFIX } from '../redis.ts';

const CHANNEL = `${REDIS_PREFIX}:cancel`;

/**
 * Tells the workers to stop running tasks, through Redis pub/sub: the API publishes when a job is
 * canceled, and the worker that runs a task aborts it.
 */
export class CancelBus {
    readonly #publisher: Redis;
    #subscriber: Redis | undefined;
    readonly #listeners = new Map<string, () => void>();

    constructor(redis: Redis) {
        this.#publisher = redis;
    }

    async publish(taskIds: readonly string[]): Promise<void> {
        if (taskIds.length > 0) {
            await this.#publisher.publish(CHANNEL, JSON.stringify(taskIds));
        }
    }

    /** Starts listening, on a connection of its own (a subscribed connection can't run commands). */
    async listen(): Promise<void> {
        if (this.#subscriber !== undefined) {
            return;
        }
        this.#subscriber = this.#publisher.duplicate();
        this.#subscriber.on('message', (_channel: string, message: string) => {
            let taskIds: unknown;
            try {
                taskIds = JSON.parse(message);
            } catch {
                return;
            }
            for (const taskId of Array.isArray(taskIds) ? taskIds : []) {
                this.#listeners.get(String(taskId))?.();
            }
        });
        await this.#subscriber.subscribe(CHANNEL);
    }

    /** Calls `abort` when the task is canceled. Returns a function that stops listening. */
    watch(taskId: string, abort: () => void): () => void {
        this.#listeners.set(taskId, abort);
        return () => this.#listeners.delete(taskId);
    }

    async close(): Promise<void> {
        this.#subscriber?.disconnect();
        this.#subscriber = undefined;
    }
}
