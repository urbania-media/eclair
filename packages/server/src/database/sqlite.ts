import type { SqliteDatabase, SqliteStatement } from 'kysely';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

/** How long a connection waits for the write lock before failing, in milliseconds. */
const BUSY_TIMEOUT = 5000;

/**
 * Converts a parameter to a value `node:sqlite` binds. It binds a `Date` as `NULL` without an
 * error, so dates become ISO 8601 text with milliseconds, which sorts and compares as text
 * (decision 0016). Booleans become 0 and 1.
 */
export function toSqliteValue(value: unknown): SQLInputValue {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (value === undefined) {
        return null;
    }
    return value as SQLInputValue;
}

function toParameters(parameters: ReadonlyArray<unknown>): SQLInputValue[] {
    return parameters.map(toSqliteValue);
}

/**
 * Opens a SQLite database with `node:sqlite` and gives it the interface of Kysely's
 * `SqliteDialect` (decision 0014). Sets WAL, the busy timeout and foreign keys (decision 0016).
 */
export function openSqlite(path: string): SqliteDatabase {
    const database = new DatabaseSync(path);
    if (path !== ':memory:') {
        database.exec('PRAGMA journal_mode = WAL');
    }
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT}`);
    database.exec('PRAGMA foreign_keys = ON');

    return {
        close: () => database.close(),
        prepare(sql: string): SqliteStatement {
            const statement = database.prepare(sql);
            return {
                // A statement that returns columns is a reader, as better-sqlite3 says.
                reader: statement.columns().length > 0,
                all: (parameters) => statement.all(...toParameters(parameters)),
                run: (parameters) => statement.run(...toParameters(parameters)),
                iterate: (parameters) => statement.iterate(...toParameters(parameters)),
            };
        },
    };
}
