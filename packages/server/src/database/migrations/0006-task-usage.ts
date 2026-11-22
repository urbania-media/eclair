import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import { columnTypes } from '../columns.ts';
import type { Dialect } from '../dialect.ts';

/** What a task used at a paid provider, on any end, failed or canceled included (`TaskUsage`). */
export function taskUsage(dialect: Dialect): Migration {
    const types = columnTypes(dialect);
    return {
        async up(db: Kysely<unknown>) {
            await db.schema.alterTable('tasks').addColumn('usage', types.json).execute();
        },
    };
}
