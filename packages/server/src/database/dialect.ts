import mysql from 'mysql2/promise';
import pg from 'pg';

import { isSupportedVersion } from './version.ts';

/**
 * The database dialects Eclair supports. This module is the only place with dialect-specific
 * code: everything else stays portable between MySQL and PostgreSQL (see decision 0007).
 */
export type Dialect = 'mysql' | 'postgres';

const PROTOCOLS: Partial<Record<string, Dialect>> = {
    'mysql:': 'mysql',
    'postgres:': 'postgres',
    'postgresql:': 'postgres',
};

/** Returns the dialect of a database URL: `mysql://…` or `postgres://…`. */
export function getDialect(databaseUrl: string): Dialect {
    let protocol: string;
    try {
        protocol = new URL(databaseUrl).protocol;
    } catch {
        // The URL holds a password: never put it in the message.
        throw new Error('The database URL is not a valid URL.');
    }
    const dialect = PROTOCOLS[protocol];
    if (dialect === undefined) {
        throw new Error(
            `The database URL must start with mysql:// or postgres://, not ${protocol}//.`,
        );
    }
    return dialect;
}

export interface DatabaseStatus {
    dialect: Dialect;
    version: string;
    supported: boolean;
}

/** Connects to the database, reads its server version and disconnects. */
export async function checkDatabase(databaseUrl: string): Promise<DatabaseStatus> {
    const dialect = getDialect(databaseUrl);
    const version =
        dialect === 'mysql'
            ? await readMysqlVersion(databaseUrl)
            : await readPostgresVersion(databaseUrl);
    return { dialect, version, supported: isSupportedVersion(dialect, version) };
}

async function readMysqlVersion(databaseUrl: string): Promise<string> {
    const connection = await mysql.createConnection(databaseUrl);
    try {
        const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
        return String(rows[0]?.['version']);
    } finally {
        await connection.end();
    }
}

async function readPostgresVersion(databaseUrl: string): Promise<string> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const result = await client.query<{ server_version: string }>('SHOW server_version');
        return String(result.rows[0]?.server_version);
    } finally {
        await client.end();
    }
}
