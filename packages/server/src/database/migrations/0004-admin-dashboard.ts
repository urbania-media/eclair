import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * What the admin API of the dashboard reads (decision 0021): the task of a `task.*` webhook, a
 * job's deliveries, and the indexes that bound the stats of a period.
 */
export function adminDashboard(): Migration {
    return {
        async up(db: Kysely<unknown>) {
            await db.schema
                .alterTable('webhook_deliveries')
                .addColumn('task', 'varchar(64)')
                .execute();
            await db.schema
                .createIndex('webhook_deliveries_job_index')
                .on('webhook_deliveries')
                .column('job_id')
                .execute();
            await db.schema
                .createIndex('webhook_deliveries_created_index')
                .on('webhook_deliveries')
                .column('created_at')
                .execute();
            await db.schema
                .createIndex('tasks_ended_index')
                .on('tasks')
                .column('ended_at')
                .execute();
            await db.schema
                .createIndex('jobs_created_index')
                .on('jobs')
                .column('created_at')
                .execute();
        },
    };
}
