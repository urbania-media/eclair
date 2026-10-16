import type { Redis } from 'ioredis';
import { hostname } from 'node:os';

import { REDIS_PREFIX } from './redis.ts';

const KEY = `${REDIS_PREFIX}:hosts`;

/**
 * The machines that run Eclair processes on an install, in the Redis they share (decision 0016).
 * Each process refreshes its host every few seconds; a host that stops refreshing drops out.
 */
export class HostRegistry {
    readonly #redis: Redis;
    readonly #host: string;
    readonly #ttl: number;
    #timer: NodeJS.Timeout | undefined;

    /** `ttl`: milliseconds a host stays registered without a refresh. */
    constructor(redis: Redis, host = hostname(), ttl = 30_000) {
        this.#redis = redis;
        this.#host = host;
        this.#ttl = ttl;
    }

    get host(): string {
        return this.#host;
    }

    async register(): Promise<void> {
        await this.#redis.zadd(KEY, Date.now() + this.#ttl, this.#host);
    }

    /** Registers this host now, then every third of the TTL. */
    async start(): Promise<void> {
        await this.register();
        this.#timer = setInterval(() => {
            this.register().catch(() => {});
        }, this.#ttl / 3);
    }

    async stop(): Promise<void> {
        clearInterval(this.#timer);
    }

    /** The live hosts of the install, this one included. */
    async live(): Promise<string[]> {
        await this.#redis.zremrangebyscore(KEY, '-inf', String(Date.now()));
        return (await this.#redis.zrange(KEY, '0', '-1')).sort();
    }

    /** The live hosts other than this one. */
    async others(): Promise<string[]> {
        return (await this.live()).filter((host) => host !== this.#host);
    }
}

/** What a process says when SQLite runs on more than one machine. */
export function sqliteOnSeveralHosts(others: string[]): string {
    return `Eclair also runs on ${others.join(', ')} with this Redis, but the database is SQLite: each machine would have its own database file, or share one over the network, which corrupts it. Use MySQL or PostgreSQL to run Eclair on several machines (decision 0016).`;
}
