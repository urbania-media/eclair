import { describe, expect, it } from 'vitest';

import { JSON_SCHEMA_ID } from '@eclair-js/protocol';

import { buildApp } from './app.ts';
import { HttpProblem, problems } from './problem.ts';

describe('buildApp', () => {
    it('answers /health', async () => {
        const app = buildApp({ version: '1.2.3' });
        const response = await app.inject({ method: 'GET', url: '/health' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
    });

    it('answers /ready with each check, without the failure reasons', async () => {
        const app = buildApp({
            version: '1.2.3',
            checks: [
                { name: 'database', check: async () => {} },
                {
                    name: 'redis',
                    check: async () => {
                        throw new Error('connect ECONNREFUSED 10.0.0.5:6379');
                    },
                },
            ],
        });
        const response = await app.inject({ method: 'GET', url: '/ready' });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({
            status: 'unready',
            checks: { database: 'ok', redis: 'failed' },
        });
    });

    it('fails a readiness check that takes too long', async () => {
        const app = buildApp({
            version: '1.2.3',
            checkTimeout: 20,
            checks: [{ name: 'slow', check: () => new Promise(() => {}) }],
        });
        const response = await app.inject({ method: 'GET', url: '/ready' });
        expect(response.statusCode).toBe(503);
    });

    it('answers unknown routes with a problem', async () => {
        const app = buildApp({ version: '1.2.3' });
        const response = await app.inject({ method: 'GET', url: '/nope' });
        expect(response.statusCode).toBe(404);
        expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
        expect(response.json()).toEqual({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            detail: 'No route for GET /nope.',
        });
    });

    it('sends the problems thrown by routes, with their headers', async () => {
        const app = buildApp({ version: '1.2.3' });
        app.get('/limited', async () => {
            throw problems.tooManyRequests(30, 'The project has too many running jobs.');
        });
        const response = await app.inject({ method: 'GET', url: '/limited' });
        expect(response.statusCode).toBe(429);
        expect(response.headers['retry-after']).toBe('30');
        expect(response.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });
    });

    it('hides unexpected errors', async () => {
        const app = buildApp({ version: '1.2.3' });
        app.get('/broken', async () => {
            throw new Error('password=hunter2');
        });
        const response = await app.inject({ method: 'GET', url: '/broken' });
        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain('hunter2');
        expect(response.json()).toEqual({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
        });
    });

    it("validates bodies with the protocol's schemas and answers 422", async () => {
        const app = buildApp({ version: '1.2.3' });
        app.post(
            '/jobs',
            { schema: { body: { $ref: `${JSON_SCHEMA_ID}#/$defs/JobRequest` } } },
            async () => ({ ok: true }),
        );
        const response = await app.inject({
            method: 'POST',
            url: '/jobs',
            payload: { input: { url: 'https://example.com/a.mp4' }, tasks: { h264: {} } },
        });
        expect(response.statusCode).toBe(422);
        const body = response.json<{ errors: Record<string, string[]> }>();
        expect(body).toMatchObject({ status: 422, detail: 'The request body is invalid.' });
        expect(Object.keys(body.errors)).toContain('/tasks/h264/op');
    });

    it('answers malformed JSON with a 400 problem', async () => {
        const app = buildApp({ version: '1.2.3' });
        app.post('/echo', async (request) => request.body);
        const response = await app.inject({
            method: 'POST',
            url: '/echo',
            headers: { 'content-type': 'application/json' },
            payload: '{"a":',
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ status: 400, title: 'Bad Request' });
    });

    it('serializes a problem without empty members', () => {
        expect(new HttpProblem(409).toJSON()).toEqual({
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
        });
    });
});
