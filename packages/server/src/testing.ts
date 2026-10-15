import { randomBytes } from 'node:crypto';

import { createTestDatabase } from './database/testing.ts';
import { createServices } from './services.ts';
import type { Services } from './services.ts';

/** The repositories on an empty, migrated test database, with a random secret key. Only for tests. */
export async function createTestServices(): Promise<Services & { secretKey: Buffer }> {
    const secretKey = randomBytes(32);
    const database = await createTestDatabase();
    return { ...createServices(database, secretKey), secretKey };
}
