import type { Dirent } from 'node:fs';
import { opendir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../config/config.ts';
import { LocalDriver } from './drivers/local.ts';
import { S3Driver } from './drivers/s3.ts';
import { checkStoragePath } from './drivers/types.ts';
import type { ReadOptions, StorageDriver, WriteOptions } from './drivers/types.ts';

/** A backend that can also delete a whole prefix. */
type Backend = StorageDriver & { deletePrefix(prefix: string): Promise<void> };

/** What `GET /admin/v1/status` says of the temporary storage. */
export interface TemporaryStorageSize {
    kind: 'local' | 's3';
    files?: number;
    bytes?: number;
    /** Free space on a local disk. */
    freeBytes?: number;
}

/** Past this many files, a local storage isn't counted: its size would take too long to read. */
const MAX_COUNTED_FILES = 50_000;
/** Milliseconds a size is reused, so that a dashboard that polls doesn't walk the disk each time. */
const SIZE_CACHE = 60_000;

/** Files and bytes under a directory, or `undefined` past `limit` files. */
async function directorySize(
    root: string,
    limit: number,
): Promise<{ files: number; bytes: number } | undefined> {
    let files = 0;
    let bytes = 0;
    const directories = [root];
    for (
        let directory = directories.pop();
        directory !== undefined;
        directory = directories.pop()
    ) {
        let entries: AsyncIterable<Dirent>;
        try {
            entries = await opendir(directory);
        } catch {
            // Gone since it was listed, or never created: nothing in it.
            continue;
        }
        for await (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                directories.push(path);
            } else if (entry.isFile()) {
                files += 1;
                if (files > limit) {
                    return undefined;
                }
                bytes += await stat(path).then(
                    ({ size }) => size,
                    () => 0,
                );
            }
        }
    }
    return { files, bytes };
}

/**
 * Eclair's temporary storage (decision 0011): a local directory on a single server, or an
 * S3-compatible bucket shared by several. Every file is under its project's id.
 */
export class TemporaryStorage {
    readonly backend: Backend;

    constructor(backend: Backend) {
        this.backend = backend;
    }

    /** From `ECLAIR_TEMP_STORAGE`: `file:///var/lib/eclair/storage` or `s3://bucket/prefix?endpoint=…&region=…`. */
    static fromConfig(
        config: Pick<Config, 'tempStorage' | 'tempStorageCredentials'>,
    ): TemporaryStorage {
        const url = new URL(config.tempStorage);
        if (url.protocol === 'file:') {
            return new TemporaryStorage(new LocalDriver(fileURLToPath(url)));
        }
        if (config.tempStorageCredentials === undefined) {
            throw new Error(
                'The s3:// temporary storage needs ECLAIR_TEMP_S3_ACCESS_KEY_ID and ECLAIR_TEMP_S3_SECRET_ACCESS_KEY.',
            );
        }
        const prefix = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const endpoint = url.searchParams.get('endpoint');
        return new TemporaryStorage(
            new S3Driver({
                bucket: url.hostname,
                prefix: prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`,
                region: url.searchParams.get('region') ?? 'us-east-1',
                ...(endpoint === null ? {} : { endpoint }),
                forcePathStyle: url.searchParams.get('pathStyle') === 'true',
                ...config.tempStorageCredentials,
            }),
        );
    }

    #size: { value: TemporaryStorageSize; at: number } | undefined;

    /**
     * The size of a local storage: its files and bytes (unless it holds more than 50,000 files)
     * and the free space of its disk, read at most once a minute. An S3 storage only gives its
     * kind: listing a bucket costs requests.
     */
    async size(): Promise<TemporaryStorageSize> {
        if (!(this.backend instanceof LocalDriver)) {
            return { kind: 's3' };
        }
        if (this.#size !== undefined && Date.now() - this.#size.at < SIZE_CACHE) {
            return this.#size.value;
        }
        const root = this.backend.root;
        const [counted, free] = await Promise.all([
            directorySize(root, MAX_COUNTED_FILES),
            statfs(root).then(
                ({ bavail, bsize }) => bavail * bsize,
                () => undefined,
            ),
        ]);
        const value: TemporaryStorageSize = {
            kind: 'local',
            ...counted,
            ...(free === undefined ? {} : { freeBytes: free }),
        };
        this.#size = { value, at: Date.now() };
        return value;
    }

    /** The temporary storage of one project: paths are under its id. */
    forProject(projectId: string): StorageDriver {
        const scoped = (path: string) => `${projectId}/${checkStoragePath(path)}`;
        return {
            read: (path: string, destination: string, options: ReadOptions) =>
                this.backend.read(scoped(path), destination, options),
            write: (path: string, source: string, options: WriteOptions) =>
                this.backend.write(scoped(path), source, options),
            delete: (path: string) => this.backend.delete(scoped(path)),
        };
    }

    /** Deletes a prefix of a project, or the whole project. */
    async deletePrefix(projectId: string, prefix = ''): Promise<void> {
        await this.backend.deletePrefix(
            prefix === '' ? `${projectId}/` : `${projectId}/${checkStoragePath(prefix)}`,
        );
    }
}
