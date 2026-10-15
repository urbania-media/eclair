import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';

import type { Dialect } from './dialect.ts';

/** Keys that the JSON helpers accept: they end up in a JSON path. */
export const JSON_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The text of a top-level value of a JSON column, the same way on every database (decision 0014):
 * `JSON_UNQUOTE(JSON_EXTRACT(…))` on MySQL, `->>` on PostgreSQL, `json_extract` cast to text on
 * SQLite. Strings and numbers compare the same everywhere; booleans don't (`1` on SQLite).
 */
export function jsonText(dialect: Dialect, column: string, key: string): RawBuilder<string | null> {
    if (!JSON_KEY_PATTERN.test(key)) {
        throw new Error(`"${key}" is not a key the JSON helpers accept.`);
    }
    const path = `$."${key}"`;
    switch (dialect) {
        case 'mysql':
            return sql<string | null>`json_unquote(json_extract(${sql.ref(column)}, ${path}))`;
        case 'postgres':
            return sql<string | null>`(${sql.ref(column)} ->> ${key})`;
        case 'sqlite':
            return sql<string | null>`cast(json_extract(${sql.ref(column)}, ${path}) as text)`;
    }
}
