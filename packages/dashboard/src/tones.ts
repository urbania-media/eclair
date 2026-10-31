/** A built-in tone of Panneau's badges. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** The tone of each status: of projects, keys, jobs, tasks and webhook deliveries. */
export const TONES: Record<string, Tone> = {
    active: 'success',
    disabled: 'neutral',
    revoked: 'neutral',
    pending: 'neutral',
    queued: 'neutral',
    running: 'info',
    completed: 'success',
    delivered: 'success',
    failed: 'danger',
    canceled: 'warning',
    skipped: 'neutral',
};
