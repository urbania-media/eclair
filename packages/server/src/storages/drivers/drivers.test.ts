import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from '../../crypto.ts';
import { EMPTY_SHA256, verifySignature } from '../signing.ts';
import { HttpDriver } from './http.ts';
import { LocalDriver } from './local.ts';
import { S3Driver } from './s3.ts';
import { StorageError, checkStoragePath } from './types.ts';
import type { StorageDriver } from './types.ts';

const directory = mkdtempSync(join(tmpdir(), 'eclair-drivers-'));
const content = randomBytes(64 * 1024);
const source = join(directory, 'source.bin');
writeFileSync(source, content);
const options = { mime: 'application/octet-stream', size: content.length, sha256: sha256(content) };

afterAll(() => rmSync(directory, { recursive: true, force: true }));

/** The behavior every driver shares. */
function behaves(
    name: string,
    create: () => StorageDriver | Promise<StorageDriver>,
    canDelete = true,
) {
    describe(`${name} driver`, () => {
        let driver: StorageDriver;
        beforeAll(async () => {
            driver = await create();
        });

        it('writes and reads back a file', async () => {
            await driver.write('jobs/1/out file.bin', source, options);
            const destination = join(directory, `${name}-read`);
            expect(
                await driver.read('jobs/1/out file.bin', destination, { maxSize: 1024 ** 2 }),
            ).toBe(content.length);
            expect(readFileSync(destination).equals(content)).toBe(true);
        });

        it('refuses a file larger than the limit', async () => {
            await expect(
                driver.read('jobs/1/out file.bin', join(directory, `${name}-big`), {
                    maxSize: 1000,
                }),
            ).rejects.toMatchObject({ code: 'limit_exceeded' });
        });

        it('reports a missing file', async () => {
            await expect(
                driver.read('jobs/1/missing.bin', join(directory, `${name}-missing`), {
                    maxSize: 1000,
                }),
            ).rejects.toMatchObject({ code: 'not_found' });
        });

        it.runIf(canDelete)('deletes a file, and a missing one quietly', async () => {
            await driver.delete('jobs/1/out file.bin');
            await driver.delete('jobs/1/out file.bin');
            await expect(
                driver.read('jobs/1/out file.bin', join(directory, `${name}-deleted`), {
                    maxSize: 1024 ** 2,
                }),
            ).rejects.toMatchObject({ code: 'not_found' });
        });
    });
}

describe('checkStoragePath', () => {
    it('refuses paths that could escape or confuse a storage', () => {
        expect(checkStoragePath('videos/42/a.mp4')).toBe('videos/42/a.mp4');
        for (const path of ['', '/abs', 'a/../b', 'a//b', './a', 'a\\b', 'a\nb']) {
            expect(() => checkStoragePath(path), path).toThrow(StorageError);
        }
    });
});

behaves('local', () => new LocalDriver(join(directory, 'local')));

describe('local driver paths', () => {
    it("can't leave its root", async () => {
        const driver = new LocalDriver(join(directory, 'jail'));
        await expect(driver.write('../escape.bin', source, options)).rejects.toThrow(StorageError);
    });
});

// An application endpoint for the http storage, which checks Eclair's signatures.
const files = new Map<string, Buffer>();
let server: Server;
const secret = 'whsec_storage';
const requests: { method: string; path: string; job: string | undefined }[] = [];

beforeAll(async () => {
    server = createServer((request, response) => {
        const path = decodeURIComponent((request.url ?? '/').slice('/storage/'.length));
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            const body = Buffer.concat(chunks);
            const digest = request.method === 'PUT' ? sha256(body) : EMPTY_SHA256;
            const signature = String(request.headers['eclair-signature']);
            requests.push({
                method: request.method ?? '',
                path,
                job: request.headers['eclair-job'] as string | undefined,
            });
            if (!verifySignature(signature, secret, `${path}.${digest}`)) {
                response.writeHead(401).end();
            } else if (request.method === 'PUT') {
                expect(request.headers['eclair-content-sha256']).toBe(digest);
                files.set(path, body);
                response.writeHead(204).end();
            } else if (files.has(path)) {
                response
                    .writeHead(200, { 'content-length': files.get(path)?.length })
                    .end(files.get(path));
            } else {
                response.writeHead(404).end();
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

behaves(
    'http',
    () =>
        new HttpDriver(
            { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage` },
            secret,
        ),
    false,
);

describe('http driver', () => {
    it('signs every request and sends the job', async () => {
        const driver = new HttpDriver(
            { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage/` },
            secret,
        );
        await driver.write('a/b.bin', source, { ...options, jobId: 'job_1' });
        expect(requests.at(-1)).toEqual({ method: 'PUT', path: 'a/b.bin', job: 'job_1' });

        const wrong = new HttpDriver(
            { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage` },
            'whsec_wrong',
        );
        await expect(wrong.write('a/b.bin', source, options)).rejects.toThrow(
            'The storage answered 401 to write a/b.bin.',
        );
    });
});

// S3 runs against an S3-compatible service: S3Mock in CI, or any one set in ECLAIR_TEST_S3_ENDPOINT.
const s3Endpoint = process.env['ECLAIR_TEST_S3_ENDPOINT'];
const inCi = process.env['ECLAIR_TEST_DIALECT'] !== undefined;

describe.skipIf(s3Endpoint === undefined && !inCi)('s3', () => {
    it('has a service to run against', () => {
        expect(s3Endpoint, 'ECLAIR_TEST_S3_ENDPOINT').toBeDefined();
    });
});

if (s3Endpoint !== undefined) {
    const config = {
        bucket: process.env['ECLAIR_TEST_S3_BUCKET'] ?? 'eclair-test',
        region: 'us-east-1',
        endpoint: s3Endpoint,
        prefix: `drivers-${randomBytes(4).toString('hex')}/`,
        accessKeyId: 'test',
        secretAccessKey: 'test',
        forcePathStyle: true,
    };
    behaves('s3', () => new S3Driver(config));

    describe('s3 driver', () => {
        it('deletes a prefix and presigns downloads', async () => {
            const driver = new S3Driver(config);
            await driver.write('p/1.bin', source, options);
            await driver.write('p/2.bin', source, options);
            const url = await driver.presign('p/1.bin', 60);
            const response = await fetch(url);
            expect(Buffer.from(await response.arrayBuffer()).equals(content)).toBe(true);

            await driver.deletePrefix('p/');
            await expect(
                driver.read('p/2.bin', join(directory, 's3-gone'), { maxSize: 1024 ** 2 }),
            ).rejects.toMatchObject({
                code: 'not_found',
            });
            driver.close();
        });
    });
}
