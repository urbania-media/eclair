import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createId } from '../ids.ts';
import type { Database } from './connection.ts';
import {
    MIGRATION_LOCK_TABLE,
    MIGRATION_TABLE,
    migrateToLatest,
    pendingMigrations,
} from './migrate.ts';
import { COLUMNS } from './tables.ts';
import { createTestDatabase } from './testing.ts';
import { readBoolean, readDate, readJson, readNumber, readOptionalDate, toJson } from './values.ts';

let database: Database;

beforeAll(async () => {
    database = await createTestDatabase();
});

afterAll(async () => {
    await database.close();
});

describe('migrations', () => {
    it('leave nothing pending, and running them again does nothing', async () => {
        expect(await pendingMigrations(database)).toEqual([]);
        expect(await migrateToLatest(database)).toEqual([]);
    });

    it('create exactly the tables and columns of the table types', async () => {
        const tables = await database.kysely.introspection.getTables();
        const actual = Object.fromEntries(
            tables
                .filter(({ name }) => name !== MIGRATION_TABLE && name !== MIGRATION_LOCK_TABLE)
                .map(({ name, columns }) => [name, columns.map((column) => column.name).sort()]),
        );
        const expected = Object.fromEntries(
            Object.entries(COLUMNS).map(([name, columns]) => [name, [...columns].sort()]),
        );
        expect(actual).toEqual(expected);
    });
});

describe(`values on ${process.env['ECLAIR_TEST_DIALECT'] ?? 'the test database'}`, () => {
    it('read back as they were written', async () => {
        const now = new Date('2026-10-15T14:00:00.123Z');
        const projectId = createId('project');
        await database.kysely
            .insertInto('projects')
            .values({
                id: projectId,
                slug: 'niche',
                name: 'Niche',
                priority: 'normal',
                settings: toJson({ limits: { concurrency: 4 }, operations: ['probe'] }),
                webhook_secret: 'encrypted',
                created_at: now,
                updated_at: now,
            })
            .execute();

        const jobId = createId('job');
        await database.kysely
            .insertInto('jobs')
            .values({
                id: jobId,
                project_id: projectId,
                status: 'pending',
                priority: 'normal',
                input: toJson({ url: 'https://example.com/a.mp4' }),
                metadata: toJson({ mediaId: 42, tags: ['a', 'b'] }),
                fail_fast: true,
                created_at: now,
                updated_at: now,
            })
            .execute();

        const job = await database.kysely
            .selectFrom('jobs')
            .selectAll()
            .where('id', '=', jobId)
            .executeTakeFirstOrThrow();
        expect(readDate(job.created_at)).toEqual(now);
        expect(readOptionalDate(job.ended_at)).toBeUndefined();
        expect(readJson(job.metadata)).toEqual({ mediaId: 42, tags: ['a', 'b'] });
        expect(readBoolean(job.fail_fast)).toBe(true);

        // Dates compare as dates in queries, whatever the database stores.
        const later = await database.kysely
            .selectFrom('jobs')
            .select('id')
            .where('created_at', '>', new Date('2026-10-15T13:59:59.999Z'))
            .execute();
        expect(later.map(({ id }) => id)).toEqual([jobId]);

        const taskId = createId('task');
        await database.kysely
            .insertInto('tasks')
            .values({
                id: taskId,
                job_id: jobId,
                project_id: projectId,
                name: 'h264',
                operation: 'video.transcode',
                operation_version: 1,
                queue: 'video',
                options: toJson({}),
                dependencies: toJson([]),
                keep: false,
                status: 'pending',
                attempts: 0,
                progress: 0.5,
                created_at: now,
                updated_at: now,
            })
            .execute();
        await database.kysely
            .insertInto('outputs')
            .values({
                id: createId('output'),
                task_id: taskId,
                job_id: jobId,
                project_id: projectId,
                kind: 'file',
                name: 'h264',
                size: 5 * 1024 ** 3,
                expired: false,
                created_at: now,
            })
            .execute();
        const output = await database.kysely
            .selectFrom('outputs')
            .select(['size', 'expired'])
            .executeTakeFirstOrThrow();
        expect(readNumber(output.size)).toBe(5 * 1024 ** 3);
        expect(readBoolean(output.expired)).toBe(false);

        const task = await database.kysely
            .selectFrom('tasks')
            .select(['progress', 'keep'])
            .executeTakeFirstOrThrow();
        expect(task.progress).toBe(0.5);
        expect(readBoolean(task.keep)).toBe(false);
    });

    it('compare text exactly, case included', async () => {
        const now = new Date();
        await database.kysely
            .insertInto('projects')
            .values({
                id: createId('project'),
                slug: 'Case',
                name: 'Case',
                priority: 'normal',
                settings: toJson({}),
                webhook_secret: 'encrypted',
                created_at: now,
                updated_at: now,
            })
            .execute();
        const rows = await database.kysely
            .selectFrom('projects')
            .select('slug')
            .where('slug', '=', 'case')
            .execute();
        expect(rows).toEqual([]);
    });

    it('delete the rows of a project with it', async () => {
        await database.kysely.deleteFrom('projects').execute();
        const tasks = await database.kysely.selectFrom('tasks').select('id').execute();
        expect(tasks).toEqual([]);
    });
});
