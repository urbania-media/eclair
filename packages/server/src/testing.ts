import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestDatabase } from './database/testing.ts';
import { TaskQueues } from './jobs/queues.ts';
import type { TaskQueueOptions } from './jobs/queues.ts';
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
        /** Creates empty task queues in the test Redis (see `testRedisUrl()`), with these options. */
        queues?: boolean | TaskQueueOptions;
    } = {},
): Promise<
    Services & {
        secretKey: Buffer;
        temporaryRoot: string;
        /** The test Redis, with `queues`. */
        redis: Redis | undefined;
        close(): Promise<void>;
    }
> {
    const secretKey = randomBytes(32);
    const root = mkdtempSync(join(tmpdir(), 'eclair-test-'));
    const temporaryRoot = join(root, 'storage');
    const database = await createTestDatabase();
    let queues: TaskQueues | undefined;
    let redis: Redis | undefined;
    if (options.queues !== undefined && options.queues !== false) {
        redis = createRedis(testRedisUrl() ?? '', 'eclair-test');
        queues = new TaskQueues(redis, options.queues === true ? {} : options.queues);
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
        redis,
        publicUrl: 'https://eclair.test',
        // Webhooks go to local receivers in tests, and retry fast.
        guard: { allowHttp: true, allowPrivateAddresses: true },
        webhookBackoff: () => 50,
    });
    return {
        ...services,
        secretKey,
        temporaryRoot,
        redis,
        async close() {
            await services.webhooks?.close();
            await services.events?.close();
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

/**
 * A whole Eclair on a random local port, for the tests of clients: the API, a worker for every
 * queue with the built-in operations, and a project with a key. Needs the test Redis.
 */
export async function startTestServer(): Promise<{
    url: string;
    token: string;
    webhookSecret: string;
    services: Awaited<ReturnType<typeof createTestServices>>;
    close(): Promise<void>;
}> {
    const { BUILT_IN_PLUGINS, OperationRegistry } = await import('./operations/registry.ts');
    const { buildApp } = await import('./http/app.ts');
    const { CancelBus } = await import('./workers/cancel.ts');
    const { TaskRunner } = await import('./workers/runner.ts');
    const { ProjectSlots } = await import('./workers/slots.ts');
    const { TaskWorkers } = await import('./workers/workers.ts');

    const services = await createTestServices({
        operations: await OperationRegistry.load(BUILT_IN_PLUGINS),
        queues: { attempts: 2, backoff: 50 },
    });
    const { redis, scheduler, operations } = services;
    if (redis === undefined || scheduler === undefined || operations === undefined) {
        throw new Error('The test server needs the test Redis (ECLAIR_TEST_REDIS_URL).');
    }
    await services.webhooks?.obliterate();
    await services.webhooks?.start();
    const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const cancel = new CancelBus(redis);
    scheduler.onCancelRunning((taskIds) => cancel.publish(taskIds));
    const workers = new TaskWorkers({
        connection: redis,
        queues: [
            { name: 'cpu', concurrency: 2 },
            { name: 'video', concurrency: 1 },
            { name: 'probe', concurrency: 2 },
        ],
        runner: new TaskRunner({
            database: services.database,
            scheduler,
            operations,
            projects: services.projects,
            resolver: services.resolver,
            uploads: services.uploads,
            config: {
                binaries: {} as never,
                tmpDir: services.limits.tmpDir,
                taskTimeout: 60_000,
                maxInputSize: services.limits.maxInputSize,
                tempRetention: services.limits.tempRetention,
                tempMaxRetention: services.limits.tempMaxRetention,
            },
            worker: 'test-server',
            logger: silent,
            webhooks: services.webhooks,
        }),
        slots: new ProjectSlots(redis),
        cancel,
        projects: services.projects,
        logger: silent,
    });
    await workers.start();

    const { project, webhookSecret } = await services.projects.create({
        slug: `client-${Date.now()}`,
    });
    const { token } = await services.apiKeys.create(project.id);
    const app = buildApp({ version: 'test', services });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    return {
        url: `http://127.0.0.1:${port}`,
        token,
        webhookSecret,
        services,
        async close() {
            await app.close();
            await workers.close();
            await services.close();
        },
    };
}
