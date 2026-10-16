import { validate as validateOpenApi } from '@readme/openapi-parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { generate } from '../scripts/generate.ts';
import { jsonSchema, openapi } from './index.ts';

function collectRefs(value: unknown, refs = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        value.forEach((item) => collectRefs(item, refs));
    } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (key === '$ref' && typeof child === 'string') {
                refs.add(child);
            } else {
                collectRefs(child, refs);
            }
        }
    }
    return refs;
}

function resolvePointer(document: unknown, ref: string): unknown {
    return ref
        .slice(2)
        .split('/')
        .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce<unknown>(
            (node, token) =>
                node !== null && typeof node === 'object'
                    ? (node as Record<string, unknown>)[token]
                    : undefined,
            document,
        );
}

describe('OpenAPI document', () => {
    it('is a valid OpenAPI 3.1 document', async () => {
        const result = await validateOpenApi(structuredClone(openapi) as never);
        expect(result.valid ? [] : result.errors).toEqual([]);
    });

    it('only references what it defines', () => {
        const missing = [...collectRefs(openapi)].filter(
            (ref) => !ref.startsWith('#/') || resolvePointer(openapi, ref) === undefined,
        );
        expect(missing).toEqual([]);
    });

    it('describes the v1 API', () => {
        expect(Object.keys(openapi.paths).filter((path) => path.startsWith('/v1/'))).toEqual([
            '/v1/jobs',
            '/v1/jobs/{id}',
            '/v1/jobs/{id}/cancel',
            '/v1/jobs/{id}/retry',
            '/v1/jobs/{id}/events',
            '/v1/jobs/{id}/files',
            '/v1/probe',
            '/v1/uploads',
            '/v1/uploads/{id}',
            '/v1/presets',
            '/v1/presets/{name}',
            '/v1/operations',
            '/v1/files/{token}',
        ]);
        expect(Object.keys(openapi.webhooks)).toEqual([
            'job.completed',
            'job.failed',
            'job.canceled',
            'task.completed',
            'storage.write',
            'storage.read',
        ]);
    });

    it('describes the admin API, behind the admin token', () => {
        const admin = Object.entries(openapi.paths).filter(([path]) =>
            path.startsWith('/admin/v1/'),
        );
        expect(admin.map(([path]) => path)).toEqual([
            '/admin/v1/projects',
            '/admin/v1/projects/{project}',
            '/admin/v1/projects/{project}/webhook-secret',
            '/admin/v1/projects/{project}/keys',
            '/admin/v1/keys/{key}/revoke',
            '/admin/v1/projects/{project}/storages',
            '/admin/v1/projects/{project}/storages/{storage}',
            '/admin/v1/presets',
            '/admin/v1/presets/{name}',
            '/admin/v1/usage',
        ]);
        for (const [, item] of admin) {
            for (const [method, operation] of Object.entries(item ?? {})) {
                if (method === 'parameters') {
                    continue;
                }
                expect((operation as { security?: unknown }).security).toEqual([
                    { adminToken: [] },
                ]);
            }
        }
    });

    it('answers errors as problem details', () => {
        const responses = Object.values(openapi.paths)
            .flatMap((item) => Object.values(item))
            .flatMap((operation) =>
                operation !== null && typeof operation === 'object' && 'responses' in operation
                    ? Object.entries(operation.responses as Record<string, { $ref?: string }>)
                    : [],
            )
            .filter(([status]) => Number(status) >= 400);
        for (const [status, response] of responses) {
            const resolved = (
                response.$ref !== undefined ? resolvePointer(openapi, response.$ref) : response
            ) as { content?: Record<string, unknown> };
            expect(Object.keys(resolved.content ?? {}), status).toEqual([
                'application/problem+json',
            ]);
        }
    });
});

describe('generated files', () => {
    it('are up to date (run `npm run generate -w @eclair-js/protocol`)', async () => {
        for (const [path, content] of Object.entries(await generate())) {
            const current = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
            expect(current === content, path).toBe(true);
        }
    });

    it('bundle every schema as a JSON Schema definition', () => {
        expect(Object.keys(jsonSchema['$defs'] as object)).toEqual(
            Object.keys(openapi.components.schemas),
        );
        expect([...collectRefs(jsonSchema)].filter((ref) => !ref.startsWith('#/$defs/'))).toEqual(
            [],
        );
    });
});
