import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import type { Dialect as KyselyDialect } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';

import { getDialect, getSqlitePath } from './dialect.ts';
import type { Dialect } from './dialect.ts';
import { openSqlite } from './sqlite.ts';
import type { Tables } from './tables.ts';

export interface Database {
    kysely: Kysely<Tables>;
    dialect: Dialect;
    /** Runs a trivial query: resolves when the database answers. */
    ping(): Promise<void>;
    close(): Promise<void>;
}

export interface DatabaseOptions {
    /** Connections in the pool, for MySQL and PostgreSQL. SQLite has one connection. */
    poolSize?: number;
}

function createKyselyDialect(databaseUrl: string, options: DatabaseOptions): KyselyDialect {
    const dialect = getDialect(databaseUrl);
    const poolSize = options.poolSize ?? 10;
    switch (dialect) {
        case 'mysql':
            return new MysqlDialect({
                pool: createPool({
                    uri: databaseUrl,
                    connectionLimit: poolSize,
                    // DATETIME has no time zone: Eclair reads and writes it in UTC.
                    timezone: 'Z',
                    // BIGINT as a number when it fits, as a string beyond 2^53.
                    supportBigNumbers: true,
                    charset: 'utf8mb4',
                }),
            });
        case 'postgres':
            return new PostgresDialect({
                pool: new pg.Pool({ connectionString: databaseUrl, max: poolSize }),
            });
        case 'sqlite':
            return new SqliteDialect({ database: openSqlite(getSqlitePath(databaseUrl)) });
    }
}

/** Connects to the database in `DATABASE_URL`. The connection is lazy: nothing happens until a query. */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): Database {
    const kysely = new Kysely<Tables>({ dialect: createKyselyDialect(databaseUrl, options) });
    return {
        kysely,
        dialect: getDialect(databaseUrl),
        async ping() {
            await sql`select 1`.execute(kysely);
        },
        close: () => kysely.destroy(),
    };
}
