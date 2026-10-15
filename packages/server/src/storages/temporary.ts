import { fileURLToPath } from 'node:url';

import type { Config } from '../config/config.ts';
import { LocalDriver } from './drivers/local.ts';
import { S3Driver } from './drivers/s3.ts';
import { checkStoragePath } from './drivers/types.ts';
import type { ReadOptions, StorageDriver, WriteOptions } from './drivers/types.ts';

/** A backend that can also delete a whole prefix. */
type Backend = StorageDriver & { deletePrefix(prefix: string): Promise<void> };

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
