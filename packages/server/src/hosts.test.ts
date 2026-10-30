import { afterAll, describe, expect, it } from 'vitest';

import { HostRegistry, sqliteOnSeveralHosts } from './hosts.ts';
import { createRedis } from './redis.ts';
import { RUNS_WITH_REDIS, testRedisUrl } from './testing.ts';

describe.skipIf(!RUNS_WITH_REDIS)('HostRegistry', () => {
    const redis = createRedis(testRedisUrl() ?? '', 'eclair-test-hosts');
    afterAll(async () => {
        await redis.zrem('eclair:hosts', 'machine-a', 'machine-b', 'machine-c');
        redis.disconnect();
    });

    it('lists the live hosts, and drops the ones that stop', async () => {
        const a = new HostRegistry(redis, 'machine-a', 200);
        const b = new HostRegistry(redis, 'machine-b', 200);
        await a.register();
        await b.register();
        expect(await a.others()).toContain('machine-b');
        expect(await a.live()).toEqual(expect.arrayContaining(['machine-a', 'machine-b']));
        await new Promise((resolve) => setTimeout(resolve, 250));
        await a.register();
        expect(await a.others()).not.toContain('machine-b');
    });

    it('describes the live hosts: versions, and the queues of their processes', async () => {
        const api = new HostRegistry(redis, 'machine-c', 200, { version: '1.2.0', queues: [] });
        const worker = new HostRegistry(redis, 'machine-c', 200, {
            version: '1.2.0',
            queues: [
                { name: 'video', concurrency: 1 },
                { name: 'probe', concurrency: 2 },
            ],
        });
        const other = new HostRegistry(redis, 'machine-c', 200, {
            version: '1.3.0',
            queues: [{ name: 'probe', concurrency: 1 }],
        });
        await Promise.all([api.register(), worker.register(), other.register()]);

        const host = (await api.describe()).find(({ name }) => name === 'machine-c');
        expect(host).toMatchObject({
            name: 'machine-c',
            version: '1.2.0, 1.3.0',
            queues: [
                { name: 'probe', concurrency: 3 },
                { name: 'video', concurrency: 1 },
            ],
        });
        expect(Date.now() - (host?.seenAt.getTime() ?? 0)).toBeLessThan(1000);

        // A process that stops leaves at once; its host stays while another process refreshes it.
        await other.stop();
        expect((await api.describe()).find(({ name }) => name === 'machine-c')).toMatchObject({
            version: '1.2.0',
            queues: [
                { name: 'probe', concurrency: 2 },
                { name: 'video', concurrency: 1 },
            ],
        });

        // A process that stops refreshing drops out with its host.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect((await api.describe()).map(({ name }) => name)).not.toContain('machine-c');
        expect(await redis.hkeys('eclair:hosts:info')).not.toEqual(
            expect.arrayContaining([expect.stringMatching(/^machine-c:/)]),
        );
    });

    it('explains what SQLite on several machines does', () => {
        expect(sqliteOnSeveralHosts(['machine-b'])).toMatch(
            /machine-b.*SQLite.*MySQL or PostgreSQL/,
        );
    });
});
