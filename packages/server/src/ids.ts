import { monotonicFactory } from 'ulid';

/** Prefixes of Eclair's ids. An id is a prefix, `_` and a ULID: `job_01JA2Y8C6W4N5V7TQ3H9XK0B2M`. */
export const ID_PREFIXES = {
    project: 'prj',
    apiKey: 'key',
    storage: 'sto',
    preset: 'pst',
    job: 'job',
    task: 'tsk',
    output: 'out',
    upload: 'upl',
    delivery: 'whd',
    usage: 'use',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}';

// Monotonic: ids created in the same millisecond still sort in creation order.
const nextUlid = monotonicFactory();

export function createId(kind: IdKind): string {
    return `${ID_PREFIXES[kind]}_${nextUlid()}`;
}

export function isId(kind: IdKind, value: unknown): value is string {
    return (
        typeof value === 'string' &&
        new RegExp(`^${ID_PREFIXES[kind]}_${ULID_PATTERN}$`).test(value)
    );
}
