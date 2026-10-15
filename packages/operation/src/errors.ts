/**
 * Error codes of a failed task (`TaskErrorCode` in the protocol). New codes can be added: clients
 * treat unknown ones as `operation_failed`.
 */
export const ERROR_CODES = [
    'input_unreadable',
    'unsupported_input',
    'timeout',
    'limit_exceeded',
    'operation_failed',
    'storage_failed',
    'provider_failed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * An error an operation throws to fail its task with a code and a message for the application.
 * The message is shown to the client: it never contains a path of the worker or a secret. Any
 * other error fails the task as `operation_failed` with a generic message.
 */
export class OperationError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'OperationError';
        this.code = code;
    }
}
