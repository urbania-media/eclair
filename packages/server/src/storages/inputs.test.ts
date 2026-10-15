import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Project } from '../projects/projects.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { fetchInput } from './inputs.ts';

const directory = mkdtempSync(join(tmpdir(), 'eclair-inputs-'));
let services: Services;
let project: Project;
let server: Server;
let base: string;

beforeAll(async () => {
    services = await createTestServices();
    project = (await services.projects.create({ slug: 'niche' })).project;
    server = createServer((request, response) => {
        if (request.url === '/big') {
            response.writeHead(200, { 'content-length': '5000' }).end(Buffer.alloc(5000));
        } else if (request.url === '/missing') {
            response.writeHead(404).end();
        } else {
            response.end('from a url');
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await services.database.close();
    rmSync(directory, { recursive: true, force: true });
});

function options(maxSize = 1024) {
    return {
        project,
        resolver: services.resolver,
        uploads: services.uploads,
        maxSize,
        guard: { allowHttp: true, allowPrivateAddresses: true },
    };
}

describe('fetchInput', () => {
    it('downloads a URL', async () => {
        const destination = join(directory, 'url');
        expect(await fetchInput({ url: `${base}/file` }, destination, options())).toBe(10);
        expect(readFileSync(destination, 'utf8')).toBe('from a url');
    });

    it('stops at the size limit and reports missing files', async () => {
        await expect(
            fetchInput({ url: `${base}/big` }, join(directory, 'big'), options(1000)),
        ).rejects.toMatchObject({
            code: 'limit_exceeded',
        });
        await expect(
            fetchInput({ url: `${base}/missing` }, join(directory, 'missing'), options()),
        ).rejects.toMatchObject({
            code: 'not_found',
        });
    });

    it('goes through the SSRF guard', async () => {
        const { guard: _guard, ...unguarded } = options();
        await expect(
            fetchInput({ url: `${base}/file` }, join(directory, 'blocked'), unguarded),
        ).rejects.toThrow('Only https URLs are allowed.');
        await services.projects.update('niche', { settings: { inputHosts: ['cdn.example.com'] } });
        project = await services.projects.get('niche');
        await expect(
            fetchInput(
                { url: 'https://other.example.com/a.mp4' },
                join(directory, 'host'),
                options(),
            ),
        ).rejects.toThrow("The project doesn't allow inputs from other.example.com.");
        await services.projects.update('niche', { settings: { inputHosts: null } });
        project = await services.projects.get('niche');
    });

    it('reads a path of the temporary storage and an upload', async () => {
        const local = join(directory, 'local');
        writeFileSync(local, 'stored');
        await services.resolver.temporary.forProject(project.id).write('in/a.txt', local, {
            mime: 'text/plain',
            size: 6,
            sha256: '',
        });
        const destination = join(directory, 'stored');
        expect(
            await fetchInput({ storage: 'eclair', path: 'in/a.txt' }, destination, options()),
        ).toBe(6);

        const upload = await services.uploads.createFromFile(project, local, 6, 'x'.repeat(64));
        expect(await fetchInput({ upload: upload.id }, join(directory, 'upload'), options())).toBe(
            6,
        );
    });

    it("doesn't read another project's upload", async () => {
        const other = (await services.projects.create({ slug: 'other' })).project;
        const local = join(directory, 'other');
        writeFileSync(local, 'secret');
        const upload = await services.uploads.createFromFile(other, local, 6, 'x'.repeat(64));
        await expect(
            fetchInput({ upload: upload.id }, join(directory, 'leak'), options()),
        ).rejects.toThrow(`There is no upload "${upload.id}".`);
    });
});
