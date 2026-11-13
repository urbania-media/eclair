import type { TSchema } from 'typebox';

import type { ExecOptions, ExecResult } from './exec.ts';
import type { JsonSchemaObject, OperationLogger, OutputOptions } from './operation.ts';

/** An embed that a provider recognized in a page URL. */
export interface EmbedMatch {
    /** The video's or audio's id at the provider. */
    id: string;
    /** The canonical URL of its page. */
    url: string;
}

/**
 * A platform whose pages can be embed inputs (decision 0022). The server only uses `name`,
 * `match()` and `credentials`: to check inputs, find the provider of a task, and check the
 * credentials that operators set. The operations of the plugin do the rest.
 */
export interface EmbedProviderDefinition {
    /** `youtube`, `vimeo`: lowercase letters, digits and `-`. */
    name: string;
    /** The platform's name, for people: `YouTube`. */
    title: string;
    /**
     * Recognizes a page of the provider and reads the id from it, without any request: Eclair
     * never requests the URL it is given. `undefined` for any other URL.
     */
    match(url: URL): EmbedMatch | undefined;
    /** JSON Schema of the provider's credentials (`{ apiKey }`), when it takes any. */
    credentials?: TSchema | JsonSchemaObject;
}

export type EmbedProvider = Readonly<EmbedProviderDefinition>;

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Defines an embed provider. Checks its name, so a broken plugin fails when it loads. */
export function defineEmbedProvider(definition: EmbedProviderDefinition): EmbedProvider {
    if (!PROVIDER_PATTERN.test(definition.name)) {
        throw new TypeError(
            `"${definition.name}" is not a provider name: use lowercase letters, digits and -.`,
        );
    }
    return Object.freeze({ ...definition });
}

/** The embed a task reads: its URL and what its provider recognized. */
export interface OperationEmbed extends EmbedMatch {
    /** The URL as the job gave it. */
    input: string;
    /** The provider's name. */
    provider: string;
}

export interface HttpRequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    /** A `POST` body, sent as it is. */
    body?: string;
    /** Milliseconds for the whole request. 10 seconds by default. */
    timeout?: number;
}

export interface HttpResponse {
    status: number;
    /** Header names in lowercase. */
    headers: Record<string, string>;
    /** The body, at most 2 MB. */
    text(): Promise<string>;
    json(): Promise<unknown>;
}

/**
 * A cache for the operation's results, scoped by the server to the project and the operation
 * (rule 3 of AGENTS.md). Values are JSON. A cache that fails reads as empty.
 */
export interface OperationCache {
    get(key: string): Promise<unknown>;
    /** `ttl` in seconds. */
    set(key: string, value: unknown, ttl: number): Promise<void>;
}

export interface DownloadOptions extends Omit<HttpRequestOptions, 'method' | 'body'> {
    /** Bytes. At most the task's `limits.maxSize`, which applies without it. */
    maxSize?: number;
}

export interface DownloadResult {
    /** Bytes written. */
    size: number;
    /** The `content-type` the server announced, never trusted: detect the file's type. */
    contentType: string | undefined;
}

/** What an embed operation may download, from the project's settings and the server's. */
export interface EmbedLimits {
    /** Bytes: the project's `maxInputSize`, or `ECLAIR_MAX_INPUT_SIZE`. */
    maxSize: number;
    /** Seconds: the project's `embedMaxDuration`, or `ECLAIR_EMBED_MAX_DURATION`. */
    maxDuration: number;
}

/** What an embed operation receives besides its options. */
export interface EmbedOperationContext {
    input: OperationEmbed;
    /** A directory for the operation's files. The worker deletes it after the task. */
    workdir: string;
    /**
     * Declares a file in `workdir` as an output of the task (`video.mp4`): the worker uploads it under
     * the task's path, and other tasks read it with `from`.
     */
    output(name: string, path: string, options?: OutputOptions): void;
    /**
     * Downloads a file to `path`, in `workdir`, through the SSRF guard like `http()`, with redirects
     * checked, up to `limits.maxSize`, and reports its progress when the size is announced.
     */
    download(url: string, path: string, options?: DownloadOptions): Promise<DownloadResult>;
    limits: EmbedLimits;
    /**
     * Runs a binary the operation declared in `binaries` or `optionalBinaries`, by name, with the
     * task's time limit, killed on cancel. The binary inherits the worker's proxy variables
     * (`HTTPS_PROXY`…), which can restrict its network.
     */
    exec(
        binary: string,
        args: readonly string[],
        options?: Omit<ExecOptions, 'signal'>,
    ): Promise<ExecResult>;
    /** Whether a binary runs on this worker, for `optionalBinaries`. */
    available(binary: string): Promise<boolean>;
    /**
     * The credentials of the input's provider: the project's, or else the operator's
     * (`ECLAIR_PROVIDER_<PROVIDER>_<KEY>`). `undefined` when neither has any.
     */
    credentials: Readonly<Record<string, string>> | undefined;
    /**
     * Sends a request to a provider, through the server's SSRF guard: `https` only, public
     * addresses only, redirects checked. The operation never requests the input's URL itself.
     */
    http(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
    cache: OperationCache;
    /** Reports progress, from 0 to 1. */
    progress(ratio: number): void;
    log: OperationLogger;
    /** Aborted when the task is canceled or times out. */
    signal: AbortSignal;
}
