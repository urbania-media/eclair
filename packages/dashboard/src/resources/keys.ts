import type { Item } from '@panneau/protocol';

import type {
    AdminProjectList,
    ApiKey,
    ApiKeyCreated,
    ApiKeyList,
    ApiKeyRequest,
} from '@eclair-js/protocol';

import type { HandlerContext, ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { filterValue, forEachItem, pageOf, selectedIds } from './paging.ts';

export function keyItem(key: ApiKey, project: string, extra: Record<string, unknown> = {}): Item {
    return {
        id: key.id,
        version: null,
        abilities: { update: false, revoke: !key.revoked },
        project,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        status: key.revoked ? 'revoked' : 'active',
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        ...extra,
    };
}

const keysPath = (project: string) => `/projects/${encodeURIComponent(project)}/keys`;

/** The keys of a project, or of every project: the admin API lists them by project. */
async function listKeys({ client, signal }: HandlerContext, project: string | undefined) {
    const projects =
        project !== undefined
            ? [project]
            : (await client.request<AdminProjectList>('/projects', { signal })).data.map(
                  ({ slug }) => slug,
              );
    const lists = await Promise.all(
        projects.map((slug) => client.request<ApiKeyList>(keysPath(slug), { signal })),
    );
    return lists.flatMap(({ data }, index) =>
        data.map((key) => keyItem(key, projects[index] ?? '')),
    );
}

/**
 * API keys, by project (`filter[project]`). A new key comes back with its `token`, the only time
 * it is shown.
 */
export const keys: ResourceHandler = {
    async list(query, context) {
        const project = filterValue(query, 'project');
        const items = await listKeys(context, project);
        const { project: _, ...filter } = query.filter ?? {};
        return pageOf(items, { ...query, filter });
    },

    async get(id, context) {
        const key = (await listKeys(context, undefined)).find((item) => item.id === id);
        if (key === undefined) {
            throw notFound(`No key ${id}.`);
        }
        return key;
    },

    async create(values, { client, signal }) {
        const project = typeof values.project === 'string' ? values.project : '';
        const body: ApiKeyRequest = {};
        if (typeof values.name === 'string' && values.name !== '') {
            body.name = values.name;
        }
        if (Array.isArray(values.scopes) && values.scopes.length > 0) {
            body.scopes = values.scopes as ApiKeyRequest['scopes'];
        }
        const created = await client.request<ApiKeyCreated>(keysPath(project), {
            method: 'POST',
            body,
            signal,
        });
        return keyItem(created.key, project, { token: created.token });
    },

    async runAction(action, request, { client, signal }) {
        if (action !== 'revoke') {
            throw notFound(`Keys have no action "${action}".`);
        }
        return {
            result: await forEachItem(selectedIds(request), (id) =>
                client.request(`/keys/${encodeURIComponent(id)}/revoke`, {
                    method: 'POST',
                    signal,
                }),
            ),
        };
    },
};
