import type { Item } from '@panneau/protocol';

import type { Credentials, CredentialsList, CredentialsRequest } from '@eclair-js/protocol';

import type { ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { filterValue, forEachItem, pageOf, selectedIds } from './paging.ts';

/**
 * The embed providers of the built-in package, for the suggestions of a project's settings. A
 * server with plugins can have others: the fields take any name.
 */
export const EMBED_PROVIDERS = [
    'youtube',
    'vimeo',
    'dailymotion',
    'soundcloud',
    'spotify',
    'tiktok',
    'instagram',
] as const;

/** The credentials of each built-in provider that takes some (decision 0022). */
export const CREDENTIAL_FIELDS = {
    youtube: ['apiKey'],
    vimeo: ['token'],
    spotify: ['clientId', 'clientSecret'],
    instagram: ['accessToken'],
} as const satisfies Record<string, readonly string[]>;

export type CredentialsProvider = keyof typeof CREDENTIAL_FIELDS;

/** Every credential field, for the form. */
export const CREDENTIAL_KEYS = [...new Set(Object.values(CREDENTIAL_FIELDS).flat())];

/** The credentials' id: their project and their provider, which only identify them together. */
export function credentialsId(project: string, provider: string): string {
    return `${project}/${provider}`;
}

function parseId(id: string): { project: string; provider: string } {
    const index = id.indexOf('/');
    if (index < 1) {
        throw notFound(`No credentials ${id}.`);
    }
    return { project: id.slice(0, index), provider: id.slice(index + 1) };
}

export function credentialsItem(credentials: Credentials, project: string): Item {
    return {
        id: credentialsId(project, credentials.provider),
        version: null,
        abilities: { update: false, remove: true },
        project,
        provider: credentials.provider,
        createdAt: credentials.createdAt,
        updatedAt: credentials.updatedAt,
    };
}

const credentialsPath = (project: string, provider?: string) =>
    `/projects/${encodeURIComponent(project)}/credentials${provider !== undefined ? `/${encodeURIComponent(provider)}` : ''}`;

/**
 * A project's credentials for embed providers, by project (`filter[project]`), without their
 * values. Saving those of a provider that has some replaces them: they are encrypted and never
 * shown again.
 */
export const credentials: ResourceHandler = {
    async list(query, { client, signal }) {
        const project = filterValue(query, 'project');
        if (project === undefined) {
            return pageOf([], query);
        }
        const { data } = await client.request<CredentialsList>(credentialsPath(project), {
            signal,
        });
        const { project: _, ...filter } = query.filter ?? {};
        return pageOf(
            data.map((saved) => credentialsItem(saved, project)),
            { ...query, filter },
        );
    },

    async get(id, { client, signal }) {
        const { project, provider } = parseId(id);
        const { data } = await client.request<CredentialsList>(credentialsPath(project), {
            signal,
        });
        const saved = data.find((candidate) => candidate.provider === provider);
        if (saved === undefined) {
            throw notFound(`No credentials for ${provider} in ${project}.`);
        }
        return credentialsItem(saved, project);
    },

    async create(values, { client, signal }) {
        const project = String(values.project ?? '');
        const provider = String(values.provider ?? '');
        const keys: readonly string[] =
            provider in CREDENTIAL_FIELDS
                ? CREDENTIAL_FIELDS[provider as CredentialsProvider]
                : CREDENTIAL_KEYS;
        const config: Record<string, string> = {};
        keys.forEach((key) => {
            const value = values[key];
            if (typeof value === 'string' && value.trim() !== '') {
                config[key] = value.trim();
            }
        });
        const body: CredentialsRequest = { config };
        const saved = await client.request<Credentials>(credentialsPath(project, provider), {
            method: 'PUT',
            body,
            signal,
        });
        return credentialsItem(saved, project);
    },

    async runAction(action, request, { client, signal }) {
        if (action !== 'remove') {
            throw notFound(`Credentials have no action "${action}".`);
        }
        return {
            result: await forEachItem(selectedIds(request), (id) => {
                const { project, provider } = parseId(id);
                return client.request(credentialsPath(project, provider), {
                    method: 'DELETE',
                    signal,
                });
            }),
        };
    },
};
