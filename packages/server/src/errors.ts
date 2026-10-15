/** Something the request names doesn't exist. Its message can be shown to the client. */
export class NotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
    }
}

/** The request conflicts with the current state: a name is taken, a job already ended… */
export class ConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConflictError';
    }
}

/** A project reached one of its limits. The client can try again after `retryAfter` seconds. */
export class RateLimitedError extends Error {
    readonly retryAfter: number;

    constructor(message: string, retryAfter: number) {
        super(message);
        this.name = 'RateLimitedError';
        this.retryAfter = retryAfter;
    }
}
