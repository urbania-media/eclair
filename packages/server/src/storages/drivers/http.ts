import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { request } from 'undici';

import { EMPTY_SHA256, signStorageRequest } from '../signing.ts';
import type { SigningSecrets } from '../signing.ts';
import type { HttpStorageConfig } from '../storages.ts';
import { SizeLimit } from './s3.ts';
import { StorageError, checkStoragePath } from './types.ts';
import type { ReadOptions, StorageDriver, WriteOptions } from './types.ts';

/**
 * An endpoint of the application that serves and receives files, signed with the project's secrets
 * (`storage.read` and `storage.write` in the protocol). The endpoint is set by an admin, not by a
 * request, so it may be on a private network.
 */
export class HttpDriver implements StorageDriver {
    readonly #url: string;
    readonly #secrets: SigningSecrets;

    constructor(config: HttpStorageConfig, secrets: SigningSecrets) {
        this.#url = config.url.replace(/\/+$/, '');
        this.#secrets = secrets;
    }

    #location(path: string): string {
        return `${this.#url}/${checkStoragePath(path).split('/').map(encodeURIComponent).join('/')}`;
    }

    #headers(path: string, sha256: string, jobId: string | undefined): Record<string, string> {
        return {
            'eclair-signature': signStorageRequest(this.#secrets, path, sha256),
            ...(jobId === undefined ? {} : { 'eclair-job': jobId }),
        };
    }

    async read(path: string, destination: string, options: ReadOptions): Promise<number> {
        let response;
        try {
            response = await request(this.#location(path), {
                method: 'GET',
                headers: this.#headers(path, EMPTY_SHA256, options.jobId),
                signal: options.signal,
            });
        } catch (error) {
            throw new StorageError(
                'storage_failed',
                `Could not reach the storage to read ${path}.`,
                { cause: error },
            );
        }
        if (response.statusCode === 404) {
            await response.body.dump();
            throw new StorageError('not_found', `No file at ${path}.`);
        }
        if (response.statusCode !== 200) {
            await response.body.dump();
            throw new StorageError(
                'storage_failed',
                `The storage answered ${response.statusCode} to read ${path}.`,
            );
        }
        const length = Number(response.headers['content-length']);
        if (Number.isFinite(length) && length > options.maxSize) {
            // Destroying the body aborts it: catch that, it's what we want.
            response.body.on('error', () => {});
            response.body.destroy();
            throw new StorageError(
                'limit_exceeded',
                `${path} is larger than ${options.maxSize} bytes.`,
            );
        }
        const limit = new SizeLimit(options.maxSize, path);
        await pipeline(response.body, limit, createWriteStream(destination), {
            signal: options.signal,
        });
        return limit.bytes;
    }

    async write(path: string, source: string, options: WriteOptions): Promise<void> {
        let response;
        try {
            response = await request(this.#location(path), {
                method: 'PUT',
                headers: {
                    ...this.#headers(path, options.sha256, options.jobId),
                    'content-type': options.mime,
                    'content-length': String(options.size),
                    'eclair-content-sha256': options.sha256,
                },
                body: createReadStream(source),
            });
        } catch (error) {
            throw new StorageError(
                'storage_failed',
                `Could not reach the storage to write ${path}.`,
                { cause: error },
            );
        }
        await response.body.dump();
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new StorageError(
                'storage_failed',
                `The storage answered ${response.statusCode} to write ${path}.`,
            );
        }
    }

    async delete(path: string): Promise<void> {
        // The protocol has no delete for http storages: only kept outputs are written to them.
        throw new StorageError('storage_failed', `An http storage can't delete ${path}.`);
    }
}
