import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from '../crypto.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';

let services: Services;

beforeAll(async () => {
    services = await createTestServices();
    await services.projects.create({ slug: 'niche' });
});

afterAll(async () => {
    await services.database.close();
});

describe('ApiKeys', () => {
    it('creates a key and only stores its hash', async () => {
        const { key, token } = await services.apiKeys.create('niche', { name: 'website' });
        expect(token).toMatch(/^ek_[\w-]{43}$/);
        expect(key).toMatchObject({
            name: 'website',
            prefix: token.slice(0, 11),
            scopes: ['jobs:read', 'jobs:write', 'presets:write'],
            lastUsedAt: undefined,
        });
        const row = await services.database.kysely
            .selectFrom('api_keys')
            .selectAll()
            .where('id', '=', key.id)
            .executeTakeFirstOrThrow();
        expect(row.hash).toBe(sha256(token));
        expect(Object.values(row).join()).not.toContain(token);
    });

    it('authenticates a key and records its use', async () => {
        const { token } = await services.apiKeys.create('niche', { scopes: ['jobs:read'] });
        const auth = await services.apiKeys.authenticate(token);
        expect(auth?.project.slug).toBe('niche');
        expect(auth?.key.scopes).toEqual(['jobs:read']);
        expect(auth?.key.lastUsedAt).toBeInstanceOf(Date);
    });

    it('refuses unknown, revoked and disabled keys alike', async () => {
        expect(await services.apiKeys.authenticate('ek_unknown')).toBeUndefined();
        expect(await services.apiKeys.authenticate('not-a-key')).toBeUndefined();

        const revoked = await services.apiKeys.create('niche');
        await services.apiKeys.revoke(revoked.key.id);
        expect(await services.apiKeys.authenticate(revoked.token)).toBeUndefined();

        const { token } = await services.apiKeys.create('niche');
        await services.projects.update('niche', { disabled: true });
        expect(await services.apiKeys.authenticate(token)).toBeUndefined();
        await services.projects.update('niche', { disabled: false });
        expect(await services.apiKeys.authenticate(token)).toBeDefined();
    });

    it('refuses unknown scopes', async () => {
        await expect(services.apiKeys.create('niche', { scopes: ['admin'] })).rejects.toThrow(
            InvalidValueError,
        );
        await expect(services.apiKeys.create('niche', { scopes: [] })).rejects.toThrow(
            InvalidValueError,
        );
    });

    it('lists the keys of a project', async () => {
        const keys = await services.apiKeys.list('niche');
        expect(keys.length).toBeGreaterThanOrEqual(4);
        expect(keys.filter((key) => key.revokedAt !== undefined)).toHaveLength(1);
    });
});
