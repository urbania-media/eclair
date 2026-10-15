import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import type { Services } from '../../services.ts';
import { createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';

let services: Services;
let app: FastifyInstance;
let token: string;
let readOnlyToken: string;
let otherToken: string;

const preset = {
    description: 'Video for the web',
    tasks: { probe: { op: 'probe' }, h264: { op: 'video.transcode', options: { codec: 'h264' } } },
};

beforeAll(async () => {
    services = await createTestServices();
    await services.projects.create({ slug: 'niche' });
    await services.projects.create({ slug: 'other' });
    token = (await services.apiKeys.create('niche')).token;
    readOnlyToken = (await services.apiKeys.create('niche', { scopes: ['jobs:read'] })).token;
    otherToken = (await services.apiKeys.create('other')).token;
    app = buildApp({ version: 'test', services });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await services.database.close();
});

function request(
    method: 'GET' | 'PUT' | 'DELETE',
    url: string,
    key: string | undefined,
    payload?: unknown,
) {
    return app.inject({
        method,
        url,
        headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
        ...(payload === undefined ? {} : { payload: payload as object }),
    });
}

describe('/v1 authentication', () => {
    it('needs an API key', async () => {
        const response = await request('GET', '/v1/presets', undefined);
        expect(response.statusCode).toBe(401);
        expect(response.headers['www-authenticate']).toBe('Bearer realm="eclair"');
        expect(validate('Problem', response.json()).valid).toBe(true);
    });

    it('refuses an unknown key', async () => {
        const response = await request('GET', '/v1/presets', 'ek_unknown');
        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ detail: 'The API key is unknown or revoked.' });
    });

    it('checks the scope of the key', async () => {
        const response = await request('PUT', '/v1/presets/web-video', readOnlyToken, preset);
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
            detail: "The API key doesn't have the presets:write scope.",
        });
    });
});

describe('/v1/presets', () => {
    it('creates, then replaces a preset', async () => {
        const created = await request('PUT', '/v1/presets/web-video', token, preset);
        expect(created.statusCode).toBe(201);
        expect(validate('Preset', created.json()).valid).toBe(true);
        // The protocol's defaults are applied when the request is validated (decision 0015).
        expect(created.json()).toEqual({
            name: 'web-video',
            scope: 'project',
            version: 1,
            description: 'Video for the web',
            tasks: {
                probe: { op: 'probe', keep: true },
                h264: { op: 'video.transcode', options: { codec: 'h264' }, keep: true },
            },
        });

        const replaced = await request('PUT', '/v1/presets/web-video', token, {
            tasks: { probe: { op: 'probe' } },
        });
        expect(replaced.statusCode).toBe(200);
        expect(replaced.json()).toMatchObject({ version: 2 });
    });

    it('takes names with a slash', async () => {
        const response = await request('PUT', '/v1/presets/mediatheque/video', token, preset);
        expect(response.statusCode).toBe(201);
        const read = await request('GET', '/v1/presets/mediatheque/video', token);
        expect(read.json()).toMatchObject({ name: 'mediatheque/video' });
    });

    it('answers 422 with the errors of an invalid preset', async () => {
        const response = await request('PUT', '/v1/presets/bad', token, {
            tasks: { h264: { options: {} } },
            extra: true,
        });
        expect(response.statusCode).toBe(422);
        const body = response.json<{ errors: Record<string, string[]> }>();
        expect(Object.keys(body.errors).sort()).toEqual(['/extra', '/tasks/h264/op']);
        expect(validate('Problem', body).valid).toBe(true);

        const name = await request('PUT', '/v1/presets/Bad%20Name', token, preset);
        expect(name.statusCode).toBe(422);
    });

    it("lists a project's presets and the global ones", async () => {
        await services.presets.put(undefined, 'web-audio', { tasks: { probe: { op: 'probe' } } });
        const response = await request('GET', '/v1/presets', token);
        expect(response.statusCode).toBe(200);
        expect(validate('PresetList', response.json()).valid).toBe(true);
        expect(
            response
                .json<{ data: { name: string; scope: string }[] }>()
                .data.map(({ name, scope }) => [name, scope]),
        ).toEqual([
            ['mediatheque/video', 'project'],
            ['web-audio', 'global'],
            ['web-video', 'project'],
        ]);
    });

    it("never shows another project's presets", async () => {
        const response = await request('GET', '/v1/presets/web-video', otherToken);
        expect(response.statusCode).toBe(404);
        const removed = await request('DELETE', '/v1/presets/web-video', otherToken);
        expect(removed.statusCode).toBe(404);
    });

    it('deletes a preset, but not a global one', async () => {
        const response = await request('DELETE', '/v1/presets/web-video', token);
        expect(response.statusCode).toBe(204);
        expect((await request('GET', '/v1/presets/web-video', token)).statusCode).toBe(404);
        expect((await request('DELETE', '/v1/presets/web-audio', token)).statusCode).toBe(404);
    });
});
