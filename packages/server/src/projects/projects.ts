import type { Selectable } from 'kysely';
import { Type } from 'typebox';

import { decryptSecret, encryptSecret, randomToken } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import { isUniqueViolation } from '../database/errors.ts';
import type { ProjectsTable } from '../database/tables.ts';
import { readDate, readJson, readOptionalDate, toJson } from '../database/values.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { createId, isId } from '../ids.ts';
import { createValidator } from '../validation.ts';
import { ProjectSettingsSchema } from './settings.ts';
import type { ProjectSettings } from './settings.ts';

export const PRIORITIES = ['low', 'normal', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

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

    /** The secret that signs the project's webhooks and HTTP storage requests. */
    async webhookSecret(projectId: string): Promise<string> {
        const row = await this.#database.kysely
            .selectFrom('projects')
            .select('webhook_secret')
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (row === undefined) {
            throw new NotFoundError(`There is no project "${projectId}".`);
        }
        return decryptSecret(this.#secretKey, row.webhook_secret);
    }

    /** Replaces the webhook secret and returns the new one. */
    async rotateWebhookSecret(idOrSlug: string): Promise<string> {
        const project = await this.get(idOrSlug);
        const webhookSecret = randomToken('whsec_');
        await this.#database.kysely
            .updateTable('projects')
            .set({
                webhook_secret: encryptSecret(this.#secretKey, webhookSecret),
                updated_at: new Date(),
            })
            .where('id', '=', project.id)
            .execute();
        return webhookSecret;
    }

    /** Deletes a project and everything that belongs to it. */
    async delete(idOrSlug: string): Promise<void> {
        const project = await this.get(idOrSlug);
        await this.#database.kysely.deleteFrom('projects').where('id', '=', project.id).execute();
    }
}
