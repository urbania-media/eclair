import { NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from '@panneau/data';
import { describe, expect, it } from 'vitest';

import { json, mockFetch, problem } from '../testing/fetch.ts';
import { ADMIN_TOKEN, project } from '../testing/fixtures.ts';
import { createAdminClient, pointerToPath } from './client.ts';

function client(routes: Parameters<typeof mockFetch>[0], token: string | null = ADMIN_TOKEN) {
    const mock = mockFetch(routes);
    return {
        ...mock,
        client: createAdminClient({
            baseUrl: '/admin/v1/',
            getToken: () => token,
            fetch: mock.fetch,
        }),
    };
}

describe('pointerToPath', () => {
    it('turns JSON pointers into dot paths', () => {
        expect(pointerToPath('/settings/concurrency')).toBe('settings.concurrency');
        expect(pointerToPath('/tasks/a~1b/options/c~0d')).toBe('tasks.a/b.options.c~d');
        expect(pointerToPath('')).toBe('');
    });
});

describe('createAdminClient', () => {
    it('sends the admin token as a bearer token, never as a cookie', async () => {
        const { client: admin, requests } = client({
            'GET /admin/v1/projects': () =>
                json({ data: [project()] }, { schema: 'AdminProjectList' }),
        });
        await expect(
            admin.request('/projects', { query: { days: 7, project: undefined } }),
        ).resolves.toEqual({
            data: [project()],
        });
        const [request] = requests;
        expect(request?.headers.get('Authorization')).toBe(`Bearer ${ADMIN_TOKEN}`);
        expect(request?.headers.get('Accept')).toBe('application/json');
        expect(request?.credentials).toBe('omit');
        expect(request?.url.search).toBe('?days=7');
    });

    it('sends bodies as JSON, and answers nothing for 204', async () => {
        const { client: admin, requests } = client({
            'PATCH /admin/v1/projects/niche-dev': ({ body }) =>
                json(project(body as object), { schema: 'AdminProject' }),
            'DELETE /admin/v1/projects/niche-dev': () => new Response(null, { status: 204 }),
        });
        await admin.request('/projects/niche-dev', { method: 'PATCH', body: { disabled: true } });
        expect(requests[0]?.headers.get('Content-Type')).toBe('application/json');
        expect(requests[0]?.body).toEqual({ disabled: true });
        await expect(
            admin.request('/projects/niche-dev', { method: 'DELETE' }),
        ).resolves.toBeUndefined();
    });

    it('sends the token it is given instead of the stored one', async () => {
        const { client: admin, requests } = client(
            { 'GET /admin/v1/projects': () => json({ data: [] }) },
            null,
        );
        await admin.request('/projects', { token: 'another' });
        expect(requests[0]?.headers.get('Authorization')).toBe('Bearer another');
    });

    it('rejects without a token, without calling the server', async () => {
        const { client: admin, requests } = client({}, null);
        await expect(admin.request('/projects')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(requests).toHaveLength(0);
    });

    it("maps problem details to Panneau's errors", async () => {
        const { client: admin } = client({
            'GET /admin/v1/projects': () => problem(401, 'Unauthorized'),
            'GET /admin/v1/projects/nope': () =>
                problem(404, 'Not Found', { detail: 'No project nope.' }),
            'GET /admin/v1/usage': () =>
                problem(429, 'Too Many Requests', { headers: { 'Retry-After': '12' } }),
        });
        await expect(admin.request('/projects')).rejects.toBeInstanceOf(UnauthorizedError);
        await expect(admin.request('/projects/nope')).rejects.toMatchObject({
            constructor: NotFoundError,
            message: 'No project nope.',
            status: 404,
        });
        await expect(admin.request('/usage')).rejects.toMatchObject({
            constructor: RateLimitedError,
            retryAfter: 12,
        });
    });

    it('keys validation errors by dot path', async () => {
        const { client: admin } = client({
            'POST /admin/v1/projects': () =>
                problem(422, 'Unprocessable Content', {
                    detail: 'The request is invalid.',
                    errors: {
                        '/slug': ['must match pattern "^[a-z0-9][a-z0-9-]{0,62}$"'],
                        '/settings/concurrency': ['must be <= 1000'],
                    },
                }),
        });
        const error: unknown = await admin
            .request('/projects', { method: 'POST', body: { slug: 'Nope' } })
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).errors).toEqual({
            slug: ['must match pattern "^[a-z0-9][a-z0-9-]{0,62}$"'],
            'settings.concurrency': ['must be <= 1000'],
        });
    });
});
