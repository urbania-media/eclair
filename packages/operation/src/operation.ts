import type { Static, TSchema } from 'typebox';

import type { Kind, ProbeMetadata } from '@eclair-js/protocol';

import type { Capability } from './capabilities.ts';
import { matchesMime } from './detect.ts';
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
}

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
}

export interface OperationResult {
    /** Metadata the operation read or computed. */
    metadata?: Record<string, unknown>;
}

/** A JSON Schema object, for plugins that don't use TypeBox. Options are then untyped. */
export type JsonSchemaObject = { type: 'object' } & Record<string, unknown>;

type OptionsOf<S> = S extends TSchema ? Static<S> : Record<string, unknown>;

export interface OperationDefinition<
    S extends TSchema | JsonSchemaObject = TSchema | JsonSchemaObject,
> {
    /** `<domain>.<action>` (`image.palette`), or `probe`. */
    name: string;
    /** Major version. A change that breaks clients is a new version, and the old one stays. */
    version: number;
    description: string;
    /** Inputs it can read. Other inputs are refused before anything runs. Every input when empty. */
    accepts: { kinds?: Kind[]; mimes?: string[] };
    /** The queue it runs on. */
    capability: Capability;
    /** Binaries it calls through `context.exec()`. */
    binaries: string[];
    /** JSON Schema of the options, written with TypeBox or by hand. Objects refuse unknown properties. */
    options: S;
    outputs: { files: boolean; metadata: boolean };
    run(context: OperationContext, options: OptionsOf<S>): Promise<OperationResult>;
}

/** An operation as the server registers it. */
export type Operation = OperationDefinition & { readonly key: string };

const NAME_PATTERN = /^(probe|[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*)$/;

/**
 * Defines an operation. Checks its name and version, so a broken plugin fails when it loads rather
 * than when a task runs.
 */
export function defineOperation<S extends TSchema | JsonSchemaObject>(
    definition: OperationDefinition<S>,
): Operation {
    if (!NAME_PATTERN.test(definition.name)) {
        throw new TypeError(
            `"${definition.name}" is not an operation name: use <domain>.<action>.`,
        );
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
        throw new TypeError(`${definition.name}: the version must be an integer from 1.`);
    }
    return Object.freeze({
        ...(definition as unknown as OperationDefinition),
        key: `${definition.name}@${definition.version}`,
    });
}

/** Whether an operation can read an input of this kind and mime type. */
export function acceptsInput(
    operation: Pick<Operation, 'accepts'>,
    input: { kind: Kind; mime: string },
): boolean {
    const { kinds, mimes } = operation.accepts;
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

/** What a plugin package exports: a list of operations, or an object with one. */
export type OperationPlugin = readonly Operation[] | { operations: readonly Operation[] };
