import { describe, expect, it } from 'vitest';

import { createAdminClient } from './adapter/client.ts';
import { createMessages } from './messages/index.ts';
import { type Route, json, mockFetch } from './testing/fetch.ts';
import { ADMIN_TOKEN } from './testing/fixtures.ts';
import { widgets } from './widgets.ts';

function setup(routes: Record<string, Route>) {
    const mock = mockFetch(routes);
    return {
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

const status = {
    version: '0.4.0',
    ready: true,
    checks: { database: 'ok', redis: 'ok' },
    hosts: [
        {
            name: 'eclair-1',
            queues: [{ name: 'cpu', concurrency: 3 }],
            seenAt: '2026-10-30T19:00:00Z',
        },
    ],
    queues: [{ name: 'cpu', waiting: 0, active: 1, slots: 3, oldestWaitingAt: null }],
};

const stats = {
    since: '2026-10-23T19:00:00.000Z',
    until: '2026-10-30T19:00:00.000Z',
    interval: 'day',
    tasks: [],
    operations: [],
    webhooks: { delivered: 0, pending: 0, failed: 0 },
    jobs: { created: 0 },
};

describe('widgets', () => {
    it('gives the overview: status, stats by day beyond 2 days, and the last failures', async () => {
        const { context, requests } = setup({
            'GET /admin/v1/status': () => json(status, { schema: 'ServerStatus' }),
            'GET /admin/v1/stats': () => json(stats, { schema: 'Stats' }),
            'GET /admin/v1/jobs': () => json({ data: [], nextCursor: null }),
        });
        await expect(
            widgets.overview?.(new URLSearchParams('hours=168'), context),
        ).resolves.toEqual({ status, stats, failures: [] });
        const statsRequest = requests.find(({ url }) => url.pathname.endsWith('/stats'));
        expect(statsRequest?.url.searchParams.get('interval')).toBe('day');
        const since = Date.parse(statsRequest?.url.searchParams.get('since') ?? '');
        const until = Date.parse(statsRequest?.url.searchParams.get('until') ?? '');
        expect(until - since).toBe(168 * 60 * 60 * 1000);
        const jobsRequest = requests.find(({ url }) => url.pathname.endsWith('/jobs'));
        expect(jobsRequest?.url.search).toBe('?status=failed&limit=5');
    });

    it('gives a job with its webhook deliveries', async () => {
        const { context } = setup({
            'GET /admin/v1/jobs/job_1': () => json({ id: 'job_1' }),
            'GET /admin/v1/jobs/job_1/deliveries': () =>
                json(
                    {
                        data: [
                            {
                                id: 'dlv_1',
                                event: 'job.failed',
                                task: null,
                                url: 'https://niche.example.com/eclair',
                                status: 'pending',
                                attempts: 3,
                                responseStatus: 401,
                                nextAttemptAt: '2026-10-30T19:34:00.000Z',
                                deliveredAt: null,
                                createdAt: '2026-10-30T19:02:40.000Z',
                            },
                        ],
                    },
                    { schema: 'WebhookDeliveryList' },
                ),
        });
        await expect(
            widgets.job?.(new URLSearchParams('id=job_1'), context),
        ).resolves.toMatchObject({
            job: { id: 'job_1' },
            deliveries: [{ id: 'dlv_1', responseStatus: 401 }],
        });
    });
});
