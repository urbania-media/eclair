import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Operation, OperationProviders } from '@eclair-js/operation';
import { runOperation } from '@eclair-js/operation/testing';

export function fixture(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** A models directory with empty model files of these names, for the fake whisper-cli. */
export async function fakeModels(...files: string[]): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'eclair-models-'));
    for (const file of files) {
        await writeFile(join(directory, file), '');
    }
    return directory;
}

/**
 * Runs an operation on a fixture, with the fake whisper-cli of the fixtures unless `whisper` gives
 * the real one. Call `cleanup()` on the result.
 */
export function runOn(
    operation: Operation,
    name: string,
    options: Record<string, unknown> = {},
    run: {
        providers?: OperationProviders;
        whisper?: string;
        maxTimeout?: number;
        available?: Record<string, boolean>;
    } = {},
) {
    return runOperation(operation, {
        input: fixture(name),
        options,
        timeout: 600_000,
        binaries: { 'whisper-cli': run.whisper ?? fixture('fake-whisper-cli.mjs') },
        ...(run.providers === undefined ? {} : { providers: run.providers }),
        ...(run.maxTimeout === undefined ? {} : { maxTimeout: run.maxTimeout }),
        ...(run.available === undefined ? {} : { available: run.available }),
    });
}
