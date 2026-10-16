import { afterAll, describe, expect, it } from 'vitest';

import { HostRegistry, sqliteOnSeveralHosts } from './hosts.ts';
import { createRedis } from './redis.ts';
import { RUNS_WITH_REDIS, testRedisUrl } from './testing.ts';

describe.skipIf(!RUNS_WITH_REDIS)('HostRegistry', () => {
    const redis = createRedis(testRedisUrl() ?? '', 'eclair-test-hosts');
    afterAll(async () => {
        await redis.zrem('eclair:hosts', 'machine-a', 'machine-b');
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

    it('explains what SQLite on several machines does', () => {
        expect(sqliteOnSeveralHosts(['machine-b'])).toMatch(
            /machine-b.*SQLite.*MySQL or PostgreSQL/,
        );
    });
});
