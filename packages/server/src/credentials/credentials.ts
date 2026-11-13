import type { Selectable } from 'kysely';
import { Type } from 'typebox';

import { decryptSecret, encryptSecret } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import type { CredentialsTable } from '../database/tables.ts';
import { readDate } from '../database/values.ts';
import { NotFoundError } from '../errors.ts';
import { createId } from '../ids.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { Projects } from '../projects/projects.ts';
import { InvalidValueError, createValidator } from '../validation.ts';

export const PROVIDER_PATTERN = '^[a-z][a-z0-9-]{0,63}$';

/** Credentials are strings by key (`{ apiKey }`), whatever the provider. */
const validateStrings = createValidator<Record<string, string>>(
    Type.Record(Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9]*$' }), Type.String({ minLength: 1 }), {
        minProperties: 1,
        maxProperties: 16,
    }),
);

/** A provider's credentials of a project, without their values. */
export interface CredentialsSummary {
    provider: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * The credentials of the projects for embed providers (decision 0022), encrypted with
 * `ECLAIR_SECRET_KEY` like storages. Their values are never shown again.
 */
export class Credentials {
    readonly #database: Database;
    readonly #projects: Projects;
    readonly #secretKey: Buffer;
    #operations: OperationRegistry | undefined;

    constructor(database: Database, projects: Projects, secretKey: Buffer) {
        this.#database = database;
        this.#projects = projects;
        this.#secretKey = secretKey;
    }

    /**
     * With the operations, only the providers of the server take credentials, checked against the
     * provider's schema. Without them (CLI commands), any provider name does.
     */
    setOperations(operations: OperationRegistry | undefined): void {
        this.#operations = operations;
    }

    #summary(row: Selectable<CredentialsTable>): CredentialsSummary {
        return {
            provider: row.provider,
            createdAt: readDate(row.created_at),
            updatedAt: readDate(row.updated_at),
        };
    }

    /** Creates or replaces a provider's credentials of a project. */
    async set(
        projectIdOrSlug: string,
        provider: string,
        config: unknown,
    ): Promise<CredentialsSummary> {
        const project = await this.#projects.get(projectIdOrSlug);
        if (!new RegExp(PROVIDER_PATTERN).test(provider)) {
            throw new InvalidValueError(
                { '/provider': ['must be lowercase letters, digits and -'] },
                `"${provider}" is not a provider name.`,
            );
        }
        let valid = validateStrings(config, '/config');
        if (this.#operations !== undefined) {
            const definition = this.#operations.embedProvider(provider);
            if (definition === undefined) {
                throw new InvalidValueError(
                    { '/provider': ['is not an embed provider of this server'] },
                    `This server has no embed provider "${provider}".`,
                );
            }
            if (definition.credentials === undefined) {
                throw new InvalidValueError(
                    { '/provider': ['takes no credentials'] },
                    `${definition.title} takes no credentials.`,
                );
            }
            valid = createValidator<Record<string, string>>(definition.credentials)(
                valid,
                '/config',
            );
        }
        const encrypted = encryptSecret(this.#secretKey, JSON.stringify(valid));
        const now = new Date();
        const existing = await this.#database.kysely
            .selectFrom('credentials')
            .select('id')
            .where('project_id', '=', project.id)
            .where('provider', '=', provider)
            .executeTakeFirst();
        if (existing === undefined) {
            await this.#database.kysely
                .insertInto('credentials')
                .values({
                    id: createId('credentials'),
                    project_id: project.id,
                    provider,
                    config: encrypted,
                    created_at: now,
                    updated_at: now,
                })
                .execute();
        } else {
            await this.#database.kysely
                .updateTable('credentials')
                .set({ config: encrypted, updated_at: now })
                .where('id', '=', existing.id)
                .execute();
        }
        const row = await this.#database.kysely
            .selectFrom('credentials')
            .selectAll()
            .where('project_id', '=', project.id)
            .where('provider', '=', provider)
            .executeTakeFirstOrThrow();
        return this.#summary(row);
    }

    /** A provider's decrypted credentials of a project, for the workers. */
    async get(projectId: string, provider: string): Promise<Record<string, string> | undefined> {
        const row = await this.#database.kysely
            .selectFrom('credentials')
            .select('config')
            .where('project_id', '=', projectId)
            .where('provider', '=', provider)
            .executeTakeFirst();
        return row === undefined
            ? undefined
            : (JSON.parse(decryptSecret(this.#secretKey, row.config)) as Record<string, string>);
    }

    async list(projectIdOrSlug: string): Promise<CredentialsSummary[]> {
        const project = await this.#projects.get(projectIdOrSlug);
        const rows = await this.#database.kysely
            .selectFrom('credentials')
            .selectAll()
            .where('project_id', '=', project.id)
            .orderBy('provider')
            .execute();
        return rows.map((row) => this.#summary(row));
    }

    async remove(projectIdOrSlug: string, provider: string): Promise<void> {
        const project = await this.#projects.get(projectIdOrSlug);
        const result = await this.#database.kysely
            .deleteFrom('credentials')
            .where('project_id', '=', project.id)
            .where('provider', '=', provider)
            .executeTakeFirst();
        if (result.numDeletedRows === 0n) {
            throw new NotFoundError(`The project has no credentials for "${provider}".`);
        }
    }
}
