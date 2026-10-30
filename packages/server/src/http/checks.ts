import type { FastifyBaseLogger } from 'fastify';

/** A dependency that `/ready` checks: the database, Redis, the binaries… */
export interface ReadinessCheck {
    name: string;
    /** Resolves when the dependency works, rejects with a message that says what's wrong. */
    check(): Promise<void>;
}

function withTimeout(promise: Promise<void>, milliseconds: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`no answer after ${milliseconds} ms`)),
            milliseconds,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs the checks of `/ready` at once: `ok` or `failed` by name, the reasons in the logs only. */
export async function runChecks(
    checks: readonly ReadinessCheck[],
    timeout: number,
    log: FastifyBaseLogger,
): Promise<{ ready: boolean; checks: Record<string, 'ok' | 'failed'> }> {
    const results = await Promise.all(
        checks.map(async ({ name, check }) => {
            try {
                await withTimeout(check(), timeout);
                return [name, 'ok'] as const;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // The reason goes to the logs only: it can name hosts or paths.
                log.warn({ check: name, error: message }, 'Readiness check failed');
                return [name, 'failed'] as const;
            }
        }),
    );
    return {
        ready: results.every(([, result]) => result === 'ok'),
        checks: Object.fromEntries(results),
    };
}
