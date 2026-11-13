import type { ForeignKeyConstraintBuilder, Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import { columnTypes, finishTable } from '../columns.ts';
import type { Dialect } from '../dialect.ts';

/** The credentials of a project for each embed provider, encrypted (decision 0022). */
export function credentials(dialect: Dialect): Migration {
    const types = columnTypes(dialect);
    return {
        async up(db: Kysely<unknown>) {
            await finishTable(
                dialect,
                db.schema
                    .createTable('credentials')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('provider', 'varchar(64)', (column) => column.notNull())
                    .addColumn('config', 'text', (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addUniqueConstraint('credentials_project_provider_unique', [
                        'project_id',
                        'provider',
                    ])
                    .addForeignKeyConstraint(
                        'credentials_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        (constraint: ForeignKeyConstraintBuilder) => constraint.onDelete('cascade'),
                    ),
            ).execute();
        },
    };
}
