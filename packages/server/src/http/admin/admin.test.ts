import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import { createId } from '../../ids.ts';
import type { Services } from '../../services.ts';
import { createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';

const ADMIN_TOKEN = 'admin-'.repeat(8);
let services: Services;
let app: FastifyInstance;

beforeAll(async () => {
    services = await createTestServices();
    app = buildApp({ version: 'test', services, adminToken: ADMIN_TOKEN });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await services.database.close();
});

function admin(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    token = ADMIN_TOKEN,
) {
    return app.inject({
        method,
        url: `/admin/v1${url}`,
        headers: { authorization: `Bearer ${token}` },
        ...(payload === undefined ? {} : { payload }),
    });
}

describe('/admin/v1', () => {
    it('needs the admin token, never a project key', async () => {
        const none = await app.inject({ method: 'GET', url: '/admin/v1/projects' });
        expect(none.statusCode).toBe(401);
        expect(none.headers['www-authenticate']).toBe('Bearer realm="eclair-admin"');
        expect((await admin('GET', '/projects', undefined, 'wrong')).statusCode).toBe(401);

        await services.projects.create({ slug: 'keyed' });
        const { token } = await services.apiKeys.create('keyed');
        expect((await admin('GET', '/projects', undefined, token)).statusCode).toBe(401);
    });

    it("doesn't exist without an admin token", async () => {
        const closed = buildApp({ version: 'test', services });
        const response = await closed.inject({
            method: 'GET',
            url: '/admin/v1/projects',
            headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        });
        expect(response.statusCode).toBe(404);
        await closed.close();
    });

    it('creates, reads, changes and deletes a project', async () => {
        const created = await admin('POST', '/projects', {
            slug: 'niche',
            name: 'Niche',
            webhookUrl: 'https://niche.example.com/eclair/webhook',
            settings: { concurrency: 8 },
        });
        expect(created.statusCode).toBe(201);
        const body = created.json<{ project: { id: string }; webhookSecret: string }>();
        expect(validate('ProjectCreated', body).valid).toBe(true);
        expect(body).toMatchObject({
            project: { slug: 'niche', settings: { concurrency: 8, taskWebhooks: false } },
        });

        expect((await admin('POST', '/projects', { slug: 'niche' })).statusCode).toBe(409);
        expect((await admin('POST', '/projects', { slug: 'Not A Slug' })).statusCode).toBe(422);

        const read = await admin('GET', `/projects/${body.project.id}`);
        expect(validate('AdminProject', read.json()).valid).toBe(true);

        const patched = await admin('PATCH', '/projects/niche', {
            settings: { concurrency: null },
            disabled: true,
            webhookUrl: null,
        });
        expect(patched.json()).toMatchObject({
            settings: { concurrency: 4 },
            disabled: true,
            webhookUrl: null,
        });

        const secret = await admin('GET', '/projects/niche/webhook-secret');
        expect(secret.json()).toEqual({ webhookSecret: body.webhookSecret });
        const rotated = await admin('POST', '/projects/niche/webhook-secret');
        expect(rotated.json<{ webhookSecret: string }>().webhookSecret).not.toBe(
            body.webhookSecret,
        );

        const list = await admin('GET', '/projects');
        expect(validate('AdminProjectList', list.json()).valid).toBe(true);
        expect(list.json<{ data: { slug: string }[] }>().data.map(({ slug }) => slug)).toContain(
            'niche',
        );

        expect((await admin('DELETE', '/projects/niche')).statusCode).toBe(204);
        expect((await admin('GET', '/projects/niche')).statusCode).toBe(404);
    });

    it('creates, lists and revokes keys', async () => {
        await services.projects.create({ slug: 'keys' });
        const created = await admin('POST', '/projects/keys/keys', {
            name: 'site',
            scopes: ['jobs:read'],
        });
        expect(created.statusCode).toBe(201);
        const { key, token } = created.json<{ key: { id: string }; token: string }>();
        expect(validate('ApiKeyCreated', created.json()).valid).toBe(true);
        expect(token).toMatch(/^ek_/);
        expect(await services.apiKeys.authenticate(token)).toBeDefined();

        const list = await admin('GET', '/projects/keys/keys');
        expect(validate('ApiKeyList', list.json()).valid).toBe(true);
        expect(JSON.stringify(list.json())).not.toContain(token);

        const revoked = await admin('POST', `/keys/${key.id}/revoke`);
        expect(revoked.json()).toMatchObject({ id: key.id, revoked: true });
        expect(await services.apiKeys.authenticate(token)).toBeUndefined();
        expect((await admin('POST', '/projects/keys/keys', { scopes: ['admin'] })).statusCode).toBe(
            422,
        );
    });

    it('sets, lists and removes storages, never showing credentials', async () => {
        await services.projects.create({ slug: 'storages' });
        const saved = await admin('PUT', '/projects/storages/storages/media', {
            kind: 's3',
            config: { bucket: 'media-bucket', accessKeyId: 'id', secretAccessKey: 'very-secret' },
        });
        expect(saved.statusCode).toBe(200);
        expect(validate('Storage', saved.json()).valid).toBe(true);
        const list = await admin('GET', '/projects/storages/storages');
        expect(JSON.stringify(list.json())).not.toContain('very-secret');
        expect(list.json()).toMatchObject({
            data: [{ name: 'media', kind: 's3', location: 's3://media-bucket/ (AWS us-east-1)' }],
        });

        expect(
            (
                await admin('PUT', '/projects/storages/storages/eclair', {
                    kind: 'http',
                    config: { url: 'https://a' },
                })
            ).statusCode,
        ).toBe(422);
        expect((await admin('DELETE', '/projects/storages/storages/media')).statusCode).toBe(204);
        expect((await admin('DELETE', '/projects/storages/storages/media')).statusCode).toBe(404);
    });

    it('manages global presets', async () => {
        const created = await admin('PUT', '/presets/mediatheque%2Fvideo', {
            tasks: { probe: { op: 'probe' } },
        });
        expect(created.statusCode).toBe(201);
        expect(created.json()).toMatchObject({
            name: 'mediatheque/video',
            scope: 'global',
            version: 1,
        });
        expect(
            (
                await admin('PUT', '/presets/mediatheque%2Fvideo', {
                    tasks: { probe: { op: 'probe' } },
                })
            ).statusCode,
        ).toBe(200);
        const list = await admin('GET', '/presets');
        expect(validate('PresetList', list.json()).valid).toBe(true);
        expect((await admin('DELETE', '/presets/mediatheque%2Fvideo')).statusCode).toBe(204);
    });

    it('reports usage per project and day', async () => {
        const project = (await services.projects.create({ slug: 'usage' })).project;
        await services.database.kysely
            .insertInto('usage')
            .values({
                id: createId('usage'),
                project_id: project.id,
                operation: 'probe@1',
                cpu_ms: 1500,
                media_ms: 0,
                bytes_in: 10,
                bytes_out: 0,
                bytes_stored: 0,
                created_at: new Date(),
            })
            .execute();
        const response = await admin('GET', '/usage?project=usage&days=1');
        expect(validate('UsageReport', response.json()).valid).toBe(true);
        expect(response.json()).toMatchObject({
            data: [{ project: 'usage', tasks: 1, cpuSeconds: 1.5, bytesIn: 10 }],
        });
        expect((await admin('GET', '/usage?days=0')).statusCode).toBe(422);
    });
});
