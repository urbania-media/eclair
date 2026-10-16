import type { Problem } from '@eclair-js/protocol';

/**
 * An answer of the API that isn't a success. `problem` is its problem details (RFC 9457), with the
 * validation `errors` by JSON pointer for a 422.
 */
export class EclairError extends Error {
    readonly status: number;
    readonly problem: Problem;
    /** Seconds to wait, for a 429. */
    readonly retryAfter: number | undefined;

    constructor(status: number, problem: Problem, retryAfter?: number) {
        super(problem.detail ?? problem.title);
        this.name = 'EclairError';
        this.status = status;
        this.problem = problem;
        this.retryAfter = retryAfter;
    }
}
