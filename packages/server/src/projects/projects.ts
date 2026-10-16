import type { Selectable } from 'kysely';
import { Type } from 'typebox';

import { decryptSecret, encryptSecret, randomToken } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import { isUniqueViolation } from '../database/errors.ts';
import type { ProjectsTable } from '../database/tables.ts';
import { readDate, readJson, readOptionalDate, toJson } from '../database/values.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { createId, isId } from '../ids.ts';
import { InvalidValueError, createValidator } from '../validation.ts';
import { ProjectSettingsSchema } from './settings.ts';
import type { ProjectSettings } from './settings.ts';

export const PRIORITIES = ['low', 'normal', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

/** How long the previous webhook secret stays valid after a rotation by default, in milliseconds. */
export const DEFAULT_SECRET_GRACE = 24 * 60 * 60 * 1000;

/** The longest grace period of a rotation, in milliseconds (decision 0018). */
export const MAX_SECRET_GRACE = 7 * 24 * 60 * 60 * 1000;

export interface WebhookSecrets {
    webhookSecret: string;
    /** When the previous secret expires, while it's still valid after a rotation. */
    previousSecretExpiresAt: Date | undefined;
}

export interface Project {
    id: string;
    slug: string;
    name: string;
    priority: Priority;
    settings: ProjectSettings;
    webhookUrl: string | undefined;
    createdAt: Date;
    updatedAt: Date;
    disabledAt: Date | undefined;
}

const SLUG_PATTERN = '^[a-z0-9][a-z0-9-]{0,62}$';
const WEBHOOK_URL_PATTERN = '^https://[^\\s]+$';

const ProjectInputSchema = Type.Object(
    {
        slug: Type.String({ pattern: SLUG_PATTERN }),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
        priority: Type.Union(
            PRIORITIES.map((priority) => Type.Literal(priority)),
            { default: 'normal' },
        ),
        webhookUrl: Type.Optional(Type.String({ pattern: WEBHOOK_URL_PATTERN, maxLength: 2048 })),
        settings: Type.Optional(Type.Object({}, { additionalProperties: true })),
    },
    { additionalProperties: false },
);

const ProjectPatchSchema = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
        priority: Type.Optional(Type.Union(PRIORITIES.map((priority) => Type.Literal(priority)))),
        webhookUrl: Type.Optional(
            Type.Union([
                Type.String({ pattern: WEBHOOK_URL_PATTERN, maxLength: 2048 }),
                Type.Null(),
            ]),
        ),
        settings: Type.Optional(Type.Object({}, { additionalProperties: true })),
        disabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

export interface ProjectInput {
    slug: string;
    name?: string;
    priority?: Priority;
    webhookUrl?: string;
    settings?: Partial<ProjectSettings>;
}

export interface ProjectPatch {
    name?: string;
    priority?: Priority;
    /** `null` removes the webhook URL. */
    webhookUrl?: string | null;
    /** Merged into the current settings. A setting set to `null` goes back to its default. */
    settings?: Record<string, unknown>;
    disabled?: boolean;
}

const validateInput = createValidator<ProjectInput & { priority: Priority }>(ProjectInputSchema);
const validatePatch = createValidator<ProjectPatch>(ProjectPatchSchema);
const validateSettings = createValidator<ProjectSettings>(ProjectSettingsSchema);

function toProject(row: Selectable<ProjectsTable>): Project {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        priority: row.priority as Priority,
        // Stored settings are read through the schema, so settings added later get their default.
        settings: validateSettings(readJson(row.settings)),
        webhookUrl: row.webhook_url ?? undefined,
        createdAt: readDate(row.created_at),
        updatedAt: readDate(row.updated_at),
        disabledAt: readOptionalDate(row.disabled_at),
    };
}

/** Projects: the applications that use Eclair (decision 0003). */
export class Projects {
    readonly #database: Database;
    readonly #secretKey: Buffer;

    constructor(database: Database, secretKey: Buffer) {
        this.#database = database;
        this.#secretKey = secretKey;
    }

    /** Creates a project. Returns its webhook secret, which is only readable again with `webhookSecret()`. */
    async create(input: ProjectInput): Promise<{ project: Project; webhookSecret: string }> {
        const { slug, name, priority, webhookUrl, settings } = validateInput(input);
        const validSettings = validateSettings(settings ?? {}, '/settings');
        const webhookSecret = randomToken('whsec_');
        const now = new Date();
        const id = createId('project');
        try {
            await this.#database.kysely
                .insertInto('projects')
                .values({
                    id,
                    slug,
                    name: name ?? slug,
                    priority,
                    settings: toJson(validSettings),
                    webhook_url: webhookUrl ?? null,
                    webhook_secret: encryptSecret(this.#secretKey, webhookSecret),
                    created_at: now,
                    updated_at: now,
                })
                .execute();
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ConflictError(`A project named "${slug}" already exists.`);
            }
            throw error;
        }
        return { project: await this.get(id), webhookSecret };
    }

    async list(): Promise<Project[]> {
        const rows = await this.#database.kysely
            .selectFrom('projects')
            .selectAll()
            .orderBy('slug')
            .execute();
        return rows.map(toProject);
    }

    /** Finds a project by id or slug. */
    async find(idOrSlug: string): Promise<Project | undefined> {
        const row = await this.#database.kysely
            .selectFrom('projects')
            .selectAll()
            .where(isId('project', idOrSlug) ? 'id' : 'slug', '=', idOrSlug)
            .executeTakeFirst();
        return row === undefined ? undefined : toProject(row);
    }

    async get(idOrSlug: string): Promise<Project> {
        const project = await this.find(idOrSlug);
        if (project === undefined) {
            throw new NotFoundError(`There is no project "${idOrSlug}".`);
        }
        return project;
    }

    async update(idOrSlug: string, patch: ProjectPatch): Promise<Project> {
        const project = await this.get(idOrSlug);
        const { name, priority, webhookUrl, settings, disabled } = validatePatch(patch);
        const now = new Date();

        let mergedSettings: ProjectSettings | undefined;
        if (settings !== undefined) {
            // A setting set to null is left out, so it goes back to its default.
            const merged = Object.fromEntries(
                Object.entries({ ...project.settings, ...settings }).filter(
                    ([, value]) => value !== null,
                ),
            );
            mergedSettings = validateSettings(merged, '/settings');
        }

        await this.#database.kysely
            .updateTable('projects')
            .set({
                ...(name === undefined ? {} : { name }),
                ...(priority === undefined ? {} : { priority }),
                ...(webhookUrl === undefined ? {} : { webhook_url: webhookUrl }),
                ...(mergedSettings === undefined ? {} : { settings: toJson(mergedSettings) }),
                ...(disabled === undefined
                    ? {}
                    : { disabled_at: disabled ? (project.disabledAt ?? now) : null }),
                updated_at: now,
            })
            .where('id', '=', project.id)
            .execute();
        return this.get(project.id);
    }

    /** The encrypted secrets of a project; the previous one only while it's valid. */
    async #secrets(projectId: string, now: Date) {
        const row = await this.#database.kysely
            .selectFrom('projects')
            .select([
                'webhook_secret',
                'previous_webhook_secret',
                'previous_webhook_secret_expires_at',
            ])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (row === undefined) {
            throw new NotFoundError(`There is no project "${projectId}".`);
        }
        const expiresAt = readOptionalDate(row.previous_webhook_secret_expires_at);
        const previous =
            row.previous_webhook_secret !== null && expiresAt !== undefined && expiresAt > now
                ? { secret: row.previous_webhook_secret, expiresAt }
                : undefined;
        return { current: row.webhook_secret, previous };
    }

    /** The current webhook secret, and when the previous one expires while it's still valid. */
    async webhookSecrets(projectId: string, now = new Date()): Promise<WebhookSecrets> {
        const { current, previous } = await this.#secrets(projectId, now);
        return {
            webhookSecret: decryptSecret(this.#secretKey, current),
            previousSecretExpiresAt: previous?.expiresAt,
        };
    }

    /** The current webhook secret. */
    async webhookSecret(projectId: string): Promise<string> {
        return (await this.webhookSecrets(projectId)).webhookSecret;
    }

    /**
     * The secrets that sign the project's webhooks and HTTP storage requests: the current one,
     * then the previous one during the grace period of a rotation (decision 0018).
     */
    async signingSecrets(projectId: string, now = new Date()): Promise<string[]> {
        const { current, previous } = await this.#secrets(projectId, now);
        return [current, ...(previous === undefined ? [] : [previous.secret])].map((secret) =>
            decryptSecret(this.#secretKey, secret),
        );
    }

    /**
     * Replaces the webhook secret. The current one stays valid for `grace` milliseconds (24 hours
     * by default, `0` drops it at once), replacing any previous secret still in its grace period.
     */
    async rotateWebhookSecret(
        idOrSlug: string,
        { grace = DEFAULT_SECRET_GRACE }: { grace?: number } = {},
    ): Promise<WebhookSecrets> {
        if (!Number.isInteger(grace) || grace < 0 || grace > MAX_SECRET_GRACE) {
            throw new InvalidValueError({
                '/grace': ['must be a duration between 0 and 7 days'],
            });
        }
        const project = await this.get(idOrSlug);
        const now = new Date();
        const { current } = await this.#secrets(project.id, now);
        const webhookSecret = randomToken('whsec_');
        const previousSecretExpiresAt = grace === 0 ? undefined : new Date(now.getTime() + grace);
        await this.#database.kysely
            .updateTable('projects')
            .set({
                webhook_secret: encryptSecret(this.#secretKey, webhookSecret),
                // Still encrypted with the same key: it moves as is.
                previous_webhook_secret: previousSecretExpiresAt === undefined ? null : current,
                previous_webhook_secret_expires_at: previousSecretExpiresAt ?? null,
                updated_at: now,
            })
            .where('id', '=', project.id)
            .execute();
        return { webhookSecret, previousSecretExpiresAt };
    }

    /** Deletes a project and everything that belongs to it. */
    async delete(idOrSlug: string): Promise<void> {
        const project = await this.get(idOrSlug);
        await this.#database.kysely.deleteFrom('projects').where('id', '=', project.id).execute();
    }
}
