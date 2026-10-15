import { STATUS_CODES } from 'node:http';

import type { Problem } from '@eclair-js/protocol';

export interface ProblemOptions {
    detail?: string;
    /** URI of the problem type. Defaults to `about:blank`. */
    type?: string;
    /** Validation errors: messages by JSON pointer. */
    errors?: Record<string, string[]>;
    /** Extra response headers, such as `Retry-After`. */
    headers?: Record<string, string>;
}

/**
 * An error that the API answers as `application/problem+json` (RFC 9457). Throw it from a route:
 * the error handler sends it as is. Its detail is shown to the client, so it never contains a
 * secret.
 */
export class HttpProblem extends Error {
    readonly status: number;
    readonly title: string;
    readonly detail: string | undefined;
    readonly type: string | undefined;
    readonly errors: Record<string, string[]> | undefined;
    readonly headers: Record<string, string>;

    constructor(status: number, title?: string, options: ProblemOptions = {}) {
        const resolvedTitle = title ?? STATUS_CODES[status] ?? 'Error';
        super(options.detail ?? resolvedTitle);
        this.name = 'HttpProblem';
        this.status = status;
        this.title = resolvedTitle;
        this.detail = options.detail;
        this.type = options.type;
        this.errors = options.errors;
        this.headers = options.headers ?? {};
    }

    toJSON(): Problem {
        return {
            type: this.type ?? 'about:blank',
            title: this.title,
            status: this.status,
            ...(this.detail === undefined ? {} : { detail: this.detail }),
            ...(this.errors === undefined ? {} : { errors: this.errors }),
        };
    }
}

export const problems = {
    unauthorized: (detail?: string) => new HttpProblem(401, 'Unauthorized', { detail }),
    forbidden: (detail?: string) => new HttpProblem(403, 'Forbidden', { detail }),
    notFound: (detail?: string) => new HttpProblem(404, 'Not Found', { detail }),
    conflict: (detail?: string) => new HttpProblem(409, 'Conflict', { detail }),
    invalid: (errors: Record<string, string[]>, detail = 'The request is invalid.') =>
        new HttpProblem(422, 'Unprocessable Content', { detail, errors }),
    tooManyRequests: (retryAfterSeconds: number, detail?: string) =>
        new HttpProblem(429, 'Too Many Requests', {
            detail,
            headers: { 'retry-after': String(Math.max(0, Math.ceil(retryAfterSeconds))) },
        }),
};
