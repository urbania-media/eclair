import type { Item, ListQuery } from '@panneau/protocol';

import type { AdminJob, AdminJobList, Job } from '@eclair-js/protocol';

import type { HandlerContext, ResourceHandler } from '../adapter/adapter.ts';
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
 * Jobs of every project, the newest first. The admin API pages them with a cursor, and Panneau's
 * lists with page numbers: the cursors of each query are kept, and a page further than the known
 * ones is reached by reading the pages before it. Without a total, the list knows there is a next
 * page, not how many: https://github.com/folkloreinc/panneau-js/issues/150
 */
export function createJobs(): ResourceHandler {
    const cursors = new Map<string, (string | null)[]>();

    const page = async (
        { client, signal }: HandlerContext,
        params: RequestInit['query'],
        limit: number,
        cursor: string | undefined,
    ) =>
        client.request<AdminJobList>('/jobs', {
            query: { ...params, limit, cursor },
            signal,
        });

    return {
        async list(query, context) {
            const perPage = Math.min(query.perPage ?? 50, 100);
            const number = Math.max(1, query.page ?? 1);
            const q = query.q?.trim() ?? '';
            if (/^job_/.test(q)) {
                const job = await context.client
                    .request<AdminJob>(`/jobs/${encodeURIComponent(q)}`, { signal: context.signal })
                    .then((found) => [found])
                    .catch(() => []);
                return {
                    data: job.map(jobItem),
                    meta: { page: 1, perPage, total: job.length, lastPage: 1 },
                };
            }
            const params = jobsQuery(query);
            const key = JSON.stringify([params, perPage]);
            // known[i]: the cursor of page i + 1; null after the last page
            const known = cursors.get(key) ?? [null];
            cursors.set(key, known);
            known[0] = null;
            let result: AdminJobList | null = null;
            for (let index = Math.min(known.length, number) - 1; index < number; index += 1) {
                const cursor = known[index];
                if (index > 0 && (cursor === null || cursor === undefined)) {
                    result = { data: [], nextCursor: null };
                    break;
                }
                result = await page(context, params, perPage, cursor ?? undefined);
                known[index + 1] = result.nextCursor;
            }
            const data = result?.data ?? [];
            const more = result?.nextCursor !== null && result?.nextCursor !== undefined;
            const seen = (number - 1) * perPage + data.length;
            return {
                data: data.map(jobItem),
                meta: {
                    page: number,
                    perPage,
                    total: seen + (more ? 1 : 0),
                    lastPage: more ? number + 1 : number,
                },
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
            cursors.clear();
            return { result: { ...result, refresh: 'list' as const } };
        },
    };
}
