import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../errors.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';

let services: Services;

beforeAll(async () => {
    services = await createTestServices();
});

afterAll(async () => {
    await services.database.close();
});

describe('Projects', () => {
    it('creates a project with default settings', async () => {
        const { project, webhookSecret } = await services.projects.create({ slug: 'niche' });
        expect(project).toMatchObject({
            slug: 'niche',
            name: 'niche',
            priority: 'normal',
            webhookUrl: undefined,
            disabledAt: undefined,
            settings: { concurrency: 4, maxDirectUpload: 100 * 1024 * 1024, probesPerMinute: 600 },
        });
        expect(webhookSecret).toMatch(/^whsec_/);
        expect(await services.projects.webhookSecret(project.id)).toBe(webhookSecret);
    });

    it('stores the webhook secret encrypted', async () => {
        const { project, webhookSecret } = await services.projects.create({ slug: 'secret' });
        const row = await services.database.kysely
            .selectFrom('projects')
            .select('webhook_secret')
            .where('id', '=', project.id)
            .executeTakeFirstOrThrow();
        expect(row.webhook_secret).not.toContain(webhookSecret);
        expect(row.webhook_secret).toMatch(/^v1\./);
    });

    it('refuses a taken slug and invalid values', async () => {
        await expect(services.projects.create({ slug: 'niche' })).rejects.toThrow(ConflictError);
        await expect(
            services.projects.create({
                slug: 'Not A Slug',
                webhookUrl: 'http://example.com',
            }),
        ).rejects.toMatchObject({
            errors: {
                '/slug': [expect.stringContaining('must match pattern')],
                '/webhookUrl': [expect.stringContaining('must match pattern')],
            },
        });
        await expect(
            services.projects.create({
                slug: 'bad-settings',
                settings: { concurrency: 0, colour: 'blue' } as never,
            }),
        ).rejects.toMatchObject({
            errors: {
                '/settings/concurrency': ['must be >= 1'],
                '/settings/colour': ['must NOT have additional properties'],
            },
        });
    });

    it('finds a project by slug or id', async () => {
        const project = await services.projects.get('niche');
        expect((await services.projects.get(project.id)).slug).toBe('niche');
        await expect(services.projects.get('nope')).rejects.toThrow(NotFoundError);
    });

    it('merges settings and restores defaults', async () => {
        await services.projects.update('niche', {
            settings: { concurrency: 8, operations: ['probe', 'video.transcode'] },
            webhookUrl: 'https://niche.example.com/eclair/webhook',
            priority: 'high',
        });
        const updated = await services.projects.update('niche', {
            settings: { concurrency: null },
        });
        expect(updated.settings.concurrency).toBe(4);
        expect(updated.settings.operations).toEqual(['probe', 'video.transcode']);
        expect(updated.webhookUrl).toBe('https://niche.example.com/eclair/webhook');
        expect(updated.priority).toBe('high');

        await expect(
            services.projects.update('niche', { settings: { probesPerMinute: 'many' } }),
        ).rejects.toThrow(InvalidValueError);
        expect(
            (await services.projects.update('niche', { webhookUrl: null })).webhookUrl,
        ).toBeUndefined();
    });

    it('disables and enables a project', async () => {
        const disabled = await services.projects.update('niche', { disabled: true });
        expect(disabled.disabledAt).toBeInstanceOf(Date);
        expect(
            (await services.projects.update('niche', { disabled: false })).disabledAt,
        ).toBeUndefined();
    });

    it('rotates the webhook secret', async () => {
        const project = await services.projects.get('niche');
        const before = await services.projects.webhookSecret(project.id);
        const after = await services.projects.rotateWebhookSecret('niche');
        expect(after).not.toBe(before);
        expect(await services.projects.webhookSecret(project.id)).toBe(after);
    });

    it('deletes a project with what it owns', async () => {
        const { project } = await services.projects.create({ slug: 'gone' });
        await services.apiKeys.create(project.id);
        await services.projects.delete('gone');
        expect(await services.projects.find('gone')).toBeUndefined();
        const keys = await services.database.kysely
            .selectFrom('api_keys')
            .select('id')
            .where('project_id', '=', project.id)
            .execute();
        expect(keys).toEqual([]);
    });
});
