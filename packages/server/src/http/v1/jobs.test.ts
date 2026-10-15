import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import { testRegistry } from '../../jobs/testing.ts';
import { RUNS_WITH_REDIS, createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';

let services: Awaited<ReturnType<typeof createTestServices>>;
let app: FastifyInstance;
let token: string;
let readOnly: string;
let other: string;

const body = {
    input: { url: 'https://cdn.example.com/a.mp4' },
    output: { storage: 'eclair', prefix: 'videos/42/' },
    tasks: { probe: { op: 'probe' }, h264: { op: 'video.transcode', after: ['probe'] } },
    metadata: { mediaId: 42 },
};

describe.skipIf(!RUNS_WITH_REDIS)('/v1/jobs', () => {
    beforeAll(async () => {
        services = await createTestServices({ operations: testRegistry(), queues: true });
        await services.projects.create({ slug: 'niche' });
        await services.projects.create({ slug: 'other' });
        token = (await services.apiKeys.create('niche')).token;
        readOnly = (await services.apiKeys.create('niche', { scopes: ['jobs:read'] })).token;
        other = (await services.apiKeys.create('other')).token;
        app = buildApp({ version: 'test', services });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await services.close();
    });

    function request(
        method: 'GET' | 'POST',
        url: string,
        key = token,
        payload?: object,
        headers = {},
    ) {
        return app.inject({
            method,
            url,
            headers: { authorization: `Bearer ${key}`, ...headers },
            ...(payload === undefined ? {} : { payload }),
        });
    }

    it('creates a job: 202, its location and the job', async () => {
        const response = await request('POST', '/v1/jobs', token, body);
        expect(response.statusCode).toBe(202);
        const job = response.json<{ id: string }>();
        expect(validate('Job', job).valid).toBe(true);
        expect(response.headers['location']).toBe(`/v1/jobs/${job.id}`);
        expect(job).toMatchObject({ status: 'pending', tasks: { probe: { status: 'queued' } } });

        const read = await request('GET', `/v1/jobs/${job.id}`);
        expect(read.json()).toEqual(job);
        expect((await request('GET', `/v1/jobs/${job.id}`, other)).statusCode).toBe(404);
    });

    it('answers 422 for an invalid body or pipeline', async () => {
        const schema = await request('POST', '/v1/jobs', token, {
            input: { url: 'http://insecure' },
        });
        expect(schema.statusCode).toBe(422);
        expect(Object.keys(schema.json<{ errors: object }>().errors)).toContain('/input');

        const pipeline = await request('POST', '/v1/jobs', token, {
            ...body,
            tasks: { h264: { op: 'video.transcode', after: ['ghost'] } },
        });
        expect(pipeline.statusCode).toBe(422);
        expect(pipeline.json()).toMatchObject({
            detail: 'The job is invalid.',
            errors: { '/tasks/h264/after': ['there is no task "ghost"'] },
        });
    });

    it('needs the jobs:write scope', async () => {
        expect((await request('POST', '/v1/jobs', readOnly, body)).statusCode).toBe(403);
    });

    it('replays a request with the same Idempotency-Key, and refuses another body', async () => {
        const headers = { 'idempotency-key': 'media-42' };
        const first = await request('POST', '/v1/jobs', token, body, headers);
        const replay = await request('POST', '/v1/jobs', token, body, headers);
        expect(replay.statusCode).toBe(202);
        expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
        const conflict = await request(
            'POST',
            '/v1/jobs',
            token,
            { ...body, metadata: { mediaId: 43 } },
            headers,
        );
        expect(conflict.statusCode).toBe(409);
    });

    it('lists jobs with filters, and checks the query', async () => {
        const response = await request(
            'GET',
            '/v1/jobs?status=pending,running&metadata[mediaId]=42&limit=1',
        );
        expect(response.statusCode).toBe(200);
        const list = response.json<{ data: unknown[]; nextCursor: string | null }>();
        expect(validate('JobList', list).valid).toBe(true);
        expect(list.data).toHaveLength(1);
        expect(list.nextCursor).not.toBeNull();

        const invalid = await request(
            'GET',
            '/v1/jobs?status=done&limit=500&cursor=x&metadata[a.b]=1&createdAfter=yesterday',
        );
        expect(invalid.statusCode).toBe(422);
        expect(Object.keys(invalid.json<{ errors: object }>().errors).sort()).toEqual([
            '?createdAfter',
            '?metadata[a.b]',
            '?status',
        ]);
        const page = await request('GET', '/v1/jobs?limit=500&cursor=x');
        expect(Object.keys(page.json<{ errors: object }>().errors).sort()).toEqual([
            '?cursor',
            '?limit',
        ]);
    });

    it('cancels, then retries a job', async () => {
        const created = await request('POST', '/v1/jobs', token, body);
        const id = created.json<{ id: string }>().id;
        const canceled = await request('POST', `/v1/jobs/${id}/cancel`);
        expect(canceled.statusCode).toBe(200);
        expect(canceled.json()).toMatchObject({ status: 'canceled' });

        const retried = await request('POST', `/v1/jobs/${id}/retry`);
        expect(retried.statusCode).toBe(202);
        expect(retried.json()).toMatchObject({ status: 'pending' });
        expect((await request('POST', `/v1/jobs/${id}/retry`)).statusCode).toBe(409);
    });

    it('lists the files of a job', async () => {
        const created = await request('POST', '/v1/jobs', token, body);
        const id = created.json<{ id: string }>().id;
        const response = await request('GET', `/v1/jobs/${id}/files?task=h264`);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ data: [], nextCursor: null });
    });
});
