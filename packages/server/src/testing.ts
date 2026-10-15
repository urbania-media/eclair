import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestDatabase } from './database/testing.ts';
import { TaskQueues } from './jobs/queues.ts';
import type { OperationRegistry } from './operations/registry.ts';
import { createRedis } from './redis.ts';
import { createServices } from './services.ts';
import type { ServerLimits, Services } from './services.ts';
import { LocalDriver } from './storages/drivers/local.ts';
import { TemporaryStorage } from './storages/temporary.ts';

/**
 * The repositories on an empty, migrated test database, with a random secret key and a temporary
 * storage in a new local directory. Only for tests.
 */
export async function createTestServices(
    options: {
        operations?: OperationRegistry;
        limits?: Partial<ServerLimits>;
        /** Creates empty task queues in the test Redis (see `testRedisUrl()`). */
        queues?: boolean;
    } = {},
): Promise<Services & { secretKey: Buffer; temporaryRoot: string; close(): Promise<void> }> {
    const secretKey = randomBytes(32);
    const root = mkdtempSync(join(tmpdir(), 'eclair-test-'));
    const temporaryRoot = join(root, 'storage');
    const database = await createTestDatabase();
    let queues: TaskQueues | undefined;
    let redis: ReturnType<typeof createRedis> | undefined;
    if (options.queues === true) {
        redis = createRedis(testRedisUrl() ?? '', 'eclair-test');
        queues = new TaskQueues(redis);
        await queues.obliterate();
    }
    const services = createServices({
        database,
        secretKey,
        temporary: new TemporaryStorage(new LocalDriver(temporaryRoot)),
        limits: {
            tempRetention: 24 * 3_600_000,
            tempMaxRetention: 7 * 24 * 3_600_000,
            maxInputSize: 2 * 1024 ** 3,
            tmpDir: join(root, 'tmp'),
            ...options.limits,
        },
        operations: options.operations,
        queues,
    });
    return {
        ...services,
        secretKey,
        temporaryRoot,
        async close() {
            await queues?.close();
            redis?.disconnect();
            await database.close();
        },
    };
}

/**
 * The Redis of the tests, from `ECLAIR_TEST_REDIS_URL`. Tests that need it are skipped without it,
 * except in CI (`ECLAIR_TEST_DIALECT` set), where it's required.
 */
export function testRedisUrl(): string | undefined {
    return process.env['ECLAIR_TEST_REDIS_URL'];
}

/** Whether the tests that need Redis run: with a test Redis, and always in CI. */
export const RUNS_WITH_REDIS =
    process.env['ECLAIR_TEST_REDIS_URL'] !== undefined ||
    process.env['ECLAIR_TEST_DIALECT'] !== undefined;
