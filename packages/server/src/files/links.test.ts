import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../http/app.ts';
import { LocalDriver } from '../storages/drivers/local.ts';
import { TemporaryStorage } from '../storages/temporary.ts';
import { FileLinks } from './links.ts';

const root = mkdtempSync(join(tmpdir(), 'eclair-links-'));
mkdirSync(join(root, 'prj_a', 'jobs'), { recursive: true });
writeFileSync(join(root, 'prj_a', 'jobs', 'out.txt'), 'downloaded');
const links = new FileLinks(
    new TemporaryStorage(new LocalDriver(root)),
    randomBytes(32),
    'https://eclair.test',
);
const file = {
    projectId: 'prj_a',
    path: 'jobs/out.txt',
    mime: 'text/plain',
    expiresAt: new Date(Date.now() + 60_000),
};

describe('FileLinks', () => {
    it('signs a token that only the server can make', () => {
        const token = links.token(file);
        expect(links.verify(token)).toEqual({
            ...file,
            expiresAt: new Date(Math.floor(file.expiresAt.getTime() / 1000) * 1000),
        });

        const [payload = '', signature = ''] = token.split('.');
        const other = Buffer.from(
            JSON.stringify({ p: 'prj_b', f: 'jobs/out.txt', m: 'text/plain', e: 9_999_999_999 }),
        ).toString('base64url');
        expect(links.verify(`${other}.${signature}`)).toBeUndefined();
        expect(links.verify(`${payload}.x${signature.slice(1)}`)).toBeUndefined();
        expect(links.verify('garbage')).toBeUndefined();
        const otherServer = new FileLinks(
            new TemporaryStorage(new LocalDriver(root)),
            randomBytes(32),
            undefined,
        );
        expect(otherServer.verify(token)).toBeUndefined();
    });

    it('refuses an expired token', () => {
        const token = links.token(file);
        expect(links.verify(token, file.expiresAt.getTime() + 1000)).toBeUndefined();
    });

    it('gives a URL on the public URL, and none without one', async () => {
        expect(await links.url(file)).toMatch(
            /^https:\/\/eclair\.test\/v1\/files\/[\w-]+\.[\w-]+$/,
        );
        const hidden = new FileLinks(
            new TemporaryStorage(new LocalDriver(root)),
            randomBytes(32),
            undefined,
        );
        expect(await hidden.url(file)).toBeUndefined();
        expect(await links.url({ ...file, expiresAt: new Date(Date.now() - 1) })).toBeUndefined();
    });
});

describe('GET /v1/files/{token}', () => {
    it('serves the file as a download, without an API key', async () => {
        const { fileRoutes } = await import('../http/files.ts');
        const files = buildApp({ version: 'test' });
        await files.register(fileRoutes, { prefix: '/v1', links });
        const url = (await links.url(file)) ?? '';
        const response = await files.inject({ method: 'GET', url: new URL(url).pathname });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('downloaded');
        expect(response.headers['content-type']).toBe('text/plain');
        expect(response.headers['content-disposition']).toBe('attachment');

        const missing = await files.inject({ method: 'GET', url: '/v1/files/nope' });
        expect(missing.statusCode).toBe(404);
        const gone = await files.inject({
            method: 'GET',
            url: `/v1/files/${links.token({ ...file, path: 'jobs/gone.txt' })}`,
        });
        expect(gone.statusCode).toBe(404);
        await files.close();
    });
});
