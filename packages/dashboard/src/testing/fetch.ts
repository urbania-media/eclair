import { type SchemaName, validate } from '@eclair-js/protocol';

/** A request the mocked fetch received. */
export interface RecordedRequest {
    method: string;
    url: URL;
    headers: Headers;
    body: unknown;
    credentials: RequestCredentials | undefined;
}

export type Route = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * A `fetch` that answers from routes keyed by `METHOD /path` (without the query), and records the
 * requests. An unknown route answers `404` as problem details, as the server does.
 */
export function mockFetch(routes: Record<string, Route>) {
    const requests: RecordedRequest[] = [];
    const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(String(input), 'http://eclair.test');
        const request: RecordedRequest = {
            method: init.method ?? 'GET',
            url,
            headers: new Headers(init.headers),
            body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
            credentials: init.credentials,
        };
        requests.push(request);
        const route = routes[`${request.method} ${url.pathname}`];
        return route !== undefined
            ? route(request)
            : problem(404, 'Not Found', { detail: `No route ${request.method} ${url.pathname}.` });
    };
    return { fetch: fetch as typeof globalThis.fetch, requests };
}

/**
 * A JSON response, whose body is checked against a schema of the OpenAPI document first: the
 * tests answer what the server answers.
 */
export function json(
    body: unknown,
    { status = 200, schema }: { status?: number; schema?: SchemaName } = {},
) {
    if (schema !== undefined) {
        const result = validate(schema, body);
        if (!result.valid) {
            throw new Error(
                `The fixture isn't a ${schema}: ${result.errors.map((error) => `${error.pointer} ${error.message}`).join(', ')}`,
            );
        }
    }
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** An error response as `application/problem+json`. */
export function problem(
    status: number,
    title: string,
    extra: {
        detail?: string;
        errors?: Record<string, string[]>;
        headers?: Record<string, string>;
    } = {},
) {
    const { headers = {}, ...rest } = extra;
    return new Response(JSON.stringify({ type: 'about:blank', title, status, ...rest }), {
        status,
        headers: { 'Content-Type': 'application/problem+json', ...headers },
    });
}

/** A `Storage` in memory. */
export class MemoryStorage implements Storage {
    private items = new Map<string, string>();
    get length() {
        return this.items.size;
    }
    clear() {
        this.items.clear();
    }
    getItem(key: string) {
        return this.items.get(key) ?? null;
    }
    key(index: number) {
        return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.items.delete(key);
    }
    setItem(key: string, value: string) {
        this.items.set(key, value);
    }
}
