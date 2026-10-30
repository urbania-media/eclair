import { ValidationError } from '@panneau/data';
import { describe, expect, it } from 'vitest';

import { createAdminClient } from '../adapter/client.ts';
import { createMessages } from '../messages/index.ts';
import { type Route, json, mockFetch, problem } from '../testing/fetch.ts';
import { ADMIN_TOKEN, apiKey, preset, project, storage } from '../testing/fixtures.ts';
import { keys } from './keys.ts';
import { presets } from './presets.ts';
import { projects } from './projects.ts';
import { storages } from './storages.ts';

function context(routes: Record<string, Route>) {
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

const SECOND_KEY = 'key_01M672QS31VYVYR6B3TESBGVTQ';

const urbania = project({
    id: 'prj_01M672W506F4ZAWXZBJZJQE09S',
    slug: 'urbania-ca',
    name: 'urbania.ca',
    disabled: true,
});

describe('projects', () => {
    it('lists projects with their keys, storages and task time over 30 days', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/projects': () =>
                json({ data: [project(), urbania] }, { schema: 'AdminProjectList' }),
            'GET /admin/v1/usage': () =>
                json(
                    {
                        data: [
                            {
                                project: 'niche-dev',
                                day: '2026-10-29',
                                tasks: 3,
                                cpuSeconds: 1800.4,
                                mediaSeconds: 3600,
                                bytesIn: 1,
                                bytesOut: 1,
                                bytesStored: 0,
                            },
                        ],
                    },
                    { schema: 'UsageReport' },
                ),
            [`GET /admin/v1/projects/${project().id}/keys`]: () =>
                json({ data: [apiKey(), apiKey({ id: SECOND_KEY, revoked: true })] }),
            [`GET /admin/v1/projects/${project().id}/storages`]: () =>
                json({ data: [storage(), storage({ name: 'legacy', kind: 'http' })] }),
            [`GET /admin/v1/projects/${urbania.id}/keys`]: () => json({ data: [] }),
            [`GET /admin/v1/projects/${urbania.id}/storages`]: () => json({ data: [] }),
        });
        const page = await projects.list?.({ sort: ['name'], filter: { status: 'active' } }, ctx);
        expect(page?.meta).toEqual({ page: 1, perPage: 20, total: 1, lastPage: 1 });
        expect(page?.data[0]).toMatchObject({
            id: project().id,
            version: project().updatedAt,
            abilities: { update: true, disable: true, enable: false },
            slug: 'niche-dev',
            status: 'active',
            concurrency: 4,
            taskTimeout: null,
            keys: 1,
            storages: 'media (s3), legacy (http)',
            taskTime: 1800,
        });
        expect(requests.find(({ url }) => url.pathname.endsWith('/usage'))?.url.search).toBe(
            '?days=30',
        );
    });

    it('shows settings in seconds and megabytes, and saves them in the API’s units', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/projects/niche-dev': () =>
                json(
                    project({
                        settings: { taskTimeout: 7_200_000, maxDirectUpload: 104_857_600 },
                    }),
                    { schema: 'AdminProject' },
                ),
            'PATCH /admin/v1/projects/niche-dev': () => json(project(), { schema: 'AdminProject' }),
        });
        await expect(projects.get?.('niche-dev', ctx)).resolves.toMatchObject({
            taskTimeout: 7200,
            maxDirectUpload: 100,
        });
        await projects.update?.(
            'niche-dev',
            {
                name: 'Niche',
                webhookUrl: '',
                taskTimeout: 5400,
                maxInputSize: 2048,
                operations: [],
                concurrency: null,
            },
            ctx,
        );
        expect(requests.at(-1)?.body).toEqual({
            name: 'Niche',
            webhookUrl: null,
            settings: {
                taskTimeout: 5_400_000,
                maxInputSize: 2_147_483_648,
                operations: null,
                concurrency: null,
            },
        });
    });

    it('reads the project again instead of sending an empty patch', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/projects/niche-dev': () => json(project(), { schema: 'AdminProject' }),
        });
        await expect(projects.update?.('niche-dev', {}, ctx)).resolves.toMatchObject({
            id: project().id,
        });
        expect(requests.map(({ method }) => method)).toEqual(['GET']);
    });

    it('creates a project with the settings that are set, and keys their errors by field', async () => {
        const { context: ctx, requests } = context({
            'POST /admin/v1/projects': ({ body }) =>
                (body as { settings: { concurrency?: number } }).settings.concurrency === 2000
                    ? problem(422, 'Unprocessable Content', {
                          errors: { '/settings/concurrency': ['must be <= 1000'] },
                      })
                    : json(
                          { project: project(), webhookSecret: 'whsec_x' },
                          { status: 201, schema: 'ProjectCreated' },
                      ),
        });
        await projects.create?.(
            {
                slug: 'niche-dev',
                name: 'Niche dev',
                webhookUrl: '',
                concurrency: 2,
                taskTimeout: null,
            },
            ctx,
        );
        expect(requests[0]?.body).toEqual({
            slug: 'niche-dev',
            name: 'Niche dev',
            settings: { concurrency: 2 },
        });
        const error: unknown = await projects
            .create?.({ slug: 'niche-dev', concurrency: 2000 }, ctx)
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).errors).toEqual({ concurrency: ['must be <= 1000'] });
    });

    it('disables and enables projects, and rotates the webhook secret with a grace period', async () => {
        const { context: ctx, requests } = context({
            'PATCH /admin/v1/projects/prj_1': () => json(project()),
            'PATCH /admin/v1/projects/prj_2': () => problem(404, 'Not Found', { detail: 'Gone.' }),
            'POST /admin/v1/projects/niche-dev/webhook-secret': () =>
                json(
                    {
                        webhookSecret: 'whsec_new',
                        previousSecretExpiresAt: '2026-10-31T12:00:00.000Z',
                    },
                    { schema: 'WebhookSecret' },
                ),
        });
        await expect(
            projects.runAction?.('disable', { selection: { ids: ['prj_1', 'prj_2'] } }, ctx),
        ).resolves.toEqual({
            result: {
                summary: { succeeded: 1, failed: 1, skipped: 0 },
                results: [{ id: 'prj_2', status: 'failed', message: 'Gone.' }],
                refresh: 'items',
            },
        });
        expect(requests[0]?.body).toEqual({ disabled: true });
        await expect(
            projects.runAction?.(
                'rotate-webhook-secret',
                { selection: { ids: ['niche-dev'] }, values: { grace: 3600 } },
                ctx,
            ),
        ).resolves.toEqual({
            result: {
                refresh: 'none',
                webhookSecret: 'whsec_new',
                previousSecretExpiresAt: '2026-10-31T12:00:00.000Z',
            },
        });
        expect(requests.at(-1)?.body).toEqual({ grace: 3600 });
    });
});

describe('keys', () => {
    it('lists the keys of a project, or of every project', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/projects': () => json({ data: [project(), urbania] }),
            'GET /admin/v1/projects/niche-dev/keys': () =>
                json({ data: [apiKey()] }, { schema: 'ApiKeyList' }),
            'GET /admin/v1/projects/urbania-ca/keys': () =>
                json(
                    { data: [apiKey({ id: SECOND_KEY, revoked: true })] },
                    { schema: 'ApiKeyList' },
                ),
        });
        const page = await keys.list?.({ filter: { project: 'niche-dev' } }, ctx);
        expect(page?.data).toEqual([
            expect.objectContaining({
                id: apiKey().id,
                project: 'niche-dev',
                status: 'active',
                abilities: { update: false, revoke: true },
            }),
        ]);
        expect(requests).toHaveLength(1);
        const all = await keys.list?.({}, ctx);
        expect(all?.data.map(({ id, abilities }) => [id, abilities.revoke])).toEqual([
            [apiKey().id, true],
            [SECOND_KEY, false],
        ]);
    });

    it('creates a key, with its token shown once, and revokes keys', async () => {
        const { context: ctx, requests } = context({
            'POST /admin/v1/projects/niche-dev/keys': () =>
                json(
                    { key: apiKey(), token: 'ek_2_secret' },
                    { status: 201, schema: 'ApiKeyCreated' },
                ),
            [`POST /admin/v1/keys/${apiKey().id}/revoke`]: () =>
                json(apiKey({ revoked: true }), { schema: 'ApiKey' }),
        });
        await expect(
            keys.create?.({ project: 'niche-dev', name: 'platform', scopes: [] }, ctx),
        ).resolves.toMatchObject({ id: apiKey().id, token: 'ek_2_secret' });
        expect(requests[0]?.body).toEqual({ name: 'platform' });
        await expect(
            keys.runAction?.('revoke', { selection: { ids: [apiKey().id] } }, ctx),
        ).resolves.toMatchObject({ result: { summary: { succeeded: 1, failed: 0 } } });
    });
});

describe('storages', () => {
    it('lists the storages of a project only', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/projects/niche-dev/storages': () =>
                json({ data: [storage()] }, { schema: 'StorageList' }),
        });
        await expect(storages.list?.({}, ctx)).resolves.toMatchObject({ data: [] });
        expect(requests).toHaveLength(0);
        await expect(
            storages.list?.({ filter: { project: 'niche-dev' } }, ctx),
        ).resolves.toMatchObject({
            data: [{ id: 'niche-dev/media', name: 'media', kind: 's3', project: 'niche-dev' }],
        });
        await expect(storages.get?.('niche-dev/media', ctx)).resolves.toMatchObject({
            name: 'media',
        });
    });

    it('puts a storage with the configuration of its kind, and removes storages', async () => {
        const { context: ctx, requests } = context({
            'PUT /admin/v1/projects/niche-dev/storages/legacy': () =>
                json(storage({ name: 'legacy', kind: 'http' }), { schema: 'Storage' }),
            'DELETE /admin/v1/projects/niche-dev/storages/media': () =>
                new Response(null, { status: 204 }),
        });
        await storages.create?.(
            {
                project: 'niche-dev',
                name: 'legacy',
                kind: 'http',
                url: 'https://files.example.com/',
                bucket: 'left from s3',
                region: '',
            },
            ctx,
        );
        expect(requests[0]?.body).toEqual({
            kind: 'http',
            config: { url: 'https://files.example.com/' },
        });
        await expect(
            storages.runAction?.('remove', { selection: { ids: ['niche-dev/media'] } }, ctx),
        ).resolves.toMatchObject({ result: { summary: { succeeded: 1 } } });
    });
});

describe('presets', () => {
    it('lists the global presets with their operations', async () => {
        const { context: ctx } = context({
            'GET /admin/v1/presets': () => json({ data: [preset()] }, { schema: 'PresetList' }),
        });
        await expect(presets.list?.({}, ctx)).resolves.toMatchObject({
            data: [
                {
                    id: 'mediatheque/video',
                    version: '3',
                    revision: 3,
                    operations: 'probe, video.poster, video.transcode',
                    abilities: { update: true, delete: true },
                },
            ],
        });
    });

    it('replaces a preset with the values that changed over the current ones', async () => {
        const { context: ctx, requests } = context({
            'GET /admin/v1/presets': () => json({ data: [preset()] }),
            'PUT /admin/v1/presets/mediatheque%2Fvideo': ({ body }) =>
                json(preset({ ...(body as object), version: 4 }), { schema: 'Preset' }),
            'DELETE /admin/v1/presets/mediatheque%2Fvideo': () =>
                new Response(null, { status: 204 }),
        });
        await expect(
            presets.update?.('mediatheque/video', { description: 'Videos' }, ctx),
        ).resolves.toMatchObject({ revision: 4, description: 'Videos' });
        expect(requests.at(-1)?.body).toEqual({ description: 'Videos', tasks: preset().tasks });
        await expect(
            presets.runAction?.('delete', { selection: { ids: ['mediatheque/video'] } }, ctx),
        ).resolves.toMatchObject({ result: { summary: { succeeded: 1 } } });
    });
});
