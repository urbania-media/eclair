import addFormatsModule from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProbeMetadata } from '@eclair-js/protocol';

import { detectType } from './detect.ts';
import { execBinary } from './exec.ts';
import type { Operation, OperationContext, OutputOptions } from './operation.ts';

// ajv-formats is CommonJS: its default export is under `default`.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

export interface RunOperationOptions {
    /** Path of the input file. Its type is detected from its content. */
    input: string;
    options?: unknown;
    /** Paths of binaries, when they're not on `PATH` under their name. */
    binaries?: Record<string, string>;
    /** Milliseconds for the whole run. */
    timeout?: number;
    probe?: ProbeMetadata;
}

export interface RunOperationResult {
    metadata: Record<string, unknown> | undefined;
    files: ({ name: string; path: string } & OutputOptions)[];
    progress: number[];
    /** The work directory, with the output files. Call `cleanup()` when done. */
    workdir: string;
    cleanup(): Promise<void>;
}

/**
 * Runs an operation on a file, as a worker would but without a queue or storage: options are
 * validated with their defaults, binaries run for real, and outputs stay in the work directory.
 * For the tests of operations (AGENTS.md: a new operation adds tests on a fixture for each output).
 */
export async function runOperation(
    operation: Operation,
    run: RunOperationOptions,
): Promise<RunOperationResult> {
    const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(operation.options);
    const options: unknown = structuredClone(run.options ?? {});
    if (!validate(options)) {
        throw new Error(`Invalid options for ${operation.key}: ${ajv.errorsText(validate.errors)}`);
    }

    const type = await detectType(run.input);
    const { size } = await stat(run.input);
    const workdir = await mkdtemp(join(tmpdir(), `eclair-${operation.name}-`));
    const files: RunOperationResult['files'] = [];
    const progress: number[] = [];
    const controller = new AbortController();
    const timer =
        run.timeout === undefined ? undefined : setTimeout(() => controller.abort(), run.timeout);

    const context: OperationContext = {
        input: { path: run.input, ...type, size, probe: run.probe },
        workdir,
        exec: (binary, args, options) => {
            if (!operation.binaries.includes(binary)) {
                throw new Error(
                    `${operation.key} runs ${binary} without declaring it in binaries.`,
                );
            }
            return execBinary(run.binaries?.[binary] ?? binary, args, {
                cwd: workdir,
                ...options,
                signal: controller.signal,
            });
        },
        progress: (ratio) => progress.push(ratio),
        log: { debug: () => {}, info: () => {}, warn: () => {} },
        signal: controller.signal,
        output: (name, path, outputOptions) => files.push({ name, path, ...outputOptions }),
    };

    try {
        const result = await operation.run(context, options as never);
        return {
            metadata: result.metadata,
            files,
            progress,
            workdir,
            cleanup: () => rm(workdir, { recursive: true, force: true }),
        };
    } catch (error) {
        await rm(workdir, { recursive: true, force: true });
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** The binaries of this list that aren't on `PATH`. */
export function missingBinaries(binaries: readonly string[]): string[] {
    return binaries.filter(
        (binary) => spawnSync(binary, ['-h'], { stdio: 'ignore' }).error !== undefined,
    );
}

/**
 * Whether the tests of an operation that runs `binaries` should be skipped: some are missing, and
 * `ECLAIR_TEST_BINARIES` isn't set. The image's CI job sets it, so there a missing binary fails.
 * Add a test that expects `missingBinaries()` to be empty, to fail in that case.
 */
export function skipWithoutBinaries(binaries: readonly string[]): boolean {
    return missingBinaries(binaries).length > 0 && process.env['ECLAIR_TEST_BINARIES'] !== '1';
}
