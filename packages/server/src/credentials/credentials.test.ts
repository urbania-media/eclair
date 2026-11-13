import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors.ts';
import { testRegistry } from '../jobs/testing.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
    services = await createTestServices({ operations: testRegistry() });
    await services.projects.create({ slug: 'niche' });
    await services.projects.create({ slug: 'other' });
});

afterAll(async () => {
    await services.close();
});

describe('Credentials', () => {
    it('keeps a provider credentials encrypted, and never lists their values', async () => {
        const summary = await services.credentials.set('niche', 'example', { token: 'secret-1' });
        expect(summary).toEqual({
            provider: 'example',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
        });
        const row = await services.database.kysely
            .selectFrom('credentials')
            .select('config')
            .executeTakeFirstOrThrow();
        expect(row.config).not.toContain('secret-1');

        const niche = await services.projects.get('niche');
        const other = await services.projects.get('other');
        expect(await services.credentials.get(niche.id, 'example')).toEqual({ token: 'secret-1' });
        expect(await services.credentials.get(other.id, 'example')).toBeUndefined();

        await services.credentials.set('niche', 'example', { token: 'secret-2' });
        expect(await services.credentials.get(niche.id, 'example')).toEqual({ token: 'secret-2' });
        expect((await services.credentials.list('niche')).map(({ provider }) => provider)).toEqual([
            'example',
        ]);
        expect(JSON.stringify(await services.credentials.list('niche'))).not.toContain('secret');
    });

    it('checks the provider and its credentials against the server', async () => {
        await expect(
            services.credentials.set('niche', 'youtube', { apiKey: 'a' }),
        ).rejects.toMatchObject({
            errors: { '/provider': ['is not an embed provider of this server'] },
        });
        await expect(
            services.credentials.set('niche', 'Not A Name', { token: 'a' }),
        ).rejects.toThrow(InvalidValueError);
        await expect(services.credentials.set('niche', 'example', { apiKey: 'a' })).rejects.toThrow(
            InvalidValueError,
        );
        await expect(services.credentials.set('niche', 'example', { token: 42 })).rejects.toThrow(
            InvalidValueError,
        );
        await expect(services.credentials.set('niche', 'example', {})).rejects.toThrow(
            InvalidValueError,
        );
    });

    it('removes them, and goes with their project', async () => {
        await services.credentials.set('other', 'example', { token: 'secret' });
        await services.credentials.remove('other', 'example');
        await expect(services.credentials.remove('other', 'example')).rejects.toThrow(
            NotFoundError,
        );
        expect(await services.credentials.list('other')).toEqual([]);

        await services.projects.delete('niche');
        const rows = await services.database.kysely.selectFrom('credentials').selectAll().execute();
        expect(rows).toEqual([]);
    });
});
