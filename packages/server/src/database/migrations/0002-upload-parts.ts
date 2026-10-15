import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import { columnTypes } from '../columns.ts';
import type { Dialect } from '../dialect.ts';

/** The parts of a resumable upload: `[{ offset, size }]`, each stored as its own file. */
export function uploadParts(dialect: Dialect): Migration {
    const types = columnTypes(dialect);
    return {
        async up(db: Kysely<unknown>) {
            await db.schema.alterTable('uploads').addColumn('parts', types.json).execute();
        },
    };
}
