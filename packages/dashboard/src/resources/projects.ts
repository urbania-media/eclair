import { ValidationError } from '@panneau/data';
import type { Item } from '@panneau/protocol';

import type {
    AdminProject,
    AdminProjectList,
    ApiKeyList,
    ProjectCreated,
    ProjectPatch,
    ProjectRequest,
    ProjectSettings,
    StorageList,
    UsageReport,
    WebhookSecret,
} from '@eclair-js/protocol';

import type { HandlerContext, ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { forEachItem, pageOf, selectedIds } from './paging.ts';

const MIB = 1024 ** 2;

/**
 * The settings of a project, as fields of its form: durations in seconds and sizes in megabytes,
 * where the admin API has milliseconds and bytes.
 */
export const SETTINGS = {
    concurrency: { unit: 1 },
    taskTimeout: { unit: 1000 },
    maxInputSize: { unit: MIB },
    maxDirectUpload: { unit: MIB },
    probesPerMinute: { unit: 1 },
    tempRetention: { unit: 1000 },
    operations: { unit: null },
    inputHosts: { unit: null },
    taskWebhooks: { unit: null },
    progressWebhooks: { unit: null },
    progressWebhookInterval: { unit: 1000 },
} as const satisfies Record<keyof ProjectSettings, { unit: number | null }>;

type SettingName = keyof typeof SETTINGS;
const SETTING_NAMES = Object.keys(SETTINGS) as SettingName[];

function toField(name: SettingName, value: unknown): unknown {
    const { unit } = SETTINGS[name];
    if (value === undefined || value === null) {
        return null;
    }
    return unit !== null && typeof value === 'number' ? value / unit : value;
}

/** A setting from its field: empty goes back to the server's default (`null`). */
function toSetting(name: SettingName, value: unknown): unknown {
    const { unit } = SETTINGS[name];
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (Array.isArray(value)) {
        const entries = value.map(String).filter((entry) => entry.trim() !== '');
        return entries.length > 0 ? entries : null;
    }
    return unit !== null && typeof value === 'number' ? Math.round(value * unit) : value;
}

/** A project as an item: its settings are fields of its own. */
export function projectItem(project: AdminProject, extra: Record<string, unknown> = {}): Item {
    const settings = project.settings as Record<string, unknown>;
    return {
        id: project.id,
        // The form starts over from the saved values when the version changes. Eclair has no
        // concurrency check: the adapter sends no `If-Match`.
        version: project.updatedAt,
        abilities: {
            update: true,
            disable: !project.disabled,
            enable: project.disabled,
        },
        name: project.name,
        slug: project.slug,
        status: project.disabled ? 'disabled' : 'active',
        priority: project.priority,
        webhookUrl: project.webhookUrl,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        ...Object.fromEntries(SETTING_NAMES.map((name) => [name, toField(name, settings[name])])),
        ...extra,
    };
}

function settingsOf(values: Record<string, unknown>, { omitEmpty }: { omitEmpty: boolean }) {
    const settings: Record<string, unknown> = {};
    SETTING_NAMES.forEach((name) => {
        if (name in values) {
            const value = toSetting(name, values[name]);
            if (!(omitEmpty && value === null)) {
                settings[name] = value;
            }
        }
    });
    return settings;
}

/** Validation errors of settings are keyed by their field (`concurrency`, not `settings.…`). */
async function mapSettingErrors<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof ValidationError) {
            const errors = Object.fromEntries(
                Object.entries(error.errors).map(([path, messages]) => [
                    path.replace(/^settings\./, ''),
                    messages,
                ]),
            );
            throw new ValidationError({ ...error.problem, errors });
        }
        throw error;
    }
}

const path = (project: string) => `/projects/${encodeURIComponent(project)}`;

/** The keys, storages and task time of each project, for the list. */
async function summaries({ client, signal }: HandlerContext, projects: readonly AdminProject[]) {
    const [usage, ...perProject] = await Promise.all([
        client.request<UsageReport>('/usage', { query: { days: 30 }, signal }),
        ...projects.map((project) =>
            Promise.all([
                client.request<ApiKeyList>(`${path(project.id)}/keys`, { signal }),
                client.request<StorageList>(`${path(project.id)}/storages`, { signal }),
            ]),
        ),
    ]);
    return projects.map((project, index) => {
        const [keys, storages] = perProject[index] ?? [{ data: [] }, { data: [] }];
        return {
            keys: keys.data.filter((key) => !key.revoked).length,
            storages: storages.data
                .map((storage) => `${storage.name} (${storage.kind})`)
                .join(', '),
            taskTime: Math.round(
                usage.data
                    .filter((line) => line.project === project.slug)
                    .reduce((total, line) => total + line.cpuSeconds, 0),
            ),
        };
    });
}

export const projects: ResourceHandler = {
    async list(query, context) {
        const { data } = await context.client.request<AdminProjectList>('/projects', {
            signal: context.signal,
        });
        const extras = await summaries(context, data);
        return pageOf(
            data.map((project, index) => projectItem(project, extras[index])),
            query,
        );
    },

    async get(id, { client, signal }) {
        return projectItem(await client.request<AdminProject>(path(id), { signal }));
    },

    async create(values, { client, signal }) {
        const body: ProjectRequest = {
            slug: String(values.slug ?? ''),
            settings: settingsOf(values, { omitEmpty: true }),
        };
        if (typeof values.name === 'string' && values.name !== '') {
            body.name = values.name;
        }
        if (typeof values.priority === 'string' && values.priority !== '') {
            body.priority = values.priority as ProjectRequest['priority'];
        }
        if (typeof values.webhookUrl === 'string' && values.webhookUrl !== '') {
            body.webhookUrl = values.webhookUrl;
        }
        const created = await mapSettingErrors(
            client.request<ProjectCreated>('/projects', { method: 'POST', body, signal }),
        );
        return projectItem(created.project);
    },

    async update(id, values, { client, signal }) {
        const body: ProjectPatch = {};
        if ('name' in values) {
            body.name = String(values.name ?? '');
        }
        if ('priority' in values && typeof values.priority === 'string') {
            body.priority = values.priority as ProjectPatch['priority'];
        }
        if ('webhookUrl' in values) {
            body.webhookUrl =
                typeof values.webhookUrl === 'string' && values.webhookUrl !== ''
                    ? values.webhookUrl
                    : null;
        }
        const settings = settingsOf(values, { omitEmpty: false });
        if (Object.keys(settings).length > 0) {
            body.settings = settings;
        }
        if (Object.keys(body).length === 0) {
            // Nothing changed: the admin API refuses an empty patch.
            return projectItem(await client.request<AdminProject>(path(id), { signal }));
        }
        const project = await mapSettingErrors(
            client.request<AdminProject>(path(id), { method: 'PATCH', body, signal }),
        );
        return projectItem(project);
    },

    async runAction(action, request, { client, signal }) {
        const ids = selectedIds(request);
        switch (action) {
            case 'disable':
            case 'enable':
                return {
                    result: await forEachItem(ids, (id) =>
                        client.request(path(id), {
                            method: 'PATCH',
                            body: { disabled: action === 'disable' },
                            signal,
                        }),
                    ),
                };
            case 'rotate-webhook-secret': {
                const [id] = ids;
                if (id === undefined) {
                    throw notFound('No project to rotate the webhook secret of.');
                }
                const grace = request.values?.grace;
                const secret = await client.request<WebhookSecret>(`${path(id)}/webhook-secret`, {
                    method: 'POST',
                    body: typeof grace === 'number' ? { grace } : {},
                    signal,
                });
                // The new secret comes back with the result, for the page that asked for it.
                return { result: { refresh: 'none', ...secret } };
            }
            default:
                throw notFound(`Projects have no action "${action}".`);
        }
    },
};
