/**
 * Capabilities an operation can require. Each one is a queue that workers subscribe to. `probe` is
 * the queue of probes, with reserved slots on every worker (decision 0012).
 */
export const CAPABILITIES = ['cpu', 'video', 'gpu', 'ai', 'probe'] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
    return CAPABILITIES.some((capability) => capability === value);
}
