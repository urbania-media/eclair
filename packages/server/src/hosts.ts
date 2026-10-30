import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

import { REDIS_PREFIX } from './redis.ts';

const KEY = `${REDIS_PREFIX}:hosts`;
/** The live processes, by id, scored by when they expire, like the hosts. */
const PROCESSES_KEY = `${REDIS_PREFIX}:hosts:processes`;
/** What each live process says about itself, by id: its host, version and queues. */
const INFO_KEY = `${REDIS_PREFIX}:hosts:info`;

/** A queue that the workers of a process or host serve, and how many of its tasks they run at once. */
export interface HostQueue {
    name: string;
    concurrency: number;
}

/** What a process registers besides its host. */
export interface HostInfo {
    version?: string | undefined;
    /** The queues its workers serve: none for a process that only runs the API. */
    queues?: readonly HostQueue[] | undefined;
}

/** A live host, with what its processes registered (`GET /admin/v1/status`). */
export interface LiveHost {
    name: string;
    /** The versions of its processes, joined by `, ` while an upgrade runs. */
    version?: string;
    /** The queues of its workers, their concurrency summed over its processes. */
    queues: HostQueue[];
    seenAt: Date;
}

interface ProcessInfo {
    host: string;
    version?: string;
    queues: HostQueue[];
    seenAt: number;
}

/**
 * The machines that run Eclair processes on an install, in the Redis they share (decision 0016).
 * Each process refreshes its host every few seconds, with its version and the queues its workers
 * serve; a host that stops refreshing drops out.
 */
export class HostRegistry {
    readonly #redis: Redis;
    readonly #host: string;
    readonly #ttl: number;
    readonly #info: HostInfo;
    /** Several processes can run on one host (`eclair api` and `eclair worker`). */
    readonly #process: string;
    #timer: NodeJS.Timeout | undefined;

    /** `ttl`: milliseconds a host stays registered without a refresh. */
    constructor(redis: Redis, host = hostname(), ttl = 30_000, info: HostInfo = {}) {
        this.#redis = redis;
        this.#host = host;
        this.#ttl = ttl;
        this.#info = info;
        this.#process = `${host}:${process.pid}:${randomBytes(4).toString('hex')}`;
    }

    get host(): string {
        return this.#host;
    }

    async register(): Promise<void> {
        const now = Date.now();
        const info: ProcessInfo = {
            host: this.#host,
            ...(this.#info.version === undefined ? {} : { version: this.#info.version }),
            queues: [...(this.#info.queues ?? [])],
            seenAt: now,
        };
        await this.#redis
            .multi()
            .zadd(KEY, now + this.#ttl, this.#host)
            .zadd(PROCESSES_KEY, now + this.#ttl, this.#process)
            .hset(INFO_KEY, this.#process, JSON.stringify(info))
            .exec();
    }

    /** Registers this host now, then every third of the TTL. */
    async start(): Promise<void> {
        await this.register();
        this.#timer = setInterval(() => {
            this.register().catch(() => {});
        }, this.#ttl / 3);
    }

    /** Stops refreshing, and removes this process. Its host stays until it expires. */
    async stop(): Promise<void> {
        clearInterval(this.#timer);
        await this.#redis
            .multi()
            .zrem(PROCESSES_KEY, this.#process)
            .hdel(INFO_KEY, this.#process)
            .exec()
            .catch(() => {});
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

    /** The live hosts, with the versions and queues of their live processes. */
    async describe(): Promise<LiveHost[]> {
        const now = Date.now();
        await this.#redis.zremrangebyscore(KEY, '-inf', String(now));
        await this.#redis.zremrangebyscore(PROCESSES_KEY, '-inf', String(now));
        const [hosts, processes, infos] = await Promise.all([
            this.#redis.zrange(KEY, '0', '-1', 'WITHSCORES'),
            this.#redis.zrange(PROCESSES_KEY, '0', '-1'),
            this.#redis.hgetall(INFO_KEY),
        ]);
        const live = new Set(processes);
        const gone = Object.keys(infos).filter((id) => !live.has(id));
        if (gone.length > 0) {
            await this.#redis.hdel(INFO_KEY, ...gone);
        }

        const byHost = new Map<string, ProcessInfo[]>();
        for (const [id, text] of Object.entries(infos)) {
            if (!live.has(id)) {
                continue;
            }
            const info = JSON.parse(text) as ProcessInfo;
            byHost.set(info.host, [...(byHost.get(info.host) ?? []), info]);
        }

        const result: LiveHost[] = [];
        for (let index = 0; index < hosts.length; index += 2) {
            const name = hosts[index] ?? '';
            const expiresAt = Number(hosts[index + 1]);
            const infos = byHost.get(name) ?? [];
            const versions = [
                ...new Set(
                    infos.flatMap(({ version }) => (version === undefined ? [] : [version])),
                ),
            ].sort();
            const concurrency = new Map<string, number>();
            for (const queue of infos.flatMap(({ queues }) => queues)) {
                concurrency.set(queue.name, (concurrency.get(queue.name) ?? 0) + queue.concurrency);
            }
            result.push({
                name,
                ...(versions.length === 0 ? {} : { version: versions.join(', ') }),
                queues: [...concurrency]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([queue, value]) => ({ name: queue, concurrency: value })),
                // A host registered by an older process has no info: its expiry tells when.
                seenAt: new Date(
                    infos.length === 0
                        ? expiresAt - this.#ttl
                        : Math.max(...infos.map(({ seenAt }) => seenAt)),
                ),
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }
}

/** What a process says when SQLite runs on more than one machine. */
export function sqliteOnSeveralHosts(others: string[]): string {
    return `Eclair also runs on ${others.join(', ')} with this Redis, but the database is SQLite: each machine would have its own database file, or share one over the network, which corrupts it. Use MySQL or PostgreSQL to run Eclair on several machines (decision 0016).`;
}
