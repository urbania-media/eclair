import { NotFoundError, UnauthorizedError } from '@panneau/data';
import { describe, expect, it } from 'vitest';

import { MemoryStorage, json, mockFetch, problem } from '../testing/fetch.ts';
import { ADMIN_TOKEN, project } from '../testing/fixtures.ts';
import { type EclairAdapterOptions, createEclairAdapter } from './adapter.ts';
import { createTokenStore } from './token.ts';

function setup(options: Partial<EclairAdapterOptions> = {}, token: string | null = ADMIN_TOKEN) {
    const tokens = createTokenStore(new MemoryStorage());
    if (token !== null) {
        tokens.set(token);
    }
    const mock = mockFetch({
        'GET /admin/v1/projects': ({ headers }) =>
            headers.get('Authorization') === `Bearer ${ADMIN_TOKEN}`
                ? json({ data: [project()] }, { schema: 'AdminProjectList' })
                : problem(401, 'Unauthorized'),
    });
    const adapter = createEclairAdapter({ tokens, locale: 'en', fetch: mock.fetch, ...options });
    return { adapter, tokens, requests: mock.requests };
}

describe('createEclairAdapter', () => {
    it('signs in with the admin token, and keeps it once the server accepts it', async () => {
        const { adapter, tokens, requests } = setup({}, null);
        await expect(adapter.login({ email: '', password: ` ${ADMIN_TOKEN} ` })).resolves.toEqual({
            user: { id: 'admin', name: 'Admin token' },
        });
        expect(tokens.get()).toBe(ADMIN_TOKEN);
        expect(requests[0]?.headers.get('Authorization')).toBe(`Bearer ${ADMIN_TOKEN}`);
    });

    it('refuses a token the server refuses, and keeps none', async () => {
        const { adapter, tokens } = setup({}, null);
        await expect(adapter.login({ email: '', password: 'wrong' })).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        await expect(adapter.login({ email: '', password: '  ' })).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        expect(tokens.get()).toBeNull();
    });

    it('has no session without a token, or once the server refuses it', async () => {
        await expect(setup({}, null).adapter.getSession()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        await expect(setup({}, 'rotated').adapter.getSession()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        await expect(setup().adapter.getSession()).resolves.toEqual({
            user: { id: 'admin', name: 'Admin token' },
        });
    });

    it('forgets the token on logout', async () => {
        const { adapter, tokens } = setup();
        await adapter.logout();
        expect(tokens.get()).toBeNull();
    });

    it('gives the definition in the locale, after checking the token', async () => {
        const { adapter, requests } = setup({ locale: 'fr' });
        const definition = await adapter.getDefinition();
        expect(requests).toHaveLength(1);
        expect(definition).toMatchObject({
            protocol: 1,
            name: 'Eclair',
            locale: 'fr',
            api: { baseUrl: '/admin/v1' },
            auth: { mode: 'panneau' },
            user: { id: 'admin', name: 'Jeton admin' },
        });
        expect(definition.pages?.['sign-out']).toEqual({
            component: 'eclair-sign-out',
            label: 'Se déconnecter',
        });
        await expect(setup({}, null).adapter.getDefinition()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    it('maps resources onto their handlers', async () => {
        const { adapter } = setup({
            resources: {
                projects: {
                    list: async (query, { client }) => {
                        const { data } = await client.request<{ data: { id: string }[] }>(
                            '/projects',
                        );
                        return {
                            data: data.map((item) => ({
                                id: item.id,
                                version: null,
                                abilities: {},
                            })),
                            meta: {
                                page: query.page ?? 1,
                                perPage: 50,
                                total: data.length,
                                lastPage: 1,
                            },
                        };
                    },
                },
            },
        });
        await expect(adapter.list('projects', { page: 1 })).resolves.toMatchObject({
            data: [{ id: project().id }],
            meta: { total: 1 },
        });
        await expect(adapter.get('projects', 'prj_1')).rejects.toBeInstanceOf(NotFoundError);
        await expect(adapter.list('jobs')).rejects.toBeInstanceOf(NotFoundError);
        await expect(
            adapter.runAction('projects', 'disable', { selection: { ids: ['prj_1'] } }),
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('answers the data of plugin pages from their widgets, with their query', async () => {
        const { adapter } = setup({
            widgets: {
                usage: async (params) => ({ days: params.get('days') }),
            },
        });
        await expect(adapter.getWidgetData('usage?days=7')).resolves.toEqual({ days: '7' });
        await expect(adapter.getWidgetData('usage')).resolves.toEqual({ days: null });
        await expect(adapter.getWidgetData('status')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('has no queued action runs, and no search', async () => {
        const { adapter } = setup();
        await expect(adapter.listActionRuns()).resolves.toEqual([]);
        await expect(adapter.getActionRun('run_1')).rejects.toBeInstanceOf(NotFoundError);
        await expect(adapter.search('niche')).resolves.toEqual({ data: [] });
    });
});
