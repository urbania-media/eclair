import { sql } from 'kysely';
import type { ColumnDataType, CreateTableBuilder, Expression } from 'kysely';

import type { Dialect } from './dialect.ts';

type DataType = ColumnDataType | Expression<unknown>;

/**
 * Column types for migrations, per dialect (decisions 0014 and 0016). Migrations only use these
 * and the portable types of the schema builder (`varchar(n)`, `integer`, `bigint`, `text`).
 */
export interface ColumnTypes {
    /** Prefixed ULIDs and other identifiers. */
    id: DataType;
    timestamp: DataType;
    json: DataType;
    boolean: DataType;
    double: DataType;
}

export function columnTypes(dialect: Dialect): ColumnTypes {
    switch (dialect) {
        case 'mysql':
            return {
                id: 'varchar(32)',
                timestamp: sql`datetime(3)`,
                json: 'json',
                boolean: 'boolean',
                double: sql`double`,
            };
        case 'postgres':
            return {
                id: 'varchar(32)',
                timestamp: sql`timestamptz(3)`,
                json: 'json',
                boolean: 'boolean',
                double: 'double precision',
            };
        case 'sqlite':
            return {
                id: 'varchar(32)',
                // ISO 8601 text with milliseconds, which sorts and compares as text.
                timestamp: 'text',
                json: 'text',
                boolean: 'integer',
                double: 'real',
            };
    }
}

/**
 * Finishes a `CREATE TABLE` for the dialect. MySQL tables use `utf8mb4` with a binary collation,
 * so names and keys compare exactly, as on PostgreSQL and SQLite.
 */
export function finishTable<Name extends string, Columns extends string>(
    dialect: Dialect,
    table: CreateTableBuilder<Name, Columns>,
): CreateTableBuilder<Name, Columns> {
    return dialect === 'mysql'
        ? table.modifyEnd(sql`engine = InnoDB default charset = utf8mb4 collate = utf8mb4_bin`)
        : table;
}
