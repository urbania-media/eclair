/** Capabilities an operation can require. Each one is a queue that workers subscribe to. */
export const CAPABILITIES = ['cpu', 'video', 'gpu', 'ai'] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
    return CAPABILITIES.some((capability) => capability === value);
}
