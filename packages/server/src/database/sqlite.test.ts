import { Kysely, SqliteDialect, sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { openSqlite, toSqliteValue } from './sqlite.ts';

describe('toSqliteValue', () => {
    it('writes dates as ISO 8601 text and booleans as integers', () => {
        expect(toSqliteValue(new Date('2026-10-15T14:00:00.123Z'))).toBe(
            '2026-10-15T14:00:00.123Z',
        );
        expect(toSqliteValue(true)).toBe(1);
        expect(toSqliteValue(false)).toBe(0);
        expect(toSqliteValue(undefined)).toBe(null);
        expect(toSqliteValue('text')).toBe('text');
    });
});

describe('openSqlite', () => {
    it("gives Kysely's SqliteDialect what it needs", async () => {
        const db = new Kysely<{ items: { id: number; at: string; done: number } }>({
            dialect: new SqliteDialect({ database: openSqlite(':memory:') }),
        });
        await db.schema
            .createTable('items')
            .addColumn('id', 'integer', (column) => column.primaryKey())
            .addColumn('at', 'text')
            .addColumn('done', 'integer')
            .execute();

        const at = new Date('2026-10-15T14:00:00.123Z');
        const result = await db
            .insertInto('items')
            .values({ id: 1, at: at as unknown as string, done: true as unknown as number })
            .executeTakeFirst();
        expect(result.numInsertedOrUpdatedRows).toBe(1n);
        expect(await db.selectFrom('items').selectAll().execute()).toEqual([
            { id: 1, at: '2026-10-15T14:00:00.123Z', done: 1 },
        ]);

        const updated = await db.updateTable('items').set({ done: 0 }).executeTakeFirst();
        expect(updated.numUpdatedRows).toBe(1n);

        const { rows } = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db);
        expect(rows[0]?.foreign_keys).toBe(1);
        await db.destroy();
    });
});
