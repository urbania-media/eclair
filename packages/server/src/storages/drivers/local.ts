import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { StorageError, checkStoragePath } from './types.ts';
import type { ReadOptions, StorageDriver, WriteOptions } from './types.ts';

/** Files in a local directory: the temporary storage of a single server. */
export class LocalDriver implements StorageDriver {
    readonly #root: string;

    constructor(root: string) {
        this.#root = resolve(root);
    }

    /** The directory of the files. */
    get root(): string {
        return this.#root;
    }

    /** The local path of a storage path, to stream it. */
    localPath(path: string): string {
        return this.#resolve(path);
    }

    /** The local path of a storage path, which can't leave the root. */
    #resolve(path: string): string {
        const full = resolve(join(this.#root, checkStoragePath(path)));
        if (!full.startsWith(this.#root + sep)) {
            throw new StorageError('storage_failed', `"${path}" is outside the storage.`);
        }
        return full;
    }

    async read(path: string, destination: string, options: ReadOptions): Promise<number> {
        const source = this.#resolve(path);
        let size: number;
        try {
            size = (await stat(source)).size;
        } catch (error) {
            throw new StorageError('not_found', `No file at ${path}.`, { cause: error });
        }
        if (size > options.maxSize) {
            throw new StorageError(
                'limit_exceeded',
                `${path} is larger than ${options.maxSize} bytes.`,
            );
        }
        await copyFile(source, destination);
        return size;
    }

    async write(path: string, source: string, _options: WriteOptions): Promise<void> {
        const destination = this.#resolve(path);
        await mkdir(dirname(destination), { recursive: true });
        // Copy to a temporary name, then rename: a reader never sees half a file.
        const partial = `${destination}.partial`;
        await copyFile(source, partial);
        await rename(partial, destination);
    }

    async delete(path: string): Promise<void> {
        await rm(this.#resolve(path), { force: true });
    }

    /** Deletes everything under a prefix (a project, an upload). */
    async deletePrefix(prefix: string): Promise<void> {
        await rm(this.#resolve(prefix.replace(/\/+$/, '')), { recursive: true, force: true });
    }
}
