import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import type { Services } from '../../services.ts';
import { createTestServices } from '../../testing.ts';
import { buildApp } from '../app.ts';

let services: Services & { temporaryRoot: string };
let app: FastifyInstance;
let token: string;
let otherToken: string;
let projectId: string;

// The smallest valid PNG: a 1×1 transparent pixel.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

beforeAll(async () => {
    services = await createTestServices();
    projectId = (
        await services.projects.create({ slug: 'niche', settings: { maxDirectUpload: 1024 } })
    ).project.id;
    await services.projects.create({ slug: 'other' });
    token = (await services.apiKeys.create('niche')).token;
    otherToken = (await services.apiKeys.create('other')).token;
    app = buildApp({ version: 'test', services });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await services.database.close();
});

function auth(key = token) {
    return { authorization: `Bearer ${key}` };
}

describe('POST /v1/uploads', () => {
    it('stores a raw body and detects its type from the content', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            // The claimed type is ignored.
            headers: { ...auth(), 'content-type': 'application/json' },
            payload: PNG,
        });
        expect(response.statusCode).toBe(201);
        const upload = response.json<{ id: string }>();
        expect(validate('Upload', upload).valid).toBe(true);
        expect(upload).toMatchObject({ size: PNG.length, mime: 'image/png', complete: true });
        expect(response.headers['location']).toBe(`/v1/uploads/${upload.id}`);

        const stored = readFileSync(join(services.temporaryRoot, projectId, 'uploads', upload.id));
        expect(stored.equals(PNG)).toBe(true);
    });

    it('stores the file of a multipart body', async () => {
        const boundary = 'eclair-boundary';
        const payload = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
            ),
            PNG,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const response = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'content-type': `multipart/form-data; boundary=${boundary}` },
            payload,
        });
        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({ size: PNG.length, mime: 'image/png' });
    });

    it("refuses a body over the project's limit with 413", async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'content-type': 'application/octet-stream' },
            payload: Buffer.alloc(2048),
        });
        expect(response.statusCode).toBe(413);
        expect(response.json()).toMatchObject({ status: 413 });
    });

    it('refuses an empty body', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'content-type': 'application/octet-stream' },
            payload: Buffer.alloc(0),
        });
        expect(response.statusCode).toBe(422);
    });
});

describe('resumable uploads (tus)', () => {
    it('take the file in parts, beyond the direct upload limit', async () => {
        const file = Buffer.concat([PNG, Buffer.alloc(3000, 7)]);
        const created = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'tus-resumable': '1.0.0', 'upload-length': String(file.length) },
        });
        expect(created.statusCode).toBe(201);
        expect(created.headers['tus-resumable']).toBe('1.0.0');
        const location = String(created.headers['location']);
        expect(created.json()).toMatchObject({ size: file.length, complete: false });

        const patch = (offset: number, chunk: Buffer) =>
            app.inject({
                method: 'PATCH',
                url: location,
                headers: {
                    ...auth(),
                    'tus-resumable': '1.0.0',
                    'content-type': 'application/offset+octet-stream',
                    'upload-offset': String(offset),
                },
                payload: chunk,
            });

        const first = await patch(0, file.subarray(0, 1000));
        expect(first.statusCode).toBe(204);
        expect(first.headers['upload-offset']).toBe('1000');

        const head = await app.inject({ method: 'HEAD', url: location, headers: auth() });
        expect(head.statusCode).toBe(200);
        expect(head.headers['upload-offset']).toBe('1000');
        expect(head.headers['upload-length']).toBe(String(file.length));

        // A part at the wrong offset conflicts, as tus says.
        expect((await patch(500, file.subarray(500, 1000))).statusCode).toBe(409);
        // A part past the length is too large.
        expect(
            (await patch(1000, Buffer.concat([file.subarray(1000), Buffer.alloc(10)]))).statusCode,
        ).toBe(413);

        expect((await patch(1000, file.subarray(1000))).statusCode).toBe(204);
        const done = await app.inject({ method: 'GET', url: location, headers: auth() });
        expect(done.json()).toMatchObject({ size: file.length, complete: true, mime: 'image/png' });

        // The worker reads the parts back as one file.
        const id = location.split('/').pop() ?? '';
        const destination = join(services.temporaryRoot, 'fetched');
        expect(await services.uploads.fetch(projectId, id, destination, 10_000)).toBe(file.length);
        expect(readFileSync(destination).equals(file)).toBe(true);
        await expect(services.uploads.fetch(projectId, id, destination, 100)).rejects.toMatchObject(
            {
                code: 'limit_exceeded',
            },
        );
    });

    it('need a length and the right content type', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'tus-resumable': '1.0.0' },
        });
        expect(created.statusCode).toBe(422);

        const upload = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'tus-resumable': '1.0.0', 'upload-length': '10' },
        });
        const response = await app.inject({
            method: 'PATCH',
            url: String(upload.headers['location']),
            headers: {
                ...auth(),
                'content-type': 'application/octet-stream',
                'upload-offset': '0',
            },
            payload: Buffer.alloc(10),
        });
        expect(response.statusCode).toBe(415);
    });
});

describe('uploads of another project', () => {
    it('are not found, and deleted uploads neither', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            headers: { ...auth(), 'content-type': 'application/octet-stream' },
            payload: PNG,
        });
        const location = String(created.headers['location']);
        expect(
            (await app.inject({ method: 'GET', url: location, headers: auth(otherToken) }))
                .statusCode,
        ).toBe(404);
        expect(
            (await app.inject({ method: 'DELETE', url: location, headers: auth(otherToken) }))
                .statusCode,
        ).toBe(404);

        expect(
            (await app.inject({ method: 'DELETE', url: location, headers: auth() })).statusCode,
        ).toBe(204);
        expect(
            (await app.inject({ method: 'GET', url: location, headers: auth() })).statusCode,
        ).toBe(404);
    });
});

describe('expired uploads', () => {
    it('are gone, and purged with their files', async () => {
        const project = await services.projects.get('niche');
        const file = join(services.temporaryRoot, 'expiring');
        (await import('node:fs')).writeFileSync(file, PNG);
        const upload = await services.uploads.createFromFile(
            project,
            file,
            PNG.length,
            'x'.repeat(64),
        );
        const later = new Date(Date.now() + 8 * 24 * 3_600_000);
        expect(await services.uploads.purgeExpired(later)).toBeGreaterThanOrEqual(1);
        await expect(services.uploads.get(project.id, upload.id)).rejects.toThrow(
            'There is no upload',
        );
    });
});
