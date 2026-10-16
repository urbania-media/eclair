import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../errors.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';
import { DEFAULT_SECRET_GRACE, MAX_SECRET_GRACE } from './projects.ts';

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

    it('rotates the webhook secret, keeping the previous one for 24 hours', async () => {
        const project = await services.projects.get('niche');
        const before = await services.projects.webhookSecret(project.id);
        const start = Date.now();
        const after = await services.projects.rotateWebhookSecret('niche');
        expect(after.webhookSecret).not.toBe(before);
        expect(after.webhookSecret).toMatch(/^whsec_/);
        const expiresAt = after.previousSecretExpiresAt?.getTime() ?? 0;
        expect(expiresAt - start).toBeGreaterThanOrEqual(DEFAULT_SECRET_GRACE);
        expect(expiresAt - Date.now()).toBeLessThanOrEqual(DEFAULT_SECRET_GRACE);

        expect(await services.projects.webhookSecret(project.id)).toBe(after.webhookSecret);
        expect(await services.projects.webhookSecrets(project.id)).toEqual(after);
        expect(await services.projects.signingSecrets(project.id)).toEqual([
            after.webhookSecret,
            before,
        ]);

        // Encrypted, like the current one.
        const row = await services.database.kysely
            .selectFrom('projects')
            .select('previous_webhook_secret')
            .where('id', '=', project.id)
            .executeTakeFirstOrThrow();
        expect(row.previous_webhook_secret).not.toBeNull();
        expect(row.previous_webhook_secret).not.toContain(before);
    });

    it('stops signing with the previous secret when its grace period ends', async () => {
        const project = await services.projects.get('niche');
        const before = await services.projects.webhookSecret(project.id);
        const { webhookSecret, previousSecretExpiresAt } =
            await services.projects.rotateWebhookSecret('niche', { grace: 60_000 });
        const expiresAt = previousSecretExpiresAt ?? new Date(0);

        const justBefore = new Date(expiresAt.getTime() - 1);
        expect(await services.projects.signingSecrets(project.id, justBefore)).toEqual([
            webhookSecret,
            before,
        ]);
        expect(await services.projects.signingSecrets(project.id, expiresAt)).toEqual([
            webhookSecret,
        ]);
        expect(await services.projects.webhookSecrets(project.id, expiresAt)).toEqual({
            webhookSecret,
            previousSecretExpiresAt: undefined,
        });
    });

    it('keeps at most two secrets', async () => {
        const project = await services.projects.get('niche');
        await services.projects.rotateWebhookSecret('niche');
        const second = await services.projects.rotateWebhookSecret('niche');
        const third = await services.projects.rotateWebhookSecret('niche', { grace: 3_600_000 });
        expect(await services.projects.signingSecrets(project.id)).toEqual([
            third.webhookSecret,
            second.webhookSecret,
        ]);
        const expiresAt = third.previousSecretExpiresAt?.getTime() ?? 0;
        expect(expiresAt - Date.now()).toBeLessThanOrEqual(3_600_000);
    });

    it('drops the previous secret at once with a grace period of 0', async () => {
        const project = await services.projects.get('niche');
        await services.projects.rotateWebhookSecret('niche');
        const rotated = await services.projects.rotateWebhookSecret('niche', { grace: 0 });
        expect(rotated.previousSecretExpiresAt).toBeUndefined();
        expect(await services.projects.signingSecrets(project.id)).toEqual([rotated.webhookSecret]);
        const row = await services.database.kysely
            .selectFrom('projects')
            .select(['previous_webhook_secret', 'previous_webhook_secret_expires_at'])
            .where('id', '=', project.id)
            .executeTakeFirstOrThrow();
        expect(row).toEqual({
            previous_webhook_secret: null,
            previous_webhook_secret_expires_at: null,
        });
    });

    it('refuses a grace period longer than 7 days', async () => {
        const before = await services.projects.webhookSecret(
            (await services.projects.get('niche')).id,
        );
        for (const grace of [MAX_SECRET_GRACE + 1, -1, 1.5]) {
            await expect(services.projects.rotateWebhookSecret('niche', { grace })).rejects.toThrow(
                InvalidValueError,
            );
        }
        await services.projects.rotateWebhookSecret('niche', { grace: MAX_SECRET_GRACE });
        expect(
            await services.projects.signingSecrets((await services.projects.get('niche')).id),
        ).toContain(before);
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
