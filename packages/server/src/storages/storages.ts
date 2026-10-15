import type { Selectable } from 'kysely';
import { Type } from 'typebox';
import type { Static } from 'typebox';

import { decryptSecret, encryptSecret } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import type { StoragesTable } from '../database/tables.ts';
import { readDate } from '../database/values.ts';
import { NotFoundError } from '../errors.ts';
import { createId } from '../ids.ts';
import type { Projects } from '../projects/projects.ts';
import { InvalidValueError, createValidator } from '../validation.ts';

/** The name of Eclair's temporary storage, which every project has (decision 0011). */
export const TEMPORARY_STORAGE = 'eclair';

export const STORAGE_NAME_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';

/** Any S3-compatible service. The credentials should be scoped to the bucket and prefix. */
export const S3StorageSchema = Type.Object(
    {
        bucket: Type.String({ minLength: 3, maxLength: 63 }),
        region: Type.String({ minLength: 1, default: 'us-east-1' }),
        /** For services other than AWS: `https://tor1.digitaloceanspaces.com`, `http://minio:9000`. */
        endpoint: Type.Optional(Type.String({ pattern: '^https?://[^\\s/]+(:[0-9]+)?/?$' })),
        /** Prefix of every path, usually ending with `/`. */
        prefix: Type.String({ maxLength: 512, default: '' }),
        accessKeyId: Type.String({ minLength: 1 }),
        secretAccessKey: Type.String({ minLength: 1 }),
        forcePathStyle: Type.Boolean({ default: false }),
    },
    { additionalProperties: false },
);

/** An endpoint of the application that serves inputs and receives outputs, signed (see the protocol). */
export const HttpStorageSchema = Type.Object(
    {
        url: Type.String({ pattern: '^https?://[^\\s]+$', maxLength: 2048 }),
    },
    { additionalProperties: false },
);

export type S3StorageConfig = Static<typeof S3StorageSchema>;
export type HttpStorageConfig = Static<typeof HttpStorageSchema>;

export type StorageConfig =
    { kind: 's3'; config: S3StorageConfig } | { kind: 'http'; config: HttpStorageConfig };

export type StorageKind = StorageConfig['kind'];

export const STORAGE_KINDS = ['s3', 'http'] as const satisfies readonly StorageKind[];

const validators = {
    s3: createValidator<S3StorageConfig>(S3StorageSchema),
    http: createValidator<HttpStorageConfig>(HttpStorageSchema),
};

/** A storage without its credentials, safe to show. */
export interface StorageSummary {
    id: string;
    projectId: string;
    name: string;
    kind: StorageKind;
    /** Where it points: `s3://bucket/prefix (endpoint)` or the URL. */
    location: string;
    createdAt: Date;
    updatedAt: Date;
}

export type Storage = StorageSummary & StorageConfig;

function describe(storage: StorageConfig): string {
    if (storage.kind === 's3') {
        const { bucket, prefix, endpoint, region } = storage.config;
        return `s3://${bucket}/${prefix} (${endpoint ?? `AWS ${region}`})`;
    }
    return storage.config.url;
}

/** Storages of the projects (decisions 0002 and 0011). Their configuration is encrypted. */
export class Storages {
    readonly #database: Database;
    readonly #projects: Projects;
    readonly #secretKey: Buffer;

    constructor(database: Database, projects: Projects, secretKey: Buffer) {
        this.#database = database;
        this.#projects = projects;
        this.#secretKey = secretKey;
    }

    #decrypt(row: Selectable<StoragesTable>): Storage {
        const config = JSON.parse(decryptSecret(this.#secretKey, row.config)) as unknown;
        const storage = { kind: row.kind, config } as StorageConfig;
        return {
            id: row.id,
            projectId: row.project_id,
            name: row.name,
            ...storage,
            location: describe(storage),
            createdAt: readDate(row.created_at),
            updatedAt: readDate(row.updated_at),
        };
    }

    /** Creates or replaces a storage of a project. */
    async set(
        projectIdOrSlug: string,
        name: string,
        kind: string,
        config: unknown,
    ): Promise<StorageSummary> {
        const project = await this.#projects.get(projectIdOrSlug);
        if (!new RegExp(STORAGE_NAME_PATTERN).test(name)) {
            throw new InvalidValueError(
                { '/name': ['must be lowercase letters, digits, - and _, at most 64'] },
                `"${name}" is not a valid storage name.`,
            );
        }
        if (name === TEMPORARY_STORAGE) {
            throw new InvalidValueError(
                { '/name': ['is reserved for the temporary storage'] },
                `"${TEMPORARY_STORAGE}" is Eclair's temporary storage: choose another name.`,
            );
        }
        if (kind !== 's3' && kind !== 'http') {
            throw new InvalidValueError(
                { '/kind': [`must be one of ${STORAGE_KINDS.join(', ')}`] },
                `"${kind}" is not a storage kind.`,
            );
        }
        const valid = validators[kind](config, '/config');
        const encrypted = encryptSecret(this.#secretKey, JSON.stringify(valid));
        const now = new Date();

        const existing = await this.#database.kysely
            .selectFrom('storages')
            .select('id')
            .where('project_id', '=', project.id)
            .where('name', '=', name)
            .executeTakeFirst();
        if (existing === undefined) {
            await this.#database.kysely
                .insertInto('storages')
                .values({
                    id: createId('storage'),
                    project_id: project.id,
                    name,
                    kind,
                    config: encrypted,
                    created_at: now,
                    updated_at: now,
                })
                .execute();
        } else {
            await this.#database.kysely
                .updateTable('storages')
                .set({ kind, config: encrypted, updated_at: now })
                .where('id', '=', existing.id)
                .execute();
        }
        return this.summary(await this.get(project.id, name));
    }

    /** A storage with its decrypted configuration, for the workers. */
    async get(projectId: string, name: string): Promise<Storage> {
        const row = await this.#database.kysely
            .selectFrom('storages')
            .selectAll()
            .where('project_id', '=', projectId)
            .where('name', '=', name)
            .executeTakeFirst();
        if (row === undefined) {
            throw new NotFoundError(`The project has no storage "${name}".`);
        }
        return this.#decrypt(row);
    }

    async has(projectId: string, name: string): Promise<boolean> {
        const row = await this.#database.kysely
            .selectFrom('storages')
            .select('id')
            .where('project_id', '=', projectId)
            .where('name', '=', name)
            .executeTakeFirst();
        return row !== undefined;
    }

    async list(projectIdOrSlug: string): Promise<StorageSummary[]> {
        const project = await this.#projects.get(projectIdOrSlug);
        const rows = await this.#database.kysely
            .selectFrom('storages')
            .selectAll()
            .where('project_id', '=', project.id)
            .orderBy('name')
            .execute();
        return rows.map((row) => this.summary(this.#decrypt(row)));
    }

    async remove(projectIdOrSlug: string, name: string): Promise<void> {
        const project = await this.#projects.get(projectIdOrSlug);
        const result = await this.#database.kysely
            .deleteFrom('storages')
            .where('project_id', '=', project.id)
            .where('name', '=', name)
            .executeTakeFirst();
        if (result.numDeletedRows === 0n) {
            throw new NotFoundError(`The project has no storage "${name}".`);
        }
    }

    summary(storage: Storage): StorageSummary {
        const { id, projectId, name, kind, location, createdAt, updatedAt } = storage;
        return { id, projectId, name, kind, location, createdAt, updatedAt };
    }
}
