import type { ForeignKeyConstraintBuilder, Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import { columnTypes, finishTable } from '../columns.ts';
import type { Dialect } from '../dialect.ts';

/** The first schema: every table of the data model in `docs/architecture.md`. */
export function initial(dialect: Dialect): Migration {
    const types = columnTypes(dialect);

    return {
        async up(db: Kysely<unknown>) {
            const createTable = (name: string) => db.schema.createTable(name);
            const cascade = (constraint: ForeignKeyConstraintBuilder) =>
                constraint.onDelete('cascade');

            await finishTable(
                dialect,
                createTable('projects')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('slug', 'varchar(64)', (column) => column.notNull().unique())
                    .addColumn('name', 'varchar(255)', (column) => column.notNull())
                    .addColumn('priority', 'varchar(16)', (column) => column.notNull())
                    .addColumn('settings', types.json, (column) => column.notNull())
                    .addColumn('webhook_url', 'text')
                    .addColumn('webhook_secret', 'text', (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addColumn('disabled_at', types.timestamp),
            ).execute();

            await finishTable(
                dialect,
                createTable('api_keys')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('name', 'varchar(255)', (column) => column.notNull())
                    .addColumn('prefix', 'varchar(32)', (column) => column.notNull())
                    .addColumn('hash', 'varchar(64)', (column) => column.notNull().unique())
                    .addColumn('scopes', types.json, (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('last_used_at', types.timestamp)
                    .addColumn('revoked_at', types.timestamp)
                    .addForeignKeyConstraint(
                        'api_keys_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();

            await finishTable(
                dialect,
                createTable('storages')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('name', 'varchar(64)', (column) => column.notNull())
                    .addColumn('kind', 'varchar(16)', (column) => column.notNull())
                    .addColumn('config', 'text', (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addUniqueConstraint('storages_project_name_unique', ['project_id', 'name'])
                    .addForeignKeyConstraint(
                        'storages_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();

            await finishTable(
                dialect,
                createTable('presets')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('scope', 'varchar(32)', (column) => column.notNull())
                    .addColumn('project_id', types.id)
                    .addColumn('name', 'varchar(128)', (column) => column.notNull())
                    .addColumn('version', 'integer', (column) => column.notNull())
                    .addColumn('tasks', types.json, (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addUniqueConstraint('presets_scope_name_unique', ['scope', 'name'])
                    .addForeignKeyConstraint(
                        'presets_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();

            await finishTable(
                dialect,
                createTable('jobs')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('status', 'varchar(16)', (column) => column.notNull())
                    .addColumn('priority', 'varchar(16)', (column) => column.notNull())
                    .addColumn('input', types.json, (column) => column.notNull())
                    .addColumn('output', types.json)
                    .addColumn('preset', 'varchar(128)')
                    .addColumn('preset_version', 'integer')
                    .addColumn('webhook_url', 'text')
                    .addColumn('metadata', types.json, (column) => column.notNull())
                    .addColumn('fail_fast', types.boolean, (column) => column.notNull())
                    .addColumn('idempotency_key', 'varchar(255)')
                    .addColumn('request_hash', 'varchar(64)')
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addColumn('started_at', types.timestamp)
                    .addColumn('ended_at', types.timestamp)
                    // Unique only where the key is set: NULLs are distinct on every database.
                    .addUniqueConstraint('jobs_project_idempotency_unique', [
                        'project_id',
                        'idempotency_key',
                    ])
                    .addForeignKeyConstraint(
                        'jobs_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();
            await db.schema
                .createIndex('jobs_project_created_index')
                .on('jobs')
                .columns(['project_id', 'created_at'])
                .execute();
            await db.schema
                .createIndex('jobs_status_index')
                .on('jobs')
                .columns(['status', 'ended_at'])
                .execute();

            await finishTable(
                dialect,
                createTable('tasks')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('job_id', types.id, (column) => column.notNull())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('name', 'varchar(64)', (column) => column.notNull())
                    .addColumn('operation', 'varchar(64)', (column) => column.notNull())
                    .addColumn('operation_version', 'integer', (column) => column.notNull())
                    .addColumn('queue', 'varchar(16)', (column) => column.notNull())
                    .addColumn('options', types.json, (column) => column.notNull())
                    .addColumn('source', 'varchar(128)')
                    .addColumn('dependencies', types.json, (column) => column.notNull())
                    .addColumn('condition', types.json)
                    .addColumn('keep', types.boolean, (column) => column.notNull())
                    .addColumn('status', 'varchar(16)', (column) => column.notNull())
                    .addColumn('attempts', 'integer', (column) => column.notNull())
                    .addColumn('progress', types.double)
                    .addColumn('error', types.json)
                    .addColumn('worker', 'varchar(255)')
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addColumn('queued_at', types.timestamp)
                    .addColumn('started_at', types.timestamp)
                    .addColumn('ended_at', types.timestamp)
                    .addUniqueConstraint('tasks_job_name_unique', ['job_id', 'name'])
                    .addForeignKeyConstraint('tasks_job_fk', ['job_id'], 'jobs', ['id'], cascade),
            ).execute();
            await db.schema
                .createIndex('tasks_status_queue_index')
                .on('tasks')
                .columns(['status', 'queue'])
                .execute();

            await finishTable(
                dialect,
                createTable('outputs')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('task_id', types.id, (column) => column.notNull())
                    .addColumn('job_id', types.id, (column) => column.notNull())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('kind', 'varchar(16)', (column) => column.notNull())
                    .addColumn('name', 'varchar(255)', (column) => column.notNull())
                    .addColumn('storage', 'varchar(64)')
                    .addColumn('path', 'text')
                    .addColumn('mime', 'varchar(255)')
                    .addColumn('size', 'bigint')
                    .addColumn('checksum', 'varchar(128)')
                    .addColumn('role', 'varchar(32)')
                    .addColumn('count', 'integer')
                    .addColumn('data', types.json)
                    .addColumn('expires_at', types.timestamp)
                    .addColumn('expired', types.boolean, (column) => column.notNull())
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addForeignKeyConstraint(
                        'outputs_task_fk',
                        ['task_id'],
                        'tasks',
                        ['id'],
                        cascade,
                    ),
            ).execute();
            await db.schema
                .createIndex('outputs_job_index')
                .on('outputs')
                .column('job_id')
                .execute();
            await db.schema
                .createIndex('outputs_expires_index')
                .on('outputs')
                .columns(['expired', 'expires_at'])
                .execute();

            await finishTable(
                dialect,
                createTable('uploads')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('path', 'text', (column) => column.notNull())
                    .addColumn('size', 'bigint')
                    .addColumn('received', 'bigint', (column) => column.notNull())
                    .addColumn('mime', 'varchar(255)')
                    .addColumn('checksum', 'varchar(128)')
                    .addColumn('metadata', types.json)
                    .addColumn('expires_at', types.timestamp, (column) => column.notNull())
                    .addColumn('completed_at', types.timestamp)
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addForeignKeyConstraint(
                        'uploads_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();
            await db.schema
                .createIndex('uploads_expires_index')
                .on('uploads')
                .column('expires_at')
                .execute();

            // Usage outlives jobs, which are pruned: no foreign key to them.
            await finishTable(
                dialect,
                createTable('usage')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('job_id', types.id)
                    .addColumn('task_id', types.id)
                    .addColumn('operation', 'varchar(64)', (column) => column.notNull())
                    .addColumn('cpu_ms', 'bigint', (column) => column.notNull())
                    .addColumn('media_ms', 'bigint', (column) => column.notNull())
                    .addColumn('bytes_in', 'bigint', (column) => column.notNull())
                    .addColumn('bytes_out', 'bigint', (column) => column.notNull())
                    .addColumn('bytes_stored', 'bigint', (column) => column.notNull())
                    .addColumn('cost', types.double)
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addForeignKeyConstraint(
                        'usage_project_fk',
                        ['project_id'],
                        'projects',
                        ['id'],
                        cascade,
                    ),
            ).execute();
            await db.schema
                .createIndex('usage_project_created_index')
                .on('usage')
                .columns(['project_id', 'created_at'])
                .execute();

            await finishTable(
                dialect,
                createTable('webhook_deliveries')
                    .addColumn('id', types.id, (column) => column.primaryKey())
                    .addColumn('project_id', types.id, (column) => column.notNull())
                    .addColumn('job_id', types.id, (column) => column.notNull())
                    .addColumn('event', 'varchar(32)', (column) => column.notNull())
                    .addColumn('url', 'text', (column) => column.notNull())
                    .addColumn('status', 'varchar(16)', (column) => column.notNull())
                    .addColumn('attempts', 'integer', (column) => column.notNull())
                    .addColumn('response_status', 'integer')
                    .addColumn('next_attempt_at', types.timestamp)
                    .addColumn('delivered_at', types.timestamp)
                    .addColumn('created_at', types.timestamp, (column) => column.notNull())
                    .addColumn('updated_at', types.timestamp, (column) => column.notNull())
                    .addForeignKeyConstraint(
                        'webhook_deliveries_job_fk',
                        ['job_id'],
                        'jobs',
                        ['id'],
                        cascade,
                    ),
            ).execute();
            await db.schema
                .createIndex('webhook_deliveries_status_index')
                .on('webhook_deliveries')
                .columns(['status', 'next_attempt_at'])
                .execute();
        },
    };
}
