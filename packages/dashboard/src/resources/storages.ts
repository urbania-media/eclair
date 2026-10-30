import type { Item } from '@panneau/protocol';

import type { Storage, StorageCheck, StorageList, StorageRequest } from '@eclair-js/protocol';

import type { ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { filterValue, forEachItem, pageOf, selectedIds } from './paging.ts';

/** The configuration fields of each kind of storage. */
export const STORAGE_CONFIG = {
    s3: [
        'bucket',
        'region',
        'endpoint',
        'prefix',
        'accessKeyId',
        'secretAccessKey',
        'forcePathStyle',
    ],
    http: ['url'],
} as const;

/** A storage's id: its project and its name, which only identify it together. */
export function storageId(project: string, name: string): string {
    return `${project}/${name}`;
}

function parseId(id: string): { project: string; name: string } {
    const index = id.indexOf('/');
    if (index < 1) {
        throw notFound(`No storage ${id}.`);
    }
    return { project: id.slice(0, index), name: id.slice(index + 1) };
}

export function storageItem(storage: Storage, project: string): Item {
    return {
        id: storageId(project, storage.name),
        version: null,
        abilities: { update: false, remove: true, check: true },
        project,
        name: storage.name,
        kind: storage.kind,
        location: storage.location,
        createdAt: storage.createdAt,
        updatedAt: storage.updatedAt,
    };
}

const storagePath = (project: string, name?: string) =>
    `/projects/${encodeURIComponent(project)}/storages${name !== undefined ? `/${encodeURIComponent(name)}` : ''}`;

/**
 * Storages, by project (`filter[project]`), without their credentials. Creating one with the
 * name of another replaces it: the configuration is encrypted and never shown again.
 */
export const storages: ResourceHandler = {
    async list(query, { client, signal }) {
        const project = filterValue(query, 'project');
        if (project === undefined) {
            return pageOf([], query);
        }
        const { data } = await client.request<StorageList>(storagePath(project), { signal });
        const { project: _, ...filter } = query.filter ?? {};
        return pageOf(
            data.map((storage) => storageItem(storage, project)),
            { ...query, filter },
        );
    },

    async get(id, { client, signal }) {
        const { project, name } = parseId(id);
        const { data } = await client.request<StorageList>(storagePath(project), { signal });
        const storage = data.find((candidate) => candidate.name === name);
        if (storage === undefined) {
            throw notFound(`No storage ${name} in ${project}.`);
        }
        return storageItem(storage, project);
    },

    async create(values, { client, signal }) {
        const project = String(values.project ?? '');
        const name = String(values.name ?? '');
        const kind = values.kind === 'http' ? 'http' : 's3';
        const config: Record<string, unknown> = {};
        STORAGE_CONFIG[kind].forEach((key) => {
            const value = values[key];
            if (value !== undefined && value !== null && value !== '') {
                config[key] = value;
            }
        });
        const body: StorageRequest = { kind, config };
        const storage = await client.request<Storage>(storagePath(project, name), {
            method: 'PUT',
            body,
            signal,
        });
        return storageItem(storage, project);
    },

    async runAction(action, request, { client, signal, intl }) {
        if (action === 'check') {
            // Writes, reads back and deletes a file under `.eclair/`: its outcome is the result.
            const outcomes = await Promise.all(
                selectedIds(request).map(async (id) => {
                    const { project, name } = parseId(id);
                    const check = await client.request<StorageCheck>(
                        `${storagePath(project, name)}/check`,
                        { method: 'POST', signal },
                    );
                    return { id, name, check };
                }),
            );
            const failed = outcomes.filter(({ check }) => !check.ok);
            return {
                result: {
                    message: outcomes
                        .map(({ name, check }) =>
                            intl.formatMessage(
                                { id: check.ok ? 'storages.check.ok' : 'storages.check.failed' },
                                {
                                    name,
                                    read: intl.formatMessage({ id: `storages.step.${check.read}` }),
                                    write: intl.formatMessage({
                                        id: `storages.step.${check.write}`,
                                    }),
                                    duration: check.durationMs,
                                },
                            ),
                        )
                        .join(' '),
                    summary: {
                        succeeded: outcomes.length - failed.length,
                        failed: failed.length,
                        skipped: 0,
                    },
                    results: failed.map(({ id, check }) => ({
                        id,
                        status: 'failed' as const,
                        message: check.message ?? '',
                    })),
                    refresh: 'none' as const,
                },
            };
        }
        if (action !== 'remove') {
            throw notFound(`Storages have no action "${action}".`);
        }
        return {
            result: await forEachItem(selectedIds(request), (id) => {
                const { project, name } = parseId(id);
                return client.request(storagePath(project, name), { method: 'DELETE', signal });
            }),
        };
    },
};
