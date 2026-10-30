/**
 * When a running task sends a `task.progress` webhook (decision 0019): at most once per
 * interval, counted from the start of the task, and only when its progress changed. A task that
 * ends within the interval sends none.
 */
export class ProgressThrottle {
    readonly #interval: number;
    readonly #now: () => number;
    #sentAt: number;
    #sent: number | undefined;

    constructor(interval: number, now: () => number = Date.now) {
        this.#interval = interval;
        this.#now = now;
        this.#sentAt = now();
    }

    /** Whether this progress goes out. Records it when it does. */
    accept(progress: number): boolean {
        const now = this.#now();
        if (progress === this.#sent || now - this.#sentAt < this.#interval) {
            return false;
        }
        this.#sentAt = now;
        this.#sent = progress;
        return true;
    }
}
