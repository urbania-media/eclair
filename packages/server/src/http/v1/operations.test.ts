import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import { BUILT_IN_PLUGINS, OperationRegistry } from '../../operations/registry.ts';
import type { Services } from '../../services.ts';
import { createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';

let services: Services;
let app: FastifyInstance;
let token: string;
let limitedToken: string;

beforeAll(async () => {
    services = await createTestServices({
        operations: await OperationRegistry.load(BUILT_IN_PLUGINS),
    });
    await services.projects.create({ slug: 'niche' });
    await services.projects.create({
        slug: 'limited',
        settings: { operations: ['image.palette'] },
    });
    token = (await services.apiKeys.create('niche', { scopes: ['jobs:read', 'presets:write'] }))
        .token;
    limitedToken = (await services.apiKeys.create('limited')).token;
    app = buildApp({ version: 'test', services });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await services.database.close();
});

describe('GET /v1/operations', () => {
    it('lists the operations with their options schema', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/v1/operations',
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(200);
        expect(validate('OperationList', response.json()).valid).toBe(true);
        const [probe] = response.json<{ data: { name: string; options: unknown }[] }>().data;
        expect(probe).toMatchObject({
            name: 'probe',
            version: 1,
            capability: 'probe',
            outputs: { files: false, metadata: true },
            options: {
                type: 'object',
                properties: { checksum: { type: 'boolean', default: false } },
            },
        });
    });

    it('only lists what the project may use', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/v1/operations',
            headers: { authorization: `Bearer ${limitedToken}` },
        });
        expect(response.json()).toEqual({ data: [] });
    });
});

describe('presets with operations', () => {
    it('check the operations and their options', async () => {
        const response = await app.inject({
            method: 'PUT',
            url: '/v1/presets/check',
            headers: { authorization: `Bearer ${token}` },
            payload: {
                tasks: {
                    probe: { op: 'probe', options: { checksum: 'yes' } },
                    hls: { op: 'video.hls' },
                },
            },
        });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
            detail: 'Some tasks are invalid.',
            errors: {
                '/tasks/probe/options/checksum': ['must be boolean'],
                '/tasks/hls/op': ['"video.hls" is not an operation of this server'],
            },
        });
    });
});
