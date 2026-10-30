import type { Stats } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import { readDate, readNumber, readOptionalDate } from '../database/values.ts';

export type StatsInterval = Stats['interval'];

const INTERVALS: Record<StatsInterval, number> = { hour: 3_600_000, day: 24 * 3_600_000 };

/** The longest period of each interval: a month of hours, a year of days. */
export const MAX_PERIOD: Record<StatsInterval, number> = {
    hour: 31 * INTERVALS.day,
    day: 366 * INTERVALS.day,
};

const OUTCOMES = ['completed', 'failed', 'canceled', 'skipped'] as const;
type Outcome = (typeof OUTCOMES)[number];

/** The value under which `fraction` of the sorted values fall (nearest rank). */
export function percentile(sorted: readonly number[], fraction: number): number | null {
    if (sorted.length === 0) {
        return null;
    }
    const rank = Math.max(1, Math.ceil(fraction * sorted.length));
    return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/**
 * What an install did over a period (`GET /admin/v1/stats`): the tasks that ended in each UTC
 * hour or day by outcome, each operation's completed and failed tasks with the p50 and p95
 * durations of its completed ones, the webhooks and jobs created in the period. Rows are read
 * within the period, through indexes on when they ended or were created, and aggregated here, so
 * that every database computes the same percentiles.
 */
export async function computeStats(
    database: Database,
    options: {
        since: Date;
        until: Date;
        interval: StatsInterval;
        projectId?: string | undefined;
    },
): Promise<Stats> {
    const { since, until, interval, projectId } = options;
    const length = INTERVALS[interval];

    let tasksQuery = database.kysely
        .selectFrom('tasks')
        .select(['status', 'operation', 'started_at', 'ended_at'])
        .where('ended_at', '>=', since)
        .where('ended_at', '<', until)
        .where('status', 'in', [...OUTCOMES]);
    let webhooksQuery = database.kysely
        .selectFrom('webhook_deliveries')
        .select((eb) => ['status', eb.fn.countAll<number | string>().as('count')])
        .where('created_at', '>=', since)
        .where('created_at', '<', until)
        .groupBy('status');
    let jobsQuery = database.kysely
        .selectFrom('jobs')
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .where('created_at', '>=', since)
        .where('created_at', '<', until);
    if (projectId !== undefined) {
        tasksQuery = tasksQuery.where('project_id', '=', projectId);
        webhooksQuery = webhooksQuery.where('project_id', '=', projectId);
        jobsQuery = jobsQuery.where('project_id', '=', projectId);
    }
    const [tasks, webhooks, jobs] = await Promise.all([
        tasksQuery.execute(),
        webhooksQuery.execute(),
        jobsQuery.executeTakeFirst(),
    ]);

    // Every interval of the period, from the one that holds `since`, even without tasks.
    const first = Math.floor(since.getTime() / length) * length;
    const intervals: Stats['tasks'] = [];
    for (let start = first; start < until.getTime(); start += length) {
        intervals.push({
            start: new Date(start).toISOString(),
            completed: 0,
            failed: 0,
            canceled: 0,
            skipped: 0,
        });
    }

    const operations = new Map<
        string,
        { completed: number; failed: number; durations: number[] }
    >();
    for (const task of tasks) {
        const status = task.status as Outcome;
        const endedAt = readDate(task.ended_at).getTime();
        const slot = intervals[Math.floor((endedAt - first) / length)];
        if (slot !== undefined) {
            slot[status] += 1;
        }
        if (status !== 'completed' && status !== 'failed') {
            continue;
        }
        let operation = operations.get(task.operation);
        if (operation === undefined) {
            operation = { completed: 0, failed: 0, durations: [] };
            operations.set(task.operation, operation);
        }
        operation[status] += 1;
        const startedAt = readOptionalDate(task.started_at)?.getTime();
        if (status === 'completed' && startedAt !== undefined) {
            operation.durations.push(Math.max(0, endedAt - startedAt) / 1000);
        }
    }

    const counts = Object.fromEntries(
        webhooks.map(({ status, count }) => [status, readNumber(count)]),
    );
    return {
        since: since.toISOString(),
        until: until.toISOString(),
        interval,
        tasks: intervals,
        operations: [...operations]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, { completed, failed, durations }]) => {
                const sorted = durations.sort((a, b) => a - b);
                return {
                    name,
                    completed,
                    failed,
                    p50: percentile(sorted, 0.5),
                    p95: percentile(sorted, 0.95),
                };
            }),
        webhooks: {
            delivered: counts['delivered'] ?? 0,
            pending: counts['pending'] ?? 0,
            failed: counts['failed'] ?? 0,
        },
        jobs: { created: readNumber(jobs?.count ?? 0) },
    };
}
