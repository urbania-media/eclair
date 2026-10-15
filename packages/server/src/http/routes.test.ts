import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openapi } from '@eclair-js/protocol';

import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { buildApp } from './app.ts';
import type { RouteSummary } from './app.ts';

let services: Services;
let routes: RouteSummary[];

beforeAll(async () => {
    services = await createTestServices();
    const app = buildApp({ version: 'test', services });
    await app.ready();
    routes = app.eclairRoutes;
    await app.close();
});

afterAll(async () => {
    await services.database.close();
});

/** `/v1/jobs/:id` and `/v1/presets/*` as OpenAPI paths: `/v1/jobs/{}` and `/v1/presets/{}`. */
function normalize(path: string): string {
    return path
        .replace(/:[A-Za-z]+/g, '{}')
        .replace(/\*$/, '{}')
        .replace(/\{[^}]+\}/g, '{}');
}

describe('routes', () => {
    it('are all in the OpenAPI document', () => {
        const documented = new Set(
            Object.entries(openapi.paths ?? {}).flatMap(([path, item]) =>
                Object.keys(item ?? {})
                    .filter((key) =>
                        ['get', 'put', 'post', 'delete', 'patch', 'head'].includes(key),
                    )
                    .map((method) => `${method.toUpperCase()} ${normalize(path)}`),
            ),
        );
        const served = routes
            .filter(({ url }) => url.startsWith('/v1/'))
            // Fastify adds a HEAD route to each GET route.
            .filter(
                ({ method, url }) =>
                    method !== 'HEAD' ||
                    !routes.some((route) => route.method === 'GET' && route.url === url),
            )
            .map(({ method, url }) => `${method} ${normalize(url)}`);

        expect(served.length).toBeGreaterThan(0);
        expect(served.filter((route) => !documented.has(route))).toEqual([]);
    });
});
