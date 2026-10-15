import type { Selectable } from 'kysely';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import { detectType } from '@eclair-js/operation';
import type { ProbeMetadata, Upload } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import type { UploadsTable } from '../database/tables.ts';
import {
    readDate,
    readNumber,
    readOptionalDate,
    readOptionalJson,
    readOptionalNumber,
    toJson,
} from '../database/values.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { createId } from '../ids.ts';
import type { Project } from '../projects/projects.ts';
import { StorageError } from '../storages/drivers/types.ts';
import type { TemporaryStorage } from '../storages/temporary.ts';

export interface UploadPart {
    offset: number;
    size: number;
    /** Path of the part in the project's temporary storage. */
    path: string;
}

export interface UploadRecord {
    id: string;
    projectId: string;
    /** Path of the file in the project's temporary storage, or the prefix of its parts. */
    path: string;
    /** Declared by a resumable upload, or the size of a complete one. */
    size: number | undefined;
    received: number;
    mime: string | undefined;
    checksum: string | undefined;
    metadata: ProbeMetadata | undefined;
    parts: UploadPart[] | undefined;
    expiresAt: Date;
    completedAt: Date | undefined;
    createdAt: Date;
}

export interface UploadLimits {
    /** Default retention of temporary files, in milliseconds. */
    tempRetention: number;
    /** Longest retention a project can set, in milliseconds. */
    tempMaxRetention: number;
}

function toRecord(row: Selectable<UploadsTable>): UploadRecord {
    return {
        id: row.id,
        projectId: row.project_id,
        path: row.path,
        size: readOptionalNumber(row.size),
        received: readNumber(row.received),
        mime: row.mime ?? undefined,
        checksum: row.checksum ?? undefined,
        metadata: readOptionalJson<ProbeMetadata>(row.metadata),
        parts: readOptionalJson<UploadPart[]>(row.parts),
        expiresAt: readDate(row.expires_at),
        completedAt: readOptionalDate(row.completed_at),
        createdAt: readDate(row.created_at),
    };
}

/** An upload as the protocol shows it. */
export function toUploadResponse(upload: UploadRecord): Upload {
    return {
        id: upload.id,
        size: upload.size ?? upload.received,
        ...(upload.mime === undefined ? {} : { mime: upload.mime }),
        complete: upload.completedAt !== undefined,
        createdAt: upload.createdAt.toISOString(),
        expiresAt: upload.expiresAt.toISOString(),
        ...(upload.metadata === undefined ? {} : { metadata: upload.metadata }),
    };
}

function filePath(id: string): string {
    return `uploads/${id}`;
}

/**
 * Files that projects send to Eclair's temporary storage (decision 0011), at once or resumable
 * with tus. Their type comes from their content once they are complete.
 */
export class Uploads {
    readonly #database: Database;
    readonly #temporary: TemporaryStorage;
    readonly #limits: UploadLimits;

    constructor(database: Database, temporary: TemporaryStorage, limits: UploadLimits) {
        this.#database = database;
        this.#temporary = temporary;
        this.#limits = limits;
    }

    /** When a file stored now expires, for this project. */
    expiry(project: Project, from = new Date()): Date {
        const retention = Math.min(
            project.settings.tempRetention ?? this.#limits.tempRetention,
            this.#limits.tempMaxRetention,
        );
        return new Date(from.getTime() + retention);
    }

    /** Stores a complete file, sent at once. `localPath` is a file on this machine. */
    async createFromFile(
        project: Project,
        localPath: string,
        size: number,
        checksum: string,
    ): Promise<UploadRecord> {
        const type = await detectType(localPath);
        const id = createId('upload');
        await this.#temporary
            .forProject(project.id)
            .write(filePath(id), localPath, { mime: type.mime, size, sha256: checksum });
        const now = new Date();
        await this.#database.kysely
            .insertInto('uploads')
            .values({
                id,
                project_id: project.id,
                path: filePath(id),
                size,
                received: size,
                mime: type.mime,
                checksum,
                expires_at: this.expiry(project, now),
                completed_at: now,
                created_at: now,
                updated_at: now,
            })
            .execute();
        return this.get(project.id, id);
    }

    /** Starts a resumable upload of `length` bytes. */
    async createResumable(project: Project, length: number): Promise<UploadRecord> {
        const id = createId('upload');
        const now = new Date();
        await this.#database.kysely
            .insertInto('uploads')
            .values({
                id,
                project_id: project.id,
                path: filePath(id),
                size: length,
                received: 0,
                parts: toJson([]),
                expires_at: this.expiry(project, now),
                ...(length === 0 ? { completed_at: now, mime: 'application/octet-stream' } : {}),
                created_at: now,
                updated_at: now,
            })
            .execute();
        return this.get(project.id, id);
    }

    async find(projectId: string, id: string): Promise<UploadRecord | undefined> {
        const row = await this.#database.kysely
            .selectFrom('uploads')
            .selectAll()
            .where('project_id', '=', projectId)
            .where('id', '=', id)
            .executeTakeFirst();
        if (row === undefined) {
            return undefined;
        }
        const upload = toRecord(row);
        return upload.expiresAt.getTime() <= Date.now() ? undefined : upload;
    }

    /** An upload of the project that hasn't expired. */
    async get(projectId: string, id: string): Promise<UploadRecord> {
        const upload = await this.find(projectId, id);
        if (upload === undefined) {
            throw new NotFoundError(`There is no upload "${id}".`);
        }
        return upload;
    }

    /**
     * Appends a part to a resumable upload at `offset`. Fails with a `ConflictError` when `offset`
     * isn't where the upload is, as tus says. Completes the upload when it has every byte.
     */
    async append(
        project: Project,
        id: string,
        offset: number,
        localPath: string,
        size: number,
    ): Promise<UploadRecord> {
        const upload = await this.get(project.id, id);
        if (upload.parts === undefined || upload.completedAt !== undefined) {
            throw new ConflictError('The upload is complete.');
        }
        if (offset !== upload.received) {
            throw new ConflictError(`The upload is at offset ${upload.received}, not ${offset}.`);
        }
        if (upload.size !== undefined && offset + size > upload.size) {
            throw new ConflictError(
                `The part goes beyond the upload's length of ${upload.size} bytes.`,
            );
        }

        // A unique name: a part that loses a race never replaces the part that won.
        const part = {
            offset,
            size,
            path: `${filePath(id)}.parts/${String(offset).padStart(16, '0')}-${randomBytes(4).toString('hex')}`,
        };
        const storage = this.#temporary.forProject(project.id);
        await storage.write(part.path, localPath, {
            mime: 'application/octet-stream',
            size,
            sha256: '',
        });

        const received = offset + size;
        const complete = upload.size !== undefined && received === upload.size;
        const now = new Date();
        const mime = complete
            ? await this.#detectFirstPart(project.id, [...upload.parts, part], localPath)
            : undefined;
        const result = await this.#database.kysely
            .updateTable('uploads')
            .set({
                received,
                parts: toJson([...upload.parts, part]),
                ...(complete ? { completed_at: now, mime } : {}),
                updated_at: now,
            })
            .where('id', '=', id)
            .where('received', '=', offset)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            await storage.delete(part.path);
            throw new ConflictError(`Another request appended to the upload at offset ${offset}.`);
        }
        return this.get(project.id, id);
    }

    /** The type of a completed upload, from its first part. */
    async #detectFirstPart(
        projectId: string,
        parts: UploadPart[],
        lastLocalPath: string,
    ): Promise<string> {
        const first = parts[0];
        if (first === undefined) {
            return 'application/octet-stream';
        }
        if (parts.length === 1) {
            return (await detectType(lastLocalPath)).mime;
        }
        const local = `${lastLocalPath}.first`;
        try {
            await this.#temporary
                .forProject(projectId)
                .read(first.path, local, { maxSize: first.size });
            return (await detectType(local)).mime;
        } finally {
            await rm(local, { force: true });
        }
    }

    /** Copies a complete upload to a local file, for a worker. Returns its size. */
    async fetch(
        projectId: string,
        id: string,
        destination: string,
        maxSize: number,
        signal?: AbortSignal,
    ): Promise<number> {
        const upload = await this.get(projectId, id);
        if (upload.completedAt === undefined) {
            throw new StorageError('not_found', `The upload ${id} isn't complete.`);
        }
        if (upload.received > maxSize) {
            throw new StorageError(
                'limit_exceeded',
                `The upload ${id} is larger than ${maxSize} bytes.`,
            );
        }
        const storage = this.#temporary.forProject(projectId);
        if (upload.parts === undefined) {
            return storage.read(upload.path, destination, { maxSize, signal });
        }
        const output = createWriteStream(destination);
        try {
            for (const part of upload.parts) {
                const local = `${destination}.part`;
                await storage.read(part.path, local, { maxSize: part.size, signal });
                await pipeline(createReadStream(local), output, { end: false, signal });
                await rm(local, { force: true });
            }
        } finally {
            await new Promise<void>((resolve, reject) =>
                output.end((error?: Error | null) => (error ? reject(error) : resolve())),
            );
        }
        return upload.received;
    }

    /** Deletes an upload and its files. */
    async delete(projectId: string, id: string): Promise<void> {
        const upload = await this.get(projectId, id);
        await this.#deleteFiles(upload);
        await this.#database.kysely.deleteFrom('uploads').where('id', '=', upload.id).execute();
    }

    async #deleteFiles(upload: UploadRecord): Promise<void> {
        const storage = this.#temporary.forProject(upload.projectId);
        if (upload.parts === undefined) {
            await storage.delete(upload.path);
        } else {
            await this.#temporary.deletePrefix(upload.projectId, `${upload.path}.parts`);
        }
    }

    /** Deletes the expired uploads and their files. Returns how many. */
    async purgeExpired(now = new Date(), batch = 100): Promise<number> {
        const rows = await this.#database.kysely
            .selectFrom('uploads')
            .selectAll()
            .where('expires_at', '<=', now)
            .limit(batch)
            .execute();
        for (const upload of rows.map(toRecord)) {
            await this.#deleteFiles(upload);
            await this.#database.kysely.deleteFrom('uploads').where('id', '=', upload.id).execute();
        }
        return rows.length;
    }
}
