import type { Redis } from 'ioredis';

import { REDIS_PREFIX } from '../redis.ts';

/**
 * Takes a slot if there is one: drops the expired slots, keeps a slot the task already has, and
 * adds one while there are fewer than the limit. Atomic, so two workers can't both take the last.
 */
const ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
    redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
    return 1
end
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[4]) then
    redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
    return 1
end
return 0
`;

/**
 * The running tasks of each project, over every worker, to apply the project's `concurrency`
 * (decision 0003). A slot expires unless its worker refreshes it, so a worker that dies frees its
 * slots.
 */
export class ProjectSlots {
    readonly #redis: Redis;
    readonly #ttl: number;

    /** `ttl`: milliseconds a slot lasts without a refresh. */
    constructor(redis: Redis, ttl = 60_000) {
        this.#redis = redis;
        this.#ttl = ttl;
    }

    #key(projectId: string): string {
        return `${REDIS_PREFIX}:slots:${projectId}`;
    }

    /** Takes a slot for a task. Returns `false` when the project already runs `limit` tasks. */
    async acquire(projectId: string, taskId: string, limit: number): Promise<boolean> {
        const now = Date.now();
        const result = await this.#redis.eval(
            ACQUIRE,
            1,
            this.#key(projectId),
            String(now),
            String(now + this.#ttl),
            taskId,
            String(limit),
            String(this.#ttl * 2),
        );
        return result === 1;
    }

    /** Keeps a task's slot while it runs. */
    async refresh(projectId: string, taskId: string): Promise<void> {
        await this.#redis.zadd(this.#key(projectId), 'XX', Date.now() + this.#ttl, taskId);
    }

    async release(projectId: string, taskId: string): Promise<void> {
        await this.#redis.zrem(this.#key(projectId), taskId);
    }

    /** How many tasks of a project run now. */
    async count(projectId: string): Promise<number> {
        await this.#redis.zremrangebyscore(this.#key(projectId), '-inf', Date.now());
        return this.#redis.zcard(this.#key(projectId));
    }
}
