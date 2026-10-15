import {
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { S3StorageConfig } from '../storages.ts';
import { StorageError, checkStoragePath } from './types.ts';
import type { ReadOptions, StorageDriver, WriteOptions } from './types.ts';

/** Counts the bytes that pass through, and fails once there are more than `maxSize`. */
export class SizeLimit extends Transform {
    bytes = 0;

    constructor(maxSize: number, label: string) {
        super({
            transform: (chunk: Buffer, _encoding, callback) => {
                this.bytes += chunk.length;
                if (this.bytes > maxSize) {
                    callback(
                        new StorageError(
                            'limit_exceeded',
                            `${label} is larger than ${maxSize} bytes.`,
                        ),
                    );
                } else {
                    callback(null, chunk);
                }
            },
        });
    }
}

function statusOf(error: unknown): number | undefined {
    return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** Any S3-compatible service. Paths are keys under the storage's prefix. */
export class S3Driver implements StorageDriver {
    readonly #client: S3Client;
    readonly #bucket: string;
    readonly #prefix: string;

    constructor(config: S3StorageConfig) {
        this.#client = new S3Client({
            region: config.region,
            ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
            forcePathStyle: config.forcePathStyle,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        this.#bucket = config.bucket;
        this.#prefix = config.prefix;
    }

    #key(path: string): string {
        return `${this.#prefix}${checkStoragePath(path)}`;
    }

    #fail(action: string, path: string, error: unknown): never {
        if (error instanceof StorageError) {
            throw error;
        }
        if (statusOf(error) === 404 || (error as { name?: string }).name === 'NoSuchKey') {
            throw new StorageError('not_found', `No file at ${path}.`, { cause: error });
        }
        throw new StorageError(
            'storage_failed',
            `Could not ${action} ${path} in s3://${this.#bucket} (${(error as { name?: string }).name ?? 'error'}).`,
            { cause: error },
        );
    }

    async read(path: string, destination: string, options: ReadOptions): Promise<number> {
        try {
            const response = await this.#client.send(
                new GetObjectCommand({ Bucket: this.#bucket, Key: this.#key(path) }),
                { abortSignal: options.signal },
            );
            if (response.ContentLength !== undefined && response.ContentLength > options.maxSize) {
                (response.Body as Readable | undefined)?.destroy();
                throw new StorageError(
                    'limit_exceeded',
                    `${path} is larger than ${options.maxSize} bytes.`,
                );
            }
            const limit = new SizeLimit(options.maxSize, path);
            await pipeline(response.Body as Readable, limit, createWriteStream(destination), {
                signal: options.signal,
            });
            return limit.bytes;
        } catch (error) {
            this.#fail('read', path, error);
        }
    }

    async write(path: string, source: string, options: WriteOptions): Promise<void> {
        try {
            // Multipart for large files, a single PUT for small ones.
            await new Upload({
                client: this.#client,
                params: {
                    Bucket: this.#bucket,
                    Key: this.#key(path),
                    Body: createReadStream(source),
                    ContentType: options.mime,
                    ContentLength: options.size,
                },
            }).done();
        } catch (error) {
            this.#fail('write', path, error);
        }
    }

    async delete(path: string): Promise<void> {
        try {
            await this.#client.send(
                new DeleteObjectCommand({ Bucket: this.#bucket, Key: this.#key(path) }),
            );
        } catch (error) {
            if (statusOf(error) !== 404) {
                this.#fail('delete', path, error);
            }
        }
    }

    /** Deletes every key under a prefix (a project, an upload). */
    async deletePrefix(prefix: string): Promise<void> {
        const keyPrefix = `${this.#prefix}${prefix}`;
        let token: string | undefined;
        do {
            const page = await this.#client.send(
                new ListObjectsV2Command({
                    Bucket: this.#bucket,
                    Prefix: keyPrefix,
                    ContinuationToken: token,
                }),
            );
            const keys = (page.Contents ?? []).flatMap(({ Key }) =>
                Key === undefined ? [] : [{ Key }],
            );
            if (keys.length > 0) {
                await this.#client.send(
                    new DeleteObjectsCommand({
                        Bucket: this.#bucket,
                        Delete: { Objects: keys, Quiet: true },
                    }),
                );
            }
            token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
        } while (token !== undefined);
    }

    /** A presigned URL that downloads a file, valid for `expiresIn` seconds. */
    async presign(path: string, expiresIn: number): Promise<string> {
        return getSignedUrl(
            this.#client,
            new GetObjectCommand({ Bucket: this.#bucket, Key: this.#key(path) }),
            {
                expiresIn,
            },
        );
    }

    close(): void {
        this.#client.destroy();
    }
}
