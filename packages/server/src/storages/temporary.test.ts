import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { TemporaryStorage } from './temporary.ts';

const directory = mkdtempSync(join(tmpdir(), 'eclair-temporary-'));
const source = join(directory, 'source.txt');
writeFileSync(source, 'temporary');

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('TemporaryStorage', () => {
    it('keeps each project under its id', async () => {
        const root = join(directory, 'storage');
        const storage = TemporaryStorage.fromConfig({
            tempStorage: pathToFileURL(root).href,
            tempStorageCredentials: undefined,
        });
        await storage
            .forProject('prj_a')
            .write('out/a.txt', source, { mime: 'text/plain', size: 9, sha256: '' });
        expect(readFileSync(join(root, 'prj_a', 'out', 'a.txt'), 'utf8')).toBe('temporary');
        await expect(
            storage.forProject('prj_b').read('out/a.txt', join(directory, 'b'), { maxSize: 100 }),
        ).rejects.toMatchObject({ code: 'not_found' });

        await storage.deletePrefix('prj_a');
        await expect(
            storage.forProject('prj_a').read('out/a.txt', join(directory, 'a'), { maxSize: 100 }),
        ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('needs credentials for a bucket', () => {
        expect(() =>
            TemporaryStorage.fromConfig({
                tempStorage: 's3://bucket/eclair',
                tempStorageCredentials: undefined,
            }),
        ).toThrow(/ECLAIR_TEMP_S3_ACCESS_KEY_ID/);
    });

    const endpoint = process.env['ECLAIR_TEST_S3_ENDPOINT'];
    it.runIf(endpoint !== undefined)(
        'uses a bucket, with its endpoint and path style',
        async () => {
            const bucket = process.env['ECLAIR_TEST_S3_BUCKET'] ?? 'eclair-test';
            const storage = TemporaryStorage.fromConfig({
                tempStorage: `s3://${bucket}/temporary?endpoint=${encodeURIComponent(endpoint ?? '')}&pathStyle=true`,
                tempStorageCredentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            });
            await storage
                .forProject('prj_s3')
                .write('a.txt', source, { mime: 'text/plain', size: 9, sha256: '' });
            const destination = join(directory, 's3');
            expect(
                await storage.forProject('prj_s3').read('a.txt', destination, { maxSize: 100 }),
            ).toBe(9);
            await storage.deletePrefix('prj_s3');
        },
    );
});
