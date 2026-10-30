import type { AdminProjectList, UsageReport, WebhookSecret } from '@eclair-js/protocol';

import type { WidgetHandler } from './adapter/adapter.ts';

/** What the usage page shows: the usage lines, and the names of the projects. */
export interface UsageData extends UsageReport {
    projects: { slug: string; name: string; disabled: boolean }[];
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

/** The data of the plugin pages and components. */
export const widgets: Record<string, WidgetHandler> = {
    usage,
    'webhook-secret': webhookSecret,
};
