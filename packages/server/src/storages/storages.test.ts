import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';

let services: Services;
let projectId: string;

const s3 = {
    bucket: 'niche-media',
    endpoint: 'https://tor1.digitaloceanspaces.com',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'super-secret-key',
};

beforeAll(async () => {
    services = await createTestServices();
    projectId = (await services.projects.create({ slug: 'niche' })).project.id;
});

afterAll(async () => {
    await services.database.close();
});

describe('Storages', () => {
    it('saves an s3 storage with its defaults, encrypted', async () => {
        const summary = await services.storages.set('niche', 'media', 's3', s3);
        expect(summary).toMatchObject({
            name: 'media',
            kind: 's3',
            location: 's3://niche-media/ (https://tor1.digitaloceanspaces.com)',
        });
        expect(JSON.stringify(summary)).not.toContain('super-secret-key');

        const storage = await services.storages.get(projectId, 'media');
        expect(storage).toMatchObject({
            kind: 's3',
            config: { ...s3, region: 'us-east-1', prefix: '', forcePathStyle: false },
        });

        const row = await services.database.kysely
            .selectFrom('storages')
            .select('config')
            .executeTakeFirstOrThrow();
        expect(row.config).not.toContain('super-secret-key');
        expect(row.config).not.toContain('niche-media');
    });

    it('replaces a storage with the same name', async () => {
        await services.storages.set('niche', 'media', 'http', {
            url: 'https://niche.example.com/eclair/storage',
        });
        const storages = await services.storages.list('niche');
        expect(storages.map(({ name, kind }) => ({ name, kind }))).toEqual([
            { name: 'media', kind: 'http' },
        ]);
    });

    it('refuses the reserved name, unknown kinds and invalid configurations', async () => {
        await expect(services.storages.set('niche', 'eclair', 's3', s3)).rejects.toThrow(
            /temporary storage/,
        );
        await expect(services.storages.set('niche', 'Media!', 's3', s3)).rejects.toThrow(
            InvalidValueError,
        );
        await expect(services.storages.set('niche', 'ftp', 'ftp', {})).rejects.toThrow(
            /not a storage kind/,
        );
        await expect(
            services.storages.set('niche', 'bad', 's3', { bucket: 'b', secret: 'x' }),
        ).rejects.toMatchObject({
            errors: {
                '/config/bucket': ['must NOT have fewer than 3 characters'],
                '/config/accessKeyId': ["must have required property 'accessKeyId'"],
                '/config/secret': ['must NOT have additional properties'],
            },
        });
    });

    it('removes a storage', async () => {
        await services.storages.remove('niche', 'media');
        expect(await services.storages.has(projectId, 'media')).toBe(false);
        await expect(services.storages.remove('niche', 'media')).rejects.toThrow(NotFoundError);
    });
});
