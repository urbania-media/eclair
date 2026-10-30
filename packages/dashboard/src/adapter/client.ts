import { UnauthorizedError, createApiError, readProblem, readRetryAfter } from '@panneau/data';
import type { Problem } from '@panneau/protocol';

export interface RequestInit {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    signal?: AbortSignal | undefined;
    /** Sends this token instead of the stored one: to check a token before keeping it. */
    token?: string;
}

/** Calls the admin API with the admin token as a bearer token. */
export interface AdminClient {
    request<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AdminClientOptions {
    /** The URL of the admin API: `/admin/v1` on the same origin. */
    baseUrl: string;
    getToken: () => string | null;
    fetch?: typeof globalThis.fetch;
}

/**
 * The dot path of a JSON pointer (`/settings/concurrency` is `settings.concurrency`): Eclair keys
 * validation errors by JSON pointer, Panneau's forms by dot path. The empty pointer, the body
 * itself, stays empty.
 */
export function pointerToPath(pointer: string): string {
    return pointer
        .split('/')
        .slice(1)
        .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
        .join('.');
}

function problemFor(status: number, title: string, detail?: string): Problem {
    return { type: 'about:blank', title, status, ...(detail !== undefined ? { detail } : {}) };
}

export function unauthorized(): UnauthorizedError {
    return new UnauthorizedError(problemFor(401, 'Unauthorized'));
}

export function notFound(detail: string) {
    return createApiError(problemFor(404, 'Not Found', detail));
}

export function createAdminClient({
    baseUrl,
    getToken,
    fetch = globalThis.fetch,
}: AdminClientOptions): AdminClient {
    const base = baseUrl.replace(/\/+$/, '');
    return {
        async request<T>(path: string, init: RequestInit = {}): Promise<T> {
            const token = init.token ?? getToken();
            if (token === null || token === '') {
                throw unauthorized();
            }
            const params = new URLSearchParams();
            Object.entries(init.query ?? {}).forEach(([key, value]) => {
                if (value !== undefined) {
                    params.set(key, String(value));
                }
            });
            const search = params.size > 0 ? `?${params.toString()}` : '';
            const headers: Record<string, string> = {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            };
            if (init.body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }
            const response = await fetch(`${base}${path}${search}`, {
                method: init.method ?? 'GET',
                headers,
                body: init.body !== undefined ? JSON.stringify(init.body) : null,
                signal: init.signal ?? null,
                // The token is never a cookie (decision 0021)
                credentials: 'omit',
            });
            if (!response.ok) {
                const problem = await readProblem(response);
                if (problem.errors !== undefined) {
                    problem.errors = Object.fromEntries(
                        Object.entries(problem.errors).map(([pointer, messages]) => [
                            pointerToPath(pointer),
                            messages,
                        ]),
                    );
                }
                throw createApiError(problem, { retryAfter: readRetryAfter(response) });
            }
            if (response.status === 204) {
                return undefined as T;
            }
            return (await response.json()) as T;
        },
    };
}
