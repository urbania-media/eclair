import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import { columnTypes } from '../columns.ts';
import type { Dialect } from '../dialect.ts';

/** The previous webhook secret of a project and when it expires, after a rotation (decision 0018). */
export function previousWebhookSecret(dialect: Dialect): Migration {
    const types = columnTypes(dialect);
    return {
        async up(db: Kysely<unknown>) {
            // One column per statement: SQLite adds a single column per `ALTER TABLE`.
            await db.schema
                .alterTable('projects')
                .addColumn('previous_webhook_secret', 'text')
                .execute();
            await db.schema
                .alterTable('projects')
                .addColumn('previous_webhook_secret_expires_at', types.timestamp)
                .execute();
        },
    };
}
