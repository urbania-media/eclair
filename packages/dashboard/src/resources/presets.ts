import type { Item } from '@panneau/protocol';

import type { Preset, PresetList, PresetRequest } from '@eclair-js/protocol';

import type { ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { forEachItem, pageOf, selectedIds } from './paging.ts';

export function presetItem(preset: Preset): Item {
    const global = preset.scope === 'global';
    return {
        id: preset.name,
        version: String(preset.version),
        abilities: { update: global, delete: global },
        name: preset.name,
        scope: preset.scope,
        // `version` is Panneau's, for concurrency: Eclair's version of the preset is its revision.
        revision: preset.version,
        description: preset.description ?? null,
        tasks: preset.tasks,
        operations: [
            ...new Set(
                Object.values(preset.tasks as Record<string, { op?: unknown }>).map((task) =>
                    String(task.op ?? ''),
                ),
            ),
        ].join(', '),
    };
}

const presetPath = (name: string) => `/presets/${encodeURIComponent(name)}`;

function presetRequest(values: Record<string, unknown>): PresetRequest {
    const body: PresetRequest = { tasks: (values.tasks ?? {}) as PresetRequest['tasks'] };
    if (typeof values.description === 'string' && values.description !== '') {
        body.description = values.description;
    }
    return body;
}

/** The global presets, which every project can use. Their versions go up with each change. */
export const presets: ResourceHandler = {
    async list(query, { client, signal }) {
        const { data } = await client.request<PresetList>('/presets', { signal });
        return pageOf(data.map(presetItem), query);
    },

    async get(id, { client, signal }) {
        const { data } = await client.request<PresetList>('/presets', { signal });
        const preset = data.find((candidate) => candidate.name === id);
        if (preset === undefined) {
            throw notFound(`No preset ${id}.`);
        }
        return presetItem(preset);
    },

    async create(values, { client, signal }) {
        return presetItem(
            await client.request<Preset>(presetPath(String(values.name ?? '')), {
                method: 'PUT',
                body: presetRequest(values),
                signal,
            }),
        );
    },

    async update(id, values, context) {
        // A PUT replaces the preset: what the form didn't change comes from the current one.
        const current = await presets.get?.(id, context);
        return presetItem(
            await context.client.request<Preset>(presetPath(id), {
                method: 'PUT',
                body: presetRequest({ ...current, ...values }),
                signal: context.signal,
            }),
        );
    },

    async runAction(action, request, { client, signal }) {
        if (action !== 'delete') {
            throw notFound(`Presets have no action "${action}".`);
        }
        return {
            result: await forEachItem(selectedIds(request), (id) =>
                client.request(presetPath(id), { method: 'DELETE', signal }),
            ),
        };
    },
};
