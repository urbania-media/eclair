import type { Redis } from 'ioredis';

import type { JobEvent } from '@eclair-js/protocol';

import { REDIS_PREFIX } from '../redis.ts';

function channelOf(jobId: string): string {
    return `${REDIS_PREFIX}:job:${jobId}`;
}

export type JobEventListener = (event: JobEvent) => void;

/**
 * Status and progress changes of jobs, through Redis pub/sub, for `GET /v1/jobs/{id}/events` and
 * the synchronous probe. Every process publishes; the API subscribes on one connection of its own
 * for every job that a request follows.
 */
export class JobEvents {
    readonly #publisher: Redis;
    #subscriber: Redis | undefined;
    readonly #listeners = new Map<string, Set<JobEventListener>>();

    constructor(redis: Redis) {
        this.#publisher = redis;
    }

    /** Publishes an event. Never fails the caller: events are a convenience, the database is the truth. */
    async publish(event: JobEvent): Promise<void> {
        try {
            await this.#publisher.publish(channelOf(event.job), JSON.stringify(event));
        } catch {
            // Redis is down: followers miss an event and see the change on their next read.
        }
    }

    #connection(): Redis {
        if (this.#subscriber === undefined) {
            this.#subscriber = this.#publisher.duplicate();
            this.#subscriber.on('message', (channel: string, message: string) => {
                const jobId = channel.slice(channelOf('').length);
                let event: JobEvent;
                try {
                    event = JSON.parse(message) as JobEvent;
                } catch {
                    return;
                }
                for (const listener of this.#listeners.get(jobId) ?? []) {
                    listener(event);
                }
            });
        }
        return this.#subscriber;
    }

    /** Follows a job's events. Resolves once subscribed, with a function that stops following. */
    async subscribe(jobId: string, listener: JobEventListener): Promise<() => Promise<void>> {
        let listeners = this.#listeners.get(jobId);
        if (listeners === undefined) {
            listeners = new Set();
            this.#listeners.set(jobId, listeners);
            await this.#connection().subscribe(channelOf(jobId));
        }
        listeners.add(listener);
        return async () => {
            const current = this.#listeners.get(jobId);
            current?.delete(listener);
            if (current?.size === 0) {
                this.#listeners.delete(jobId);
                await this.#subscriber?.unsubscribe(channelOf(jobId)).catch(() => {});
            }
        };
    }

    async close(): Promise<void> {
        this.#subscriber?.disconnect();
        this.#subscriber = undefined;
        this.#listeners.clear();
    }
}
