import type { Static, TSchema } from 'typebox';

import type { Kind, ProbeMetadata } from '@eclair-js/protocol';

import type { AiProvider } from './ai-providers.ts';
import type { Capability } from './capabilities.ts';
import { matchesMime } from './detect.ts';
import type { EmbedOperationContext, EmbedProvider } from './embeds.ts';
import type { ExecOptions, ExecResult } from './exec.ts';

/** The input of a task, on the worker's disk. */
export interface OperationInput {
    /** Local path of the file. Read it, never write it. */
    path: string;
    kind: Kind;
    mime: string;
    /** Usual extension for the mime type, without the dot. */
    extension: string | undefined;
    size: number;
    /** What `probe` read from the input, when the job has a `probe` task before this one. */
    probe: ProbeMetadata | undefined;
}

export interface OutputOptions {
    mime?: string;
    /** What the file is to the application: `main`, `segment`, `poster`… */
    role?: string;
    /** The ThumbHash placeholder of an image file, in base64, from `thumbhash()`. */
    thumbhash?: string | undefined;
}

/** A capability of AI providers (decision 0008). */
export type ProviderCapability = 'transcription' | 'vision' | 'language';

/**
 * The provider that answers a capability for a task, and its settings from the operator's
 * configuration: `local-whisper` with its models directory, for example.
 */
export interface ProviderSettings {
    name: string;
    settings: Readonly<Record<string, unknown>>;
    /** The project's credentials for the provider, decrypted, for external providers. */
    credentials?: Readonly<Record<string, string>>;
}

export type OperationProviders = Partial<Record<ProviderCapability, ProviderSettings>>;

export interface OperationLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
}

/**
 * What an operation receives besides its options. An operation only uses its context: it doesn't
 * read the environment, the database or another project's data, and doesn't upload files itself
 * (rule 4 of AGENTS.md).
 */
export interface OperationContext {
    input: OperationInput;
    /** A directory for the operation's files. The worker deletes it after the task. */
    workdir: string;
    /**
     * Runs a binary the operation declared in `binaries`, by name (`ffmpeg`). The worker maps the
     * name to the configured path, applies the task's time limit and kills it on cancel.
     */
    exec(
        binary: string,
        args: readonly string[],
        options?: Omit<ExecOptions, 'signal'>,
    ): Promise<ExecResult>;
    /** Reports progress, from 0 to 1. */
    progress(ratio: number): void;
    log: OperationLogger;
    /** Aborted when the task is canceled or times out. */
    signal: AbortSignal;
    /**
     * Declares a file in `workdir` as an output of the task. `name` is its name in the output
     * (`master.m3u8`, `0.jpg`): the worker uploads it under the task's path.
     */
    output(name: string, path: string, options?: OutputOptions): void;
    /**
     * The AI provider of each capability the operation declares in `providers`, as the server
     * picked it from the project's settings and the task's `provider` option (decision 0008).
     */
    providers?: OperationProviders;
    /**
     * The task's id, the same when the task runs again: for names that must not change between
     * attempts, such as a job at an external provider (rule 5).
     */
    taskId?: string;
    /**
     * Asks for the task to run at least `ms` more milliseconds from now, when the operation knows
     * how long it needs (the duration of the audio, the provider). It never shortens the task's
     * time limit, and never extends it past the operator's maximum: it returns `false` when it
     * can't give that much, so that the operation can refuse before it starts a paid job.
     */
    extendTimeout?(ms: number): boolean;
    /** Whether this worker has one of the operation's `optionalBinaries`. */
    available?(binary: string): Promise<boolean>;
    /**
     * Reports what the task has used at a paid provider, as soon as the provider bills it: a job
     * it started, for example. The server counts it in the project's usage and shows it as the
     * task's `usage` whatever the end of the task, a failure, a timeout or a cancel included. A
     * later call replaces it, and so does the result's `usage` when the task succeeds.
     */
    reportUsage?(usage: OperationUsage): void;
}

/**
 * What a task used, for the project's usage and the task's `usage` in the protocol (`TaskUsage`):
 * the seconds of media a paid provider received, and an estimate of its cost.
 */
export interface OperationUsage {
    mediaSeconds?: number;
    cost?: { amount: number; currency: string };
}

export interface OperationResult {
    /** Metadata the operation read or computed. */
    metadata?: Record<string, unknown>;
    /**
     * What the task used, for the project's usage, when the operation knows better than the
     * job's probe: the seconds of media a provider transcribed, for example. The task shows it as
     * its `usage`. A task that may fail after a provider billed it reports it with
     * `context.reportUsage()` too.
     */
    usage?: OperationUsage;
}

/** A JSON Schema object, for plugins that don't use TypeBox. Options are then untyped. */
export type JsonSchemaObject = { type: 'object' } & Record<string, unknown>;

type OptionsOf<S> = S extends TSchema ? Static<S> : Record<string, unknown>;

/** Inputs an operation can read. */
export interface OperationAccepts {
    kinds?: Kind[];
    mimes?: string[];
    /** Reads embed inputs, never files: `defineEmbedOperation()` sets it (decision 0022). */
    embeds?: boolean;
}

interface OperationBase<S extends TSchema | JsonSchemaObject> {
    /** `<domain>.<action>` (`image.palette`), or `probe`. */
    name: string;
    /** Major version. A change that breaks clients is a new version, and the old one stays. */
    version: number;
    description: string;
    /** The queue it runs on. */
    capability: Capability;
    /** Binaries it calls through `context.exec()`. */
    binaries: string[];
    /**
     * Binaries it can do without, such as yt-dlp for embeds: it asks `context.available()` before
     * running one. `eclair doctor` reports them without a warning.
     */
    optionalBinaries?: string[];
    /** JSON Schema of the options, written with TypeBox or by hand. Objects refuse unknown properties. */
    options: S;
    /**
     * The capability of AI providers it calls (decision 0008). The server then picks the provider
     * of each task from the project's settings, or the task's `provider` option when the project
     * allows it, and gives it in `context.providers`.
     */
    providers?: ProviderCapability;
    /**
     * The queue of its tasks whose AI provider is external, when it isn't `capability`: a task
     * that only waits on a hosted API (`network`) doesn't hold a slot of the `ai` queue.
     */
    externalQueue?: Capability;
    outputs: { files: boolean; metadata: boolean };
}

/** An operation that reads files. */
export interface OperationDefinition<
    S extends TSchema | JsonSchemaObject = TSchema | JsonSchemaObject,
> extends OperationBase<S> {
    /** Inputs it can read. Other inputs are refused before anything runs. Every file when empty. */
    accepts: { kinds?: Kind[]; mimes?: string[] };
    run(context: OperationContext, options: OptionsOf<S>): Promise<OperationResult>;
}

/** An operation that reads embeds: a video or audio on a platform, by its page (decision 0022). */
export interface EmbedOperationDefinition<
    S extends TSchema | JsonSchemaObject = TSchema | JsonSchemaObject,
> extends OperationBase<S> {
    /**
     * Whether it downloads the embed's file. The project must then allow the provider in its
     * `embedDownload`: the server refuses the task otherwise (decision 0022).
     */
    downloads?: boolean;
    run(context: EmbedOperationContext, options: OptionsOf<S>): Promise<OperationResult>;
}

/** An operation that reads files, as the server registers it. */
export type FileOperation = Omit<OperationDefinition, 'accepts'> & {
    readonly key: string;
    readonly accepts: OperationAccepts & { embeds?: false };
};

/** An operation that reads embeds, as the server registers it. */
export type EmbedOperation = EmbedOperationDefinition & {
    readonly key: string;
    readonly accepts: OperationAccepts & { embeds: true };
};

/** An operation as the server registers it. */
export type Operation = FileOperation | EmbedOperation;

const NAME_PATTERN = /^(probe|[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*)$/;

function checkDefinition(definition: { name: string; version: number }): void {
    if (!NAME_PATTERN.test(definition.name)) {
        throw new TypeError(
            `"${definition.name}" is not an operation name: use <domain>.<action>.`,
        );
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
        throw new TypeError(`${definition.name}: the version must be an integer from 1.`);
    }
}

/**
 * Defines an operation that reads files. Checks its name and version, so a broken plugin fails when
 * it loads rather than when a task runs.
 */
export function defineOperation<S extends TSchema | JsonSchemaObject>(
    definition: OperationDefinition<S>,
): FileOperation {
    checkDefinition(definition);
    return Object.freeze({
        ...(definition as unknown as OperationDefinition),
        key: `${definition.name}@${definition.version}`,
    }) as FileOperation;
}

/** Defines an operation that reads embeds instead of files (decision 0022). */
export function defineEmbedOperation<S extends TSchema | JsonSchemaObject>(
    definition: EmbedOperationDefinition<S>,
): EmbedOperation {
    checkDefinition(definition);
    return Object.freeze({
        ...(definition as unknown as EmbedOperationDefinition),
        accepts: { embeds: true as const },
        key: `${definition.name}@${definition.version}`,
    });
}

/** Whether an operation reads embeds rather than files. */
export function isEmbedOperation(operation: Pick<Operation, 'accepts'>): boolean {
    return operation.accepts.embeds === true;
}

/** Whether an operation can read an input of this kind and mime type. */
export function acceptsInput(
    operation: Pick<Operation, 'accepts'>,
    input: { kind: Kind; mime: string },
): boolean {
    const { kinds, mimes, embeds } = operation.accepts;
    if (embeds === true) {
        return false;
    }
    if (kinds !== undefined && kinds.length > 0 && !kinds.includes(input.kind)) {
        return false;
    }
    if (
        mimes !== undefined &&
        mimes.length > 0 &&
        !mimes.some((pattern) => matchesMime(pattern, input.mime))
    ) {
        return false;
    }
    return true;
}

/**
 * What a plugin package exports: a list of operations, or an object with them and the embed
 * providers they read (decision 0022).
 */
export type OperationPlugin =
    | readonly Operation[]
    | {
          operations: readonly Operation[];
          embedProviders?: readonly EmbedProvider[];
          aiProviders?: readonly AiProvider[];
      };
