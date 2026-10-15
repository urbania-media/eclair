export interface WriteOptions {
    mime: string;
    size: number;
    /** SHA-256 of the file, in hex. */
    sha256: string;
    /** The job the file belongs to, for `http` storages. */
    jobId?: string | undefined;
}

export interface ReadOptions {
    /** Bytes. A larger file fails with a `StorageError` of code `limit_exceeded`. */
    maxSize: number;
    signal?: AbortSignal | undefined;
    jobId?: string | undefined;
}

/** A place where files are read and written by path: a project's storage, or the temporary one. */
export interface StorageDriver {
    /** Reads a file into `destination`, a local path. Returns its size. */
    read(path: string, destination: string, options: ReadOptions): Promise<number>;
    /** Writes a local file to `path`. Writing the same path again replaces the file. */
    write(path: string, source: string, options: WriteOptions): Promise<void>;
    /** Deletes a file. Deleting a file that doesn't exist does nothing. */
    delete(path: string): Promise<void>;
}

export type StorageErrorCode = 'not_found' | 'limit_exceeded' | 'storage_failed';

/** A storage failed. The message says which storage and path, never credentials. */
export class StorageError extends Error {
    readonly code: StorageErrorCode;

    constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'StorageError';
        this.code = code;
    }
}

/** Checks a storage path: relative, no `..`, no empty segment, no control characters. */
export function checkStoragePath(path: string): string {
    const segments = path.split('/');
    if (
        path === '' ||
        path.startsWith('/') ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
        // Control characters and backslashes.
        [...path].some(
            (character) =>
                character.charCodeAt(0) < 0x20 || character === '\u007f' || character === '\\',
        )
    ) {
        throw new StorageError('storage_failed', `"${path}" is not a valid storage path.`);
    }
    return path;
}
