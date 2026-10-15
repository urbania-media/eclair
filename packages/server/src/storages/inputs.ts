import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import type { Input } from '@eclair-js/protocol';

import { BlockedUrlError, guardedRequest } from '../net/ssrf.ts';
import type { GuardOptions } from '../net/ssrf.ts';
import type { Project } from '../projects/projects.ts';
import type { Uploads } from '../uploads/uploads.ts';
import { SizeLimit } from './drivers/s3.ts';
import { StorageError } from './drivers/types.ts';
import type { StorageResolver } from './resolver.ts';

export interface FetchInputOptions {
    project: Project;
    resolver: StorageResolver;
    uploads: Uploads;
    /** Bytes. A larger input fails with `limit_exceeded`. */
    maxSize: number;
    signal?: AbortSignal | undefined;
    jobId?: string | undefined;
    /** Only for tests, to reach a local server. */
    guard?: Pick<GuardOptions, 'allowHttp' | 'allowPrivateAddresses'>;
}

async function fetchUrl(
    url: string,
    destination: string,
    options: FetchInputOptions,
): Promise<number> {
    let response;
    try {
        response = await guardedRequest(url, {
            ...options.guard,
            allowedHosts: options.project.settings.inputHosts,
            signal: options.signal,
        });
    } catch (error) {
        if (error instanceof BlockedUrlError) {
            throw new StorageError('storage_failed', error.message, { cause: error });
        }
        throw new StorageError(
            'storage_failed',
            `Could not download ${new URL(url).host}: ${(error as Error).message}`,
            {
                cause: error,
            },
        );
    }
    if (response.statusCode !== 200) {
        await response.body.dump();
        throw new StorageError(
            response.statusCode === 404 || response.statusCode === 410
                ? 'not_found'
                : 'storage_failed',
            `The input URL answered ${response.statusCode}.`,
        );
    }
    const length = Number(response.headers['content-length']);
    if (Number.isFinite(length) && length > options.maxSize) {
        // Destroying the body aborts it: catch that, it's what we want.
        response.body.on('error', () => {});
        response.body.destroy();
        throw new StorageError(
            'limit_exceeded',
            `The input is larger than ${options.maxSize} bytes.`,
        );
    }
    const limit = new SizeLimit(options.maxSize, 'The input');
    await pipeline(response.body, limit, createWriteStream(destination), {
        signal: options.signal,
    });
    return limit.bytes;
}

/**
 * Copies the input of a job to a local file, whatever it is: a URL (through the SSRF guard), a
 * path in one of the project's storages, or an upload. Returns its size.
 */
export async function fetchInput(
    input: Input,
    destination: string,
    options: FetchInputOptions,
): Promise<number> {
    if ('url' in input) {
        return fetchUrl(input.url, destination, options);
    }
    if ('upload' in input) {
        return options.uploads.fetch(
            options.project.id,
            input.upload,
            destination,
            options.maxSize,
            options.signal,
        );
    }
    const driver = await options.resolver.driverFor(options.project.id, input.storage);
    return driver.read(input.path, destination, {
        maxSize: options.maxSize,
        signal: options.signal,
        jobId: options.jobId,
    });
}
