import type {
    AdminJob,
    AdminJobList,
    AdminProjectList,
    ServerStatus,
    Stats,
    UsageReport,
    WebhookDeliveryList,
    WebhookSecret,
} from '@eclair-js/protocol';

import type { WidgetHandler } from './adapter/adapter.ts';

/** What the usage page shows: the usage lines, and the names of the projects. */
export interface UsageData extends UsageReport {
    projects: { slug: string; name: string; disabled: boolean }[];
}

/** What the overview shows: the server's status, its stats over a period and the last failures. */
export interface OverviewData {
    status: ServerStatus;
    stats: Stats;
    failures: AdminJob[];
}

/** A job and its webhooks, for its page. */
export interface JobData {
    job: AdminJob;
    deliveries: WebhookDeliveryList['data'];
}

const usage: WidgetHandler = async (params, { client, signal }): Promise<UsageData> => {
    const days = Number(params.get('days') ?? 30);
    const project = params.get('project') ?? undefined;
    const [report, projects] = await Promise.all([
        client.request<UsageReport>('/usage', { query: { days, project }, signal }),
        client.request<AdminProjectList>('/projects', { signal }),
    ]);
    return {
        ...report,
        projects: projects.data.map(({ slug, name, disabled }) => ({ slug, name, disabled })),
    };
};

const webhookSecret: WidgetHandler = (params, { client, signal }) =>
    client.request<WebhookSecret>(
        `/projects/${encodeURIComponent(params.get('project') ?? '')}/webhook-secret`,
        { signal },
    );

/** `overview?hours=24`: the stats of the last hours, by hour up to 2 days and by day beyond. */
const overview: WidgetHandler = async (params, { client, signal }): Promise<OverviewData> => {
    const hours = Number(params.get('hours') ?? 24);
    const until = new Date();
    const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
    const [status, stats, failures] = await Promise.all([
        client.request<ServerStatus>('/status', { signal }),
        client.request<Stats>('/stats', {
            query: {
                since: since.toISOString(),
                until: until.toISOString(),
                interval: hours > 48 ? 'day' : 'hour',
            },
            signal,
        }),
        client.request<AdminJobList>('/jobs', { query: { status: ['failed'], limit: 5 }, signal }),
    ]);
    return { status, stats, failures: failures.data };
};

const job: WidgetHandler = async (params, { client, signal }): Promise<JobData> => {
    const path = `/jobs/${encodeURIComponent(params.get('id') ?? '')}`;
    const [found, deliveries] = await Promise.all([
        client.request<AdminJob>(path, { signal }),
        client.request<WebhookDeliveryList>(`${path}/deliveries`, { signal }),
    ]);
    return { job: found, deliveries: deliveries.data };
};

/** The data of the plugin pages and components. */
export const widgets: Record<string, WidgetHandler> = {
    usage,
    'webhook-secret': webhookSecret,
    overview,
    job,
};
