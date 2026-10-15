import type { Selectable } from 'kysely';

import { randomToken, sha256 } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import type { ApiKeysTable } from '../database/tables.ts';
import { readDate, readJson, readOptionalDate, toJson } from '../database/values.ts';
import { NotFoundError } from '../errors.ts';
import { createId } from '../ids.ts';
import { InvalidValueError } from '../validation.ts';
import type { Project, Projects } from './projects.ts';

/** Scopes of an API key (see the `apiKey` security scheme of the protocol). */
export const SCOPES = ['jobs:read', 'jobs:write', 'presets:write'] as const;

export type Scope = (typeof SCOPES)[number];

const TOKEN_PREFIX = 'ek_';
/** Characters of the token shown to recognize a key: `ek_` and 8 more. */
const DISPLAY_LENGTH = TOKEN_PREFIX.length + 8;
/** `last_used_at` is written at most this often, so that every request doesn't write. */
const LAST_USED_RESOLUTION = 60_000;

export interface ApiKey {
    id: string;
    projectId: string;
    name: string;
    /** The start of the key, to recognize it: `ek_AbCdEfGh`. */
    prefix: string;
    scopes: Scope[];
    createdAt: Date;
    lastUsedAt: Date | undefined;
    revokedAt: Date | undefined;
}

export interface Authentication {
    project: Project;
    key: ApiKey;
}

function toApiKey(row: Selectable<ApiKeysTable>): ApiKey {
    return {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        prefix: row.prefix,
        scopes: readJson<Scope[]>(row.scopes),
        createdAt: readDate(row.created_at),
        lastUsedAt: readOptionalDate(row.last_used_at),
        revokedAt: readOptionalDate(row.revoked_at),
    };
}

/** API keys of the projects. A key is only shown when it's created: the database keeps its hash. */
export class ApiKeys {
    readonly #database: Database;
    readonly #projects: Projects;

    constructor(database: Database, projects: Projects) {
        this.#database = database;
        this.#projects = projects;
    }

    async create(
        projectIdOrSlug: string,
        options: { name?: string; scopes?: readonly string[] } = {},
    ): Promise<{ key: ApiKey; token: string }> {
        const project = await this.#projects.get(projectIdOrSlug);
        const scopes = [...new Set(options.scopes ?? SCOPES)];
        const unknown = scopes.filter((scope) => !SCOPES.some((known) => known === scope));
        if (unknown.length > 0 || scopes.length === 0) {
            throw new InvalidValueError(
                { '/scopes': [`must be some of ${SCOPES.join(', ')}`] },
                `Unknown scopes: ${unknown.join(', ') || 'none given'}.`,
            );
        }
        const name = options.name?.trim() || 'default';
        if (name.length > 255) {
            throw new InvalidValueError({ '/name': ['must be at most 255 characters'] });
        }

        const token = randomToken(TOKEN_PREFIX);
        const id = createId('apiKey');
        await this.#database.kysely
            .insertInto('api_keys')
            .values({
                id,
                project_id: project.id,
                name,
                prefix: token.slice(0, DISPLAY_LENGTH),
                hash: sha256(token),
                scopes: toJson(scopes),
                created_at: new Date(),
            })
            .execute();
        return { key: await this.get(id), token };
    }

    async get(id: string): Promise<ApiKey> {
        const row = await this.#database.kysely
            .selectFrom('api_keys')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (row === undefined) {
            throw new NotFoundError(`There is no API key "${id}".`);
        }
        return toApiKey(row);
    }

    async list(projectIdOrSlug: string): Promise<ApiKey[]> {
        const project = await this.#projects.get(projectIdOrSlug);
        const rows = await this.#database.kysely
            .selectFrom('api_keys')
            .selectAll()
            .where('project_id', '=', project.id)
            .orderBy('created_at')
            .execute();
        return rows.map(toApiKey);
    }

    async revoke(id: string): Promise<ApiKey> {
        const key = await this.get(id);
        if (key.revokedAt === undefined) {
            await this.#database.kysely
                .updateTable('api_keys')
                .set({ revoked_at: new Date() })
                .where('id', '=', id)
                .execute();
        }
        return this.get(id);
    }

    /**
     * Finds the project of a token. Returns `undefined` for an unknown or revoked key, and for a
     * disabled project: the caller answers 401 in every case, without saying which.
     */
    async authenticate(token: string): Promise<Authentication | undefined> {
        if (!token.startsWith(TOKEN_PREFIX) || token.length > 128) {
            return undefined;
        }
        const row = await this.#database.kysely
            .selectFrom('api_keys')
            .selectAll()
            .where('hash', '=', sha256(token))
            .executeTakeFirst();
        if (row === undefined) {
            return undefined;
        }
        const key = toApiKey(row);
        if (key.revokedAt !== undefined) {
            return undefined;
        }
        const project = await this.#projects.find(key.projectId);
        if (project === undefined || project.disabledAt !== undefined) {
            return undefined;
        }

        const now = new Date();
        if (
            key.lastUsedAt === undefined ||
            now.getTime() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION
        ) {
            await this.#database.kysely
                .updateTable('api_keys')
                .set({ last_used_at: now })
                .where('id', '=', key.id)
                .execute();
            key.lastUsedAt = now;
        }
        return { project, key };
    }
}
