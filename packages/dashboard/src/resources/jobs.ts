import type { Item, ListQuery } from '@panneau/protocol';

import type { AdminJob, AdminJobList, Job } from '@eclair-js/protocol';

import type { ResourceHandler } from '../adapter/adapter.ts';
import type { RequestInit } from '../adapter/client.ts';
import { notFound } from '../adapter/client.ts';
import { filterValue, forEachItem, selectedIds } from './paging.ts';

const ACTIVE = new Set(['pending', 'running']);
const STOPPED = new Set(['failed', 'canceled']);

/** What a job runs: its preset and version, or its operations. */
export function describeJob(job: Job): string {
    if (job.preset !== undefined) {
        return `${job.preset.name} v${job.preset.version}`;
    }
    const operations = Object.values(job.tasks).map((task) => task.op.replace(/@\d+$/, ''));
    return [...new Set(operations)].join(', ');
}

/** The seconds a job took, or has taken so far. */
export function jobDuration(job: Job, now = Date.now()): number | null {
    if (job.startedAt === undefined) {
        return null;
    }
    const end = job.endedAt !== undefined ? Date.parse(job.endedAt) : now;
    return Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
}

export function jobItem(job: AdminJob): Item {
    const tasks = Object.values(job.tasks);
    return {
        id: job.id,
        version: null,
        abilities: {
            update: false,
            cancel: ACTIVE.has(job.status),
            retry: STOPPED.has(job.status),
        },
        project: job.project,
        status: job.status,
        tasks: {
            done: tasks.filter((task) => task.status === 'completed' || task.status === 'skipped')
                .length,
            total: tasks.length,
            failed: tasks.some((task) => task.status === 'failed'),
        },
        what: describeJob(job),
        metadata:
            job.metadata !== undefined
                ? Object.entries(job.metadata)
                      .map(
                          ([key, value]) =>
                              `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
                      )
                      .join(', ')
                : null,
        duration: jobDuration(job),
        createdAt: job.createdAt,
    };
}

/** The query of `GET /admin/v1/jobs` for a list query, without its page. */
function jobsQuery(query: ListQuery): RequestInit['query'] {
    const status = query.filter?.status;
    const created = query.filter?.created as { from?: string; to?: string } | undefined;
    const params: NonNullable<RequestInit['query']> = {
        project: filterValue(query, 'project'),
        operation: filterValue(query, 'operation'),
        status: Array.isArray(status)
            ? status.map(String)
            : typeof status === 'string' && status !== ''
              ? [status]
              : undefined,
        createdAfter: created?.from ? `${created.from}T00:00:00.000Z` : undefined,
        createdBefore: created?.to ? `${created.to}T23:59:59.999Z` : undefined,
    };
    // The search is a metadata value (`mediaId=42`): a job id goes to the job itself.
    const q = query.q?.trim() ?? '';
    const match = /^([^=\s]+)\s*=\s*(.*)$/.exec(q);
    if (match !== null) {
        params[`metadata[${match[1]}]`] = match[2] ?? '';
    }
    return params;
}

/**
 * Jobs of every project, the newest first, paged with the admin API's cursors (`pagination:
 * "cursor"` in the definition): too many to count.
 */
export const jobs: ResourceHandler = {
    async list(query, { client, signal }) {
        const perPage = Math.min(query.perPage ?? 50, 100);
        const q = query.q?.trim() ?? '';
        if (/^job_/.test(q)) {
            const job = await client
                .request<AdminJob>(`/jobs/${encodeURIComponent(q)}`, { signal })
                .then((found) => [found])
                .catch(() => []);
            return { data: job.map(jobItem), meta: { perPage, nextCursor: null } };
        }
        const page = await client.request<AdminJobList>('/jobs', {
            query: { ...jobsQuery(query), limit: perPage, cursor: query.cursor },
            signal,
        });
        return {
            data: page.data.map(jobItem),
            meta: { perPage, nextCursor: page.nextCursor },
        };
    },

    async get(id, { client, signal }) {
        return jobItem(
            await client.request<AdminJob>(`/jobs/${encodeURIComponent(id)}`, { signal }),
        );
    },

    async runAction(action, request, { client, signal }) {
        if (action !== 'cancel' && action !== 'retry') {
            throw notFound(`Jobs have no action "${action}".`);
        }
        const result = await forEachItem(selectedIds(request), (id) =>
            client.request(`/jobs/${encodeURIComponent(id)}/${action}`, {
                method: 'POST',
                signal,
            }),
        );
        // Cancelling or retrying changes the job's status: other filtered pages move too.
        return { result: { ...result, refresh: 'list' as const } };
    },
};
