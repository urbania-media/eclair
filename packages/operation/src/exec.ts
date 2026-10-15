import { spawn } from 'node:child_process';

import { OperationError } from './errors.ts';

export interface ExecOptions {
    /** Milliseconds before the process is killed and the call fails with `timeout`. */
    timeout?: number;
    /** Cancels the run: the process is killed. */
    signal?: AbortSignal;
    cwd?: string;
    /** Bytes kept from stdout and from stderr. More fails the call with `limit_exceeded`. */
    maxOutput?: number;
    /** Extra environment variables. The process doesn't inherit secrets: see `execBinary`. */
    env?: Record<string, string>;
    /** Written to stdin, then stdin is closed. */
    input?: string | Buffer;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
}

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;

/** Variables a binary needs from the worker's environment. Everything else is left out. */
const INHERITED_VARIABLES = [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'MAGICK_TEMPORARY_PATH',
    'GS_OPTIONS',
    'TZ',
];

function baseEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of INHERITED_VARIABLES) {
        const value = process.env[name];
        if (value !== undefined) {
            env[name] = value;
        }
    }
    return env;
}

/** The last lines of stderr, to explain a failure without flooding the logs. */
function tail(text: string, lines = 5): string {
    return text.trim().split('\n').slice(-lines).join('\n');
}

/**
 * Runs a binary with an argument array, never through a shell, and resolves with its output. It
 * gets a minimal environment, so `DATABASE_URL` and the secret key never reach it. Fails with an
 * `OperationError`: `timeout` after `timeout`, `limit_exceeded` when the output is too large,
 * `operation_failed` when it exits with an error or can't start.
 */
export function execBinary(
    path: string,
    args: readonly string[],
    options: ExecOptions = {},
): Promise<ExecResult> {
    const maxOutput = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
    const name = path.split('/').pop() ?? path;

    return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
            reject(new OperationError('operation_failed', `${name} was canceled.`));
            return;
        }

        const child = spawn(path, args, {
            cwd: options.cwd,
            env: { ...baseEnvironment(), ...options.env },
            stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutSize = 0;
        let stderrSize = 0;
        let failure: OperationError | undefined;
        let settled = false;

        const kill = (error: OperationError) => {
            failure ??= error;
            child.kill('SIGKILL');
        };

        const timer =
            options.timeout === undefined
                ? undefined
                : setTimeout(
                      () =>
                          kill(
                              new OperationError(
                                  'timeout',
                                  `${name} took longer than ${options.timeout} ms.`,
                              ),
                          ),
                      options.timeout,
                  );
        const onAbort = () => kill(new OperationError('operation_failed', `${name} was canceled.`));
        options.signal?.addEventListener('abort', onAbort, { once: true });

        const finish = (error: Error | undefined, result?: ExecResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            if (error === undefined && result !== undefined) {
                resolve(result);
            } else {
                reject(error);
            }
        };

        child.stdout?.on('data', (chunk: Buffer) => {
            stdoutSize += chunk.length;
            if (stdoutSize > maxOutput) {
                kill(
                    new OperationError(
                        'limit_exceeded',
                        `${name} wrote more than ${maxOutput} bytes.`,
                    ),
                );
            } else {
                stdout.push(chunk);
            }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderrSize += chunk.length;
            // Keep the end of stderr: that's where errors are.
            stderr.push(chunk);
            while (stderrSize > maxOutput && stderr.length > 1) {
                stderrSize -= stderr.shift()?.length ?? 0;
            }
        });

        child.on('error', (error) => {
            finish(
                new OperationError('operation_failed', `${name} could not start.`, {
                    cause: error,
                }),
            );
        });

        child.on('close', (code, signal) => {
            const result = {
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
            };
            if (failure !== undefined) {
                finish(failure);
            } else if (code !== 0) {
                const reason = signal === null ? `exited with ${code}` : `was killed by ${signal}`;
                finish(
                    new OperationError('operation_failed', `${name} ${reason}.`, {
                        cause: new Error(tail(result.stderr)),
                    }),
                );
            } else {
                finish(undefined, result);
            }
        });

        if (options.input !== undefined) {
            child.stdin?.end(options.input);
        }
    });
}
