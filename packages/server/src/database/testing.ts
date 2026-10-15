import { createDatabase } from './connection.ts';
import type { Database } from './connection.ts';
import { MIGRATION_LOCK_TABLE, MIGRATION_TABLE, migrateToLatest } from './migrate.ts';

/** Tables, children first, so that dropping them respects foreign keys. */
const TABLES_TO_DROP = [
    'webhook_deliveries',
    'outputs',
    'tasks',
    'usage',
    'uploads',
    'jobs',
    'presets',
    'storages',
    'api_keys',
    'projects',
    MIGRATION_TABLE,
    MIGRATION_LOCK_TABLE,
];

/**
 * The database tests run on: `DATABASE_URL` when it's set (CI runs each database of its matrix),
 * otherwise SQLite in memory.
 */
export function testDatabaseUrl(): string {
    return process.env['DATABASE_URL'] ?? 'sqlite::memory:';
}

/** Drops every Eclair table. Only for tests. */
export async function dropTables(database: Database): Promise<void> {
    for (const table of TABLES_TO_DROP) {
        await database.kysely.schema.dropTable(table).ifExists().execute();
    }
}

/**
 * Connects to the test database, empties it and runs the migrations. Test files that use it run
 * one after the other (see vitest.config.ts), since they share the database.
 */
export async function createTestDatabase(): Promise<Database> {
    const database = createDatabase(testDatabaseUrl(), { poolSize: 2 });
    await dropTables(database);
    await migrateToLatest(database);
    return database;
}
