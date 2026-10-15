import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestDatabase } from './database/testing.ts';
import type { OperationRegistry } from './operations/registry.ts';
import { createServices } from './services.ts';
import type { ServerLimits, Services } from './services.ts';
import { LocalDriver } from './storages/drivers/local.ts';
import { TemporaryStorage } from './storages/temporary.ts';

/**
 * The repositories on an empty, migrated test database, with a random secret key and a temporary
 * storage in a new local directory. Only for tests.
 */
export async function createTestServices(
    options: { operations?: OperationRegistry; limits?: Partial<ServerLimits> } = {},
): Promise<Services & { secretKey: Buffer; temporaryRoot: string }> {
    const secretKey = randomBytes(32);
    const root = mkdtempSync(join(tmpdir(), 'eclair-test-'));
    const temporaryRoot = join(root, 'storage');
    const database = await createTestDatabase();
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
    });
    return { ...services, secretKey, temporaryRoot };
}
