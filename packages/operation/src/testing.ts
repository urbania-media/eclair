import addFormatsModule from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProbeMetadata } from '@eclair-js/protocol';

import { detectType } from './detect.ts';
import type {
    EmbedLimits,
    EmbedMatch,
    EmbedProvider,
    HttpRequestOptions,
    HttpResponse,
    OperationCache,
} from './embeds.ts';
import { OperationError } from './errors.ts';
import { execBinary } from './exec.ts';
import type { ExecOptions, ExecResult } from './exec.ts';
import type {
    EmbedOperation,
    FileOperation,
    Operation,
    OperationContext,
    OutputOptions,
} from './operation.ts';

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

/** Validates options with their defaults, as the server does. */
function validateOptions(operation: FileOperation | EmbedOperation, value: unknown): unknown {
    const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(operation.options);
    const options: unknown = structuredClone(value ?? {});
    if (!validate(options)) {
        throw new Error(`Invalid options for ${operation.key}: ${ajv.errorsText(validate.errors)}`);
    }
    return options;
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
    if (operation.accepts.embeds === true) {
        throw new TypeError(`${operation.key} reads embeds: run it with runEmbedOperation().`);
    }
    const options = validateOptions(operation, run.options);
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
        const result = await (operation as FileOperation).run(context, options as never);
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

/** A provider's answer, for `runEmbedOperation()`: a JSON body, text or bytes, with a status. */
export interface FakeResponse {
    status?: number;
    headers?: Record<string, string>;
    /** A string or bytes are sent as they are; anything else as JSON. */
    body?: unknown;
}

/** The requests an embed operation sent, in order. */
export interface RecordedRequest extends HttpRequestOptions {
    url: string;
}

export interface RunEmbedOperationOptions {
    /** The page URL, as a job gives it. */
    url: string;
    /** The providers of the plugin: the one that matches the URL gives the input. */
    providers: readonly EmbedProvider[];
    options?: unknown;
    credentials?: Record<string, string>;
    /**
     * Answers each request of the operation: by full URL, by URL without its query string, or with
     * a function. A request without an answer fails the test.
     */
    responses?:
        | Record<string, FakeResponse>
        | ((url: string, options: HttpRequestOptions) => FakeResponse | undefined);
    /** The cache, shared between runs to test it. An empty one by default. */
    cache?: OperationCache;
    /** 2 GB and an hour by default. */
    limits?: Partial<EmbedLimits>;
    /**
     * Runs the operation's binaries: by default the real ones, on `PATH`. A function fakes them,
     * for binaries that would reach the network (yt-dlp).
     */
    exec?: (binary: string, args: readonly string[], options: ExecOptions) => Promise<ExecResult>;
    /**
     * Which binaries `available()` says this worker has: none by default, so that a binary on the
     * machine, such as yt-dlp, never reaches the network in a test without being asked to.
     */
    available?: Record<string, boolean>;
}

export interface RunEmbedOperationResult {
    metadata: Record<string, unknown> | undefined;
    requests: RecordedRequest[];
    /** The files the operation declared, in `workdir`. */
    files: ({ name: string; path: string } & OutputOptions)[];
    progress: number[];
    workdir: string;
    /** Deletes the work directory. */
    cleanup(): Promise<void>;
}

function bodyOf(response: FakeResponse): string | Uint8Array {
    if (typeof response.body === 'string' || response.body instanceof Uint8Array) {
        return response.body;
    }
    return JSON.stringify(response.body ?? null);
}

function toHttpResponse(response: FakeResponse): HttpResponse {
    const raw = bodyOf(response);
    const body = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
    return {
        status: response.status ?? 200,
        headers: response.headers ?? {},
        text: () => Promise.resolve(body),
        json: () => Promise.resolve(JSON.parse(body) as unknown),
    };
}

/** An in-memory cache, for tests. Expiry is ignored. */
export function memoryCache(): OperationCache & { values: Map<string, unknown> } {
    const values = new Map<string, unknown>();
    return {
        values,
        get: (key) => Promise.resolve(structuredClone(values.get(key))),
        set: (key, value) => {
            values.set(key, structuredClone(value));
            return Promise.resolve();
        },
    };
}

/**
 * Runs an embed operation on a page URL, as a worker would but without a network: the provider of
 * the plugin that matches the URL gives the input, and `responses` answers its requests.
 */
export async function runEmbedOperation(
    operation: EmbedOperation,
    run: RunEmbedOperationOptions,
): Promise<RunEmbedOperationResult> {
    const options = validateOptions(operation, run.options);
    const url = new URL(run.url);
    let match: (EmbedMatch & { provider: string }) | undefined;
    for (const provider of run.providers) {
        const found = provider.match(url);
        if (found !== undefined) {
            match = { ...found, provider: provider.name };
            break;
        }
    }
    if (match === undefined) {
        throw new Error(`No provider recognizes ${run.url}.`);
    }
    const requests: RecordedRequest[] = [];
    const files: RunEmbedOperationResult['files'] = [];
    const progress: number[] = [];
    const limits: EmbedLimits = { maxSize: 2 * 1024 ** 3, maxDuration: 3600, ...run.limits };
    const workdir = await mkdtemp(join(tmpdir(), `eclair-${operation.name}-`));
    const answer = (
        target: string,
        requestOptions: HttpRequestOptions,
    ): FakeResponse | undefined => {
        const { responses } = run;
        if (typeof responses === 'function') {
            return responses(target, requestOptions);
        }
        return responses?.[target] ?? responses?.[target.split('?')[0] ?? target];
    };
    const run_ = operation.run(
        {
            input: { ...match, input: run.url },
            workdir,
            output: (name, path, outputOptions) => files.push({ name, path, ...outputOptions }),
            download: async (target, path, downloadOptions = {}) => {
                const { maxSize: wanted, ...requestOptions } = downloadOptions;
                requests.push({ url: target, ...requestOptions });
                const response = answer(target, requestOptions);
                if (response === undefined) {
                    throw new Error(`No response for ${target}.`);
                }
                if ((response.status ?? 200) !== 200) {
                    throw new OperationError(
                        'provider_failed',
                        `The download answered ${response.status ?? 200}.`,
                    );
                }
                const body = bodyOf(response);
                const size = typeof body === 'string' ? Buffer.byteLength(body) : body.length;
                const maxSize = Math.min(wanted ?? limits.maxSize, limits.maxSize);
                if (size > maxSize) {
                    throw new OperationError(
                        'limit_exceeded',
                        `The file is larger than ${maxSize} bytes.`,
                    );
                }
                await writeFile(path, body);
                progress.push(1);
                return { size, contentType: response.headers?.['content-type'] };
            },
            limits,
            exec: (binary, args, execOptions = {}) => {
                if (
                    !operation.binaries.includes(binary) &&
                    !(operation.optionalBinaries ?? []).includes(binary)
                ) {
                    throw new Error(`${operation.key} runs ${binary} without declaring it.`);
                }
                const options = { cwd: workdir, ...execOptions };
                return run.exec !== undefined
                    ? run.exec(binary, args, options)
                    : execBinary(binary, args, options);
            },
            available: (binary) => Promise.resolve(run.available?.[binary] ?? false),
            credentials: run.credentials,
            http: (target, requestOptions = {}) => {
                requests.push({ url: target, ...requestOptions });
                const response = answer(target, requestOptions);
                if (response === undefined) {
                    return Promise.reject(new Error(`No response for ${target}.`));
                }
                return Promise.resolve(toHttpResponse(response));
            },
            cache: run.cache ?? memoryCache(),
            progress: (ratio) => progress.push(ratio),
            log: { debug: () => {}, info: () => {}, warn: () => {} },
            signal: new AbortController().signal,
        },
        options as never,
    );
    const cleanup = () => rm(workdir, { recursive: true, force: true });
    try {
        const result = await run_;
        return { metadata: result.metadata, requests, files, progress, workdir, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
