import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';

import type { Database } from '../database/connection.ts';
import type { Dialect } from '../database/dialect.ts';
import { readNumber } from '../database/values.ts';

export interface UsageLine {
    project: string;
    /** UTC day, `2026-10-15`. */
    day: string;
    tasks: number;
    cpuSeconds: number;
    mediaSeconds: number;
    bytesIn: number;
    bytesOut: number;
    bytesStored: number;
}

/** The UTC day of a timestamp column, as `YYYY-MM-DD` text, on every database. */
function utcDay(dialect: Dialect, column: string): RawBuilder<string> {
    switch (dialect) {
        case 'mysql':
            // DATETIME columns are written in UTC (connection.ts).
            return sql<string>`date_format(${sql.ref(column)}, '%Y-%m-%d')`;
        case 'postgres':
            return sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD')`;
        case 'sqlite':
            // ISO 8601 text in UTC.
            return sql<string>`substr(${sql.ref(column)}, 1, 10)`;
    }
}

/**
 * Usage per project and day (decision 0003), to split the cost of a server between the projects
 * that share it. Usage outlives the jobs it comes from.
 */
export async function usageReport(
    database: Database,
    options: { since: Date; projectId?: string | undefined },
): Promise<UsageLine[]> {
    const day = utcDay(database.dialect, 'usage.created_at');
    let query = database.kysely
        .selectFrom('usage')
        .innerJoin('projects', 'projects.id', 'usage.project_id')
        .select((eb) => [
            'projects.slug as project',
            day.as('day'),
            eb.fn.countAll<number | string>().as('tasks'),
            eb.fn.sum<number | string>('usage.cpu_ms').as('cpu_ms'),
            eb.fn.sum<number | string>('usage.media_ms').as('media_ms'),
            eb.fn.sum<number | string>('usage.bytes_in').as('bytes_in'),
            eb.fn.sum<number | string>('usage.bytes_out').as('bytes_out'),
            eb.fn.sum<number | string>('usage.bytes_stored').as('bytes_stored'),
        ])
        .where('usage.created_at', '>=', options.since)
        .groupBy(['projects.slug', day])
        .orderBy('projects.slug')
        .orderBy(day);
    if (options.projectId !== undefined) {
        query = query.where('usage.project_id', '=', options.projectId);
    }
    const rows = await query.execute();
    return rows.map((row) => ({
        project: row.project,
        day: row.day,
        tasks: readNumber(row.tasks),
        cpuSeconds: Math.round(readNumber(row.cpu_ms ?? 0) / 100) / 10,
        mediaSeconds: Math.round(readNumber(row.media_ms ?? 0) / 100) / 10,
        bytesIn: readNumber(row.bytes_in ?? 0),
        bytesOut: readNumber(row.bytes_out ?? 0),
        bytesStored: readNumber(row.bytes_stored ?? 0),
    }));
}
