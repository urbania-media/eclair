import { Migrator } from 'kysely/migration';
import type { MigrationResult } from 'kysely/migration';

import type { Database } from './connection.ts';
import { migrations } from './migrations/index.ts';

export const MIGRATION_TABLE = 'eclair_migrations';
export const MIGRATION_LOCK_TABLE = 'eclair_migrations_lock';

function createMigrator(database: Database): Migrator {
    return new Migrator({
        db: database.kysely,
        provider: { getMigrations: async () => migrations(database.dialect) },
        migrationTableName: MIGRATION_TABLE,
        migrationLockTableName: MIGRATION_LOCK_TABLE,
    });
}

export interface MigrationStatus {
    name: string;
    executedAt: Date | undefined;
}

/** Lists every migration and when it ran. */
export async function migrationStatus(database: Database): Promise<MigrationStatus[]> {
    const list = await createMigrator(database).getMigrations();
    return list.map(({ name, executedAt }) => ({ name, executedAt }));
}

/** Names of the migrations that haven't run yet. */
export async function pendingMigrations(database: Database): Promise<string[]> {
    return (await migrationStatus(database))
        .filter((migration) => migration.executedAt === undefined)
        .map((migration) => migration.name);
}

/**
 * Runs the migrations that haven't run yet. Several processes can call it at once: Kysely takes a
 * lock, so each migration runs once. Throws the first error, after recording which ran.
 */
export async function migrateToLatest(database: Database): Promise<MigrationResult[]> {
    const { error, results } = await createMigrator(database).migrateToLatest();
    if (error !== undefined) {
        throw error instanceof Error ? error : new Error(String(error));
    }
    return results ?? [];
}
