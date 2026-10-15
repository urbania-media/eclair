import mysql from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

import { isSupportedVersion } from './version.ts';

/**
 * The database dialects Eclair supports. This module is the only place with dialect-specific
 * code: everything else stays portable between them (see decision 0007). SQLite is for
 * development, tests and installs on a single machine.
 */
export type Dialect = 'mysql' | 'postgres' | 'sqlite';

const PROTOCOLS: Partial<Record<string, Dialect>> = {
    'mysql:': 'mysql',
    'postgres:': 'postgres',
    'postgresql:': 'postgres',
    'sqlite:': 'sqlite',
};

function parseUrl(databaseUrl: string): URL {
    try {
        return new URL(databaseUrl);
    } catch {
        // The URL can hold a password: never put it in the message.
        throw new Error('The database URL is not a valid URL.');
    }
}

/** Returns the dialect of a database URL: `mysql://…`, `postgres://…` or `sqlite:…`. */
export function getDialect(databaseUrl: string): Dialect {
    const { protocol } = parseUrl(databaseUrl);
    const dialect = PROTOCOLS[protocol];
    if (dialect === undefined) {
        throw new Error(
            `The database URL must start with mysql://, postgres:// or sqlite:, not ${protocol}.`,
        );
    }
    return dialect;
}

/**
 * Returns the file of a SQLite database URL: `sqlite:///var/lib/eclair/eclair.db` (absolute),
 * `sqlite:data/eclair.db` (relative to the working directory) or `sqlite::memory:`.
 */
export function getSqlitePath(databaseUrl: string): string {
    const url = parseUrl(databaseUrl);
    if (url.protocol !== 'sqlite:') {
        throw new Error('The database URL is not a SQLite URL.');
    }
    if (url.host !== '' || url.username !== '' || url.password !== '') {
        throw new Error(
            'A SQLite database URL has no host: use sqlite:///absolute/path.db or sqlite:relative/path.db.',
        );
    }
    const path = decodeURIComponent(url.pathname);
    if (path === '' || path === '/') {
        throw new Error('The SQLite database URL has no file path.');
    }
    return path;
}

export interface DatabaseStatus {
    dialect: Dialect;
    version: string;
    supported: boolean;
}

/** Connects to the database, reads its server version and disconnects. */
export async function checkDatabase(databaseUrl: string): Promise<DatabaseStatus> {
    const dialect = getDialect(databaseUrl);
    const version = await readVersion[dialect](databaseUrl);
    return { dialect, version, supported: isSupportedVersion(dialect, version) };
}

const readVersion: Record<Dialect, (databaseUrl: string) => Promise<string>> = {
    async mysql(databaseUrl) {
        const connection = await mysql.createConnection(databaseUrl);
        try {
            const [rows] = await connection.query<mysql.RowDataPacket[]>(
                'SELECT VERSION() AS version',
            );
            return String(rows[0]?.['version']);
        } finally {
            await connection.end();
        }
    },

    async postgres(databaseUrl) {
        const client = new pg.Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            const result = await client.query<{ server_version: string }>('SHOW server_version');
            return String(result.rows[0]?.server_version);
        } finally {
            await client.end();
        }
    },

    async sqlite(databaseUrl) {
        const database = new DatabaseSync(getSqlitePath(databaseUrl));
        try {
            const row = database.prepare('SELECT sqlite_version() AS version').get();
            return String(row?.['version']);
        } finally {
            database.close();
        }
    },
};
