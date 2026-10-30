import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { StorageCheck } from '@eclair-js/protocol';

import { sha256 } from '../crypto.ts';
import type { Projects } from '../projects/projects.ts';
import { StorageError } from './drivers/types.ts';
import type { StorageResolver } from './resolver.ts';
import type { Storages } from './storages.ts';

/** Where a check writes its file, in the storage. */
export const CHECK_DIRECTORY = '.eclair';

/** What a check reports of an error: a storage error says which path, never credentials. */
function reason(error: unknown): string {
    return error instanceof StorageError ? error.message : 'The storage failed.';
}

/**
 * Checks that Eclair reaches a project's storage with its configuration: writes a small file
 * under `.eclair/`, reads it back and deletes it. An `http` storage, which Eclair can't delete
 * from, is only read: a `GET` of a path that doesn't exist must answer `404`.
 */
export async function checkStorage(
    options: { projects: Projects; storages: Storages; resolver: StorageResolver; tmpDir: string },
    projectIdOrSlug: string,
    name: string,
): Promise<StorageCheck> {
    const project = await options.projects.get(projectIdOrSlug);
    const storage = await options.storages.get(project.id, name);
    const driver = await options.resolver.driverFor(project.id, name);
    const started = Date.now();
    const path = `${CHECK_DIRECTORY}/check-${randomBytes(8).toString('hex')}.txt`;

    await mkdir(options.tmpDir, { recursive: true });
    const directory = await mkdtemp(join(options.tmpDir, 'check-'));
    const result: Omit<StorageCheck, 'ok' | 'durationMs'> = { read: 'skipped', write: 'skipped' };
    let deleted = true;
    try {
        const destination = join(directory, 'read');
        if (storage.kind === 'http') {
            try {
                await driver.read(path, destination, { maxSize: 1024 });
                result.read = 'failed';
                result.message = `The storage answered a file for ${path}, which doesn't exist: it must answer 404.`;
            } catch (error) {
                if (error instanceof StorageError && error.code === 'not_found') {
                    result.read = 'ok';
                } else {
                    result.read = 'failed';
                    result.message = reason(error);
                }
            }
        } else {
            const content = `Eclair storage check, ${new Date().toISOString()}\n`;
            const source = join(directory, 'write');
            await writeFile(source, content);
            try {
                await driver.write(path, source, {
                    mime: 'text/plain',
                    size: Buffer.byteLength(content),
                    sha256: sha256(content),
                });
                result.write = 'ok';
            } catch (error) {
                result.write = 'failed';
                result.message = reason(error);
            }
            if (result.write === 'ok') {
                try {
                    await driver.read(path, destination, { maxSize: 1024 });
                    if ((await readFile(destination, 'utf8')) === content) {
                        result.read = 'ok';
                    } else {
                        result.read = 'failed';
                        result.message = `${path} read back differs from what was written.`;
                    }
                } catch (error) {
                    result.read = 'failed';
                    result.message = reason(error);
                }
                try {
                    await driver.delete(path);
                } catch (error) {
                    deleted = false;
                    result.message ??= reason(error);
                }
            }
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    return {
        ok: result.read !== 'failed' && result.write !== 'failed' && deleted,
        ...result,
        durationMs: Date.now() - started,
    };
}
