import type {
    Input,
    Job,
    JobEvent,
    JobFileList,
    JobList,
    JobRequest,
    JobStatus,
    OperationList,
    Preset,
    PresetList,
    PresetRequest,
    ProbeMetadata,
    Problem,
    Upload,
} from '@eclair-js/protocol';

import { EclairError } from './errors.ts';
import { readEvents } from './sse.ts';
import { apiUrl } from './url.ts';

export interface EclairClientOptions {
    /** The API's base URL: `https://eclair.example.com`. */
    url: string;
    /** A project's API key: `ek_…`. */
    key: string;
    /** `fetch`, replaceable (tests, a proxy). The global one by default. */
    fetch?: typeof fetch;
}

export interface ListJobsOptions {
    status?: JobStatus[];
    createdAfter?: Date | string;
    /** Top-level values of the job's `metadata`, compared as strings. */
    metadata?: Record<string, string | number>;
    cursor?: string;
    limit?: number;
}

/** A file to send: its bytes, as a `Blob`, a `Uint8Array` or a stream. */
export type FileBody = Blob | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>;

export type ProbeResponse =
    { status: 'completed'; metadata: ProbeMetadata } | { status: 'pending'; job: Job };

const TUS_VERSION = '1.0.0';

/** What `fetch` takes as a body. */
type RequestBody = NonNullable<RequestInit['body']>;

interface RequestOptions {
    json?: unknown;
    body?: RequestBody;
    headers?: Record<string, string>;
}

function query(values: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(values)) {
        if (value !== undefined) {
            search.set(name, String(value));
        }
    }
    const text = search.toString();
    return text === '' ? '' : `?${text}`;
}

/**
 * The client of Eclair's `/v1` API (see the protocol), for Node and browsers. Every method
 * throws an `EclairError` when the API answers with an error.
 */
export class EclairClient {
    readonly #url: string;
    readonly #key: string;
    readonly #fetch: typeof fetch;

    constructor(options: EclairClientOptions) {
        this.#url = options.url;
        this.#key = options.key;
        this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    }

    async #request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
        const headers: Record<string, string> = {
            authorization: `Bearer ${this.#key}`,
            accept: 'application/json',
            ...options.headers,
        };
        let body = options.body;
        if (options.json !== undefined) {
            headers['content-type'] = 'application/json';
            body = JSON.stringify(options.json);
        }
        const response = await this.#fetch(apiUrl(this.#url, path), {
            method,
            headers,
            ...(body === undefined ? {} : { body }),
            // A stream body needs half-duplex in fetch.
            ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
        } as RequestInit);
        if (!response.ok) {
            throw await this.#error(response);
        }
        return response;
    }

    async #error(response: Response): Promise<EclairError> {
        let problem: Problem;
        try {
            problem = (await response.json()) as Problem;
        } catch {
            problem = {
                type: 'about:blank',
                title: response.statusText || 'Error',
                status: response.status,
            };
        }
        const retryAfter = response.headers.get('retry-after');
        return new EclairError(
            response.status,
            problem,
            retryAfter === null ? undefined : Number(retryAfter),
        );
    }

    async #json<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
        const response = await this.#request(method, path, options);
        return (await response.json()) as T;
    }

    /** Jobs: run a pipeline of operations on one input. */
    readonly jobs = {
        /**
         * Creates a job. With an `idempotencyKey`, a retry of the same request returns the first
         * job, so it's safe to retry after a network error.
         */
        create: (request: JobRequest, options: { idempotencyKey?: string } = {}): Promise<Job> =>
            this.#json('POST', '/jobs', {
                json: request,
                ...(options.idempotencyKey === undefined
                    ? {}
                    : { headers: { 'idempotency-key': options.idempotencyKey } }),
            }),

        get: (id: string): Promise<Job> => this.#json('GET', `/jobs/${encodeURIComponent(id)}`),

        list: (options: ListJobsOptions = {}): Promise<JobList> => {
            const search = new URLSearchParams();
            if (options.status !== undefined && options.status.length > 0) {
                search.set('status', options.status.join(','));
            }
            if (options.createdAfter !== undefined) {
                search.set(
                    'createdAfter',
                    options.createdAfter instanceof Date
                        ? options.createdAfter.toISOString()
                        : options.createdAfter,
                );
            }
            for (const [key, value] of Object.entries(options.metadata ?? {})) {
                search.set(`metadata[${key}]`, String(value));
            }
            if (options.cursor !== undefined) {
                search.set('cursor', options.cursor);
            }
            if (options.limit !== undefined) {
                search.set('limit', String(options.limit));
            }
            const text = search.toString();
            return this.#json('GET', `/jobs${text === '' ? '' : `?${text}`}`);
        },

        /** Every page of `list()`, as one iterator. */
        all: (options: Omit<ListJobsOptions, 'cursor'> = {}): AsyncIterable<Job> => {
            const list = this.jobs.list;
            return {
                async *[Symbol.asyncIterator]() {
                    let cursor: string | undefined;
                    do {
                        const page = await list({
                            ...options,
                            ...(cursor === undefined ? {} : { cursor }),
                        });
                        yield* page.data;
                        cursor = page.nextCursor ?? undefined;
                    } while (cursor !== undefined);
                },
            };
        },

        cancel: (id: string): Promise<Job> =>
            this.#json('POST', `/jobs/${encodeURIComponent(id)}/cancel`),

        retry: (id: string): Promise<Job> =>
            this.#json('POST', `/jobs/${encodeURIComponent(id)}/retry`),

        files: (
            id: string,
            options: { task?: string; cursor?: string; limit?: number } = {},
        ): Promise<JobFileList> =>
            this.#json('GET', `/jobs/${encodeURIComponent(id)}/files${query(options)}`),

        /** The job's status and progress changes, until it ends. */
        events: (id: string): AsyncGenerator<JobEvent> => this.events(id),

        /** Waits for a job to end, following its events, and returns it. */
        wait: async (id: string): Promise<Job> => {
            for await (const event of this.events(id)) {
                if (
                    event.type === 'job.status' &&
                    ['completed', 'failed', 'canceled'].includes(event.status ?? '')
                ) {
                    break;
                }
            }
            return this.jobs.get(id);
        },
    };

    /** The status and progress changes of a job, until it ends. */
    async *events(id: string): AsyncGenerator<JobEvent> {
        const response = await this.#request('GET', `/jobs/${encodeURIComponent(id)}/events`, {
            headers: { accept: 'text/event-stream' },
        });
        if (response.body === null) {
            return;
        }
        for await (const event of readEvents(response.body)) {
            yield JSON.parse(event.data) as JobEvent;
        }
    }

    /**
     * The metadata of a file, in the response (decision 0012): an input, or the file itself. When
     * Eclair takes longer than `timeout` seconds, the result is the job to follow.
     */
    async probe(
        input: Input | FileBody,
        options: { timeout?: number; checksum?: boolean } = {},
    ): Promise<ProbeResponse> {
        const isInput =
            typeof input === 'object' &&
            !(input instanceof Blob) &&
            !(input instanceof Uint8Array) &&
            !(input instanceof ArrayBuffer) &&
            !(input instanceof ReadableStream);
        const response = isInput
            ? await this.#request('POST', '/probe', {
                  json: {
                      input,
                      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
                      ...(options.checksum === undefined ? {} : { checksum: options.checksum }),
                  },
              })
            : await this.#request(
                  'POST',
                  `/probe${query({ timeout: options.timeout, checksum: options.checksum === undefined ? undefined : String(options.checksum) })}`,
                  {
                      body: input as RequestBody,
                      headers: { 'content-type': 'application/octet-stream' },
                  },
              );
        if (response.status === 202) {
            return { status: 'pending', job: (await response.json()) as Job };
        }
        const { metadata } = (await response.json()) as { metadata: ProbeMetadata };
        return { status: 'completed', metadata };
    }

    /** Uploads: files sent to Eclair's temporary storage, then used as job inputs. */
    readonly uploads = {
        /** Sends a file at once, within the project's direct upload limit. `probe` adds its metadata. */
        create: (file: FileBody, options: { probe?: boolean } = {}): Promise<Upload> =>
            this.#json('POST', `/uploads${options.probe === true ? '?probe=1' : ''}`, {
                body: file as RequestBody,
                headers: { 'content-type': 'application/octet-stream' },
            }),

        /**
         * Sends a large file in parts, resumable with tus. `onProgress` gets the bytes sent. Resume
         * an interrupted upload with its `id`.
         */
        createResumable: async (
            file: Blob | Uint8Array,
            options: {
                chunkSize?: number;
                id?: string;
                onProgress?: (sent: number, total: number) => void;
            } = {},
        ): Promise<Upload> => {
            const blob = file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>]);
            const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
            let id = options.id;
            let offset = 0;
            if (id === undefined) {
                const created = await this.#json<Upload>('POST', '/uploads', {
                    headers: { 'tus-resumable': TUS_VERSION, 'upload-length': String(blob.size) },
                });
                id = created.id;
            } else {
                const head = await this.#request('HEAD', `/uploads/${encodeURIComponent(id)}`, {
                    headers: { 'tus-resumable': TUS_VERSION },
                });
                offset = Number(head.headers.get('upload-offset') ?? 0);
            }
            while (offset < blob.size) {
                const chunk = blob.slice(offset, offset + chunkSize);
                const response = await this.#request(
                    'PATCH',
                    `/uploads/${encodeURIComponent(id)}`,
                    {
                        body: chunk,
                        headers: {
                            'tus-resumable': TUS_VERSION,
                            'content-type': 'application/offset+octet-stream',
                            'upload-offset': String(offset),
                        },
                    },
                );
                offset = Number(response.headers.get('upload-offset') ?? offset + chunk.size);
                options.onProgress?.(offset, blob.size);
            }
            return this.uploads.get(id);
        },

        get: (id: string): Promise<Upload> =>
            this.#json('GET', `/uploads/${encodeURIComponent(id)}`),

        delete: async (id: string): Promise<void> => {
            await this.#request('DELETE', `/uploads/${encodeURIComponent(id)}`);
        },
    };

    /** Presets: the project's own, and the global ones. */
    readonly presets = {
        list: (): Promise<PresetList> => this.#json('GET', '/presets'),
        get: (name: string): Promise<Preset> =>
            this.#json('GET', `/presets/${encodeURIComponent(name)}`),
        put: (name: string, preset: PresetRequest): Promise<Preset> =>
            this.#json('PUT', `/presets/${encodeURIComponent(name)}`, { json: preset }),
        delete: async (name: string): Promise<void> => {
            await this.#request('DELETE', `/presets/${encodeURIComponent(name)}`);
        },
    };

    /** The operations this server provides and the project may use, with their options schema. */
    operations(): Promise<OperationList> {
        return this.#json('GET', '/operations');
    }
}
