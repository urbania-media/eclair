import { describe, expect, it } from 'vitest';

import type { AdminJob } from '@eclair-js/protocol';

import { createAdminClient } from '../adapter/client.ts';
import { createMessages } from '../messages/index.ts';
import { type Route, json, mockFetch } from '../testing/fetch.ts';
import { ADMIN_TOKEN } from '../testing/fixtures.ts';
import { createJobs, describeJob, jobDuration } from './jobs.ts';

function job(index: number, overrides: Partial<AdminJob> = {}): AdminJob {
    return {
        id: `job_01M673NGZ98FY3JHAW3S49CA${String(index).padStart(2, '0')}`,
        project: 'niche-dev',
        status: 'failed',
        createdAt: '2026-10-30T19:12:58.000Z',
        startedAt: '2026-10-30T19:12:59.000Z',
        endedAt: '2026-10-30T19:13:49.000Z',
        preset: { name: 'web-image', version: 1 },
        metadata: { mediaId: '42' },
        tasks: {
            probe: { status: 'completed', op: 'probe@1' },
            palette: { status: 'failed', op: 'image.palette@1' },
            webp: { status: 'skipped', op: 'image.convert@1' },
        },
        ...overrides,
    } as AdminJob;
}

function setup(routes: Record<string, Route>) {
    const mock = mockFetch(routes);
    return {
        jobs: createJobs(),
        context: {
            client: createAdminClient({
                baseUrl: '/admin/v1',
                getToken: () => ADMIN_TOKEN,
                fetch: mock.fetch,
            }),
            intl: createMessages('en'),
        },
        requests: mock.requests,
    };
}

describe('jobs', () => {
    it('describes a job by its preset or its operations, and its duration', () => {
        expect(describeJob(job(1))).toBe('web-image v1');
        expect(
            describeJob(
                job(1, {
                    preset: undefined,
                    tasks: {
                        a: { status: 'pending', op: 'video.transcode@1' },
                        b: { status: 'pending', op: 'video.transcode@1' },
                        c: { status: 'pending', op: 'probe@1' },
                    },
                }),
            ),
        ).toBe('video.transcode, probe');
        expect(jobDuration(job(1))).toBe(50);
        expect(jobDuration(job(1, { startedAt: undefined }))).toBeNull();
        expect(
            jobDuration(job(1, { endedAt: undefined }), Date.parse('2026-10-30T19:13:09.000Z')),
        ).toBe(10);
    });

    it('maps the filters and the search onto the admin API, and lists jobs as items', async () => {
        const { jobs, context, requests } = setup({
            'GET /admin/v1/jobs': () =>
                json({ data: [job(1)], nextCursor: null }, { schema: 'AdminJobList' }),
        });
        const page = await jobs.list?.(
            {
                perPage: 50,
                q: 'mediaId=42',
                filter: {
                    status: ['failed', 'canceled'],
                    project: 'niche-dev',
                    operation: 'image.palette',
                    created: { from: '2026-10-01', to: '2026-10-30' },
                },
            },
            context,
        );
        expect(requests[0]?.url.searchParams.getAll('status')).toEqual(['failed', 'canceled']);
        expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toMatchObject({
            project: 'niche-dev',
            operation: 'image.palette',
            createdAfter: '2026-10-01T00:00:00.000Z',
            createdBefore: '2026-10-30T23:59:59.999Z',
            'metadata[mediaId]': '42',
            limit: '50',
        });
        expect(page).toEqual({
            data: [
                expect.objectContaining({
                    id: job(1).id,
                    abilities: { update: false, cancel: false, retry: true },
                    status: 'failed',
                    tasks: { done: 2, total: 3, failed: true },
                    what: 'web-image v1',
                    metadata: 'mediaId=42',
                    duration: 50,
                }),
            ],
            meta: { page: 1, perPage: 50, total: 1, lastPage: 1 },
        });
    });

    it('pages with the cursors of the admin API', async () => {
        const pages: Record<string, { data: AdminJob[]; nextCursor: string | null }> = {
            '': { data: [job(1), job(2)], nextCursor: 'c2' },
            c2: { data: [job(3), job(4)], nextCursor: 'c3' },
            c3: { data: [job(5)], nextCursor: null },
        };
        const { jobs, context, requests } = setup({
            'GET /admin/v1/jobs': ({ url }) =>
                json(pages[url.searchParams.get('cursor') ?? ''], { schema: 'AdminJobList' }),
        });
        // A page further than the known ones reads the pages before it.
        const third = await jobs.list?.({ page: 3, perPage: 2 }, context);
        expect(requests.map(({ url }) => url.searchParams.get('cursor'))).toEqual([
            null,
            'c2',
            'c3',
        ]);
        expect(third?.data.map(({ id }) => id)).toEqual([job(5).id]);
        expect(third?.meta).toEqual({ page: 3, perPage: 2, total: 5, lastPage: 3 });
        // A known page is read with its cursor.
        const second = await jobs.list?.({ page: 2, perPage: 2 }, context);
        expect(requests.at(-1)?.url.searchParams.get('cursor')).toBe('c2');
        expect(second?.meta).toEqual({ page: 2, perPage: 2, total: 5, lastPage: 3 });
        // Beyond the last page, nothing.
        const fifth = await jobs.list?.({ page: 5, perPage: 2 }, context);
        expect(fifth?.data).toEqual([]);
    });

    it('finds a job by its id in the search', async () => {
        const { jobs, context } = setup({
            [`GET /admin/v1/jobs/${job(7).id}`]: () => json(job(7), { schema: 'AdminJob' }),
        });
        await expect(jobs.list?.({ q: job(7).id }, context)).resolves.toMatchObject({
            data: [{ id: job(7).id }],
            meta: { total: 1 },
        });
        await expect(jobs.list?.({ q: 'job_unknown' }, context)).resolves.toMatchObject({
            data: [],
        });
    });

    it('cancels and retries jobs', async () => {
        const { jobs, context, requests } = setup({
            [`POST /admin/v1/jobs/${job(1).id}/retry`]: () =>
                json(job(1, { status: 'running' }), { schema: 'AdminJob' }),
        });
        await expect(
            jobs.runAction?.('retry', { selection: { ids: [job(1).id] } }, context),
        ).resolves.toMatchObject({
            result: { summary: { succeeded: 1, failed: 0 }, refresh: 'list' },
        });
        expect(requests[0]?.method).toBe('POST');
    });
});
