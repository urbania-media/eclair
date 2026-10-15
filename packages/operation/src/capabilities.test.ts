import { describe, expect, it } from 'vitest';

import { isCapability } from './index.ts';

describe('isCapability', () => {
    it('accepts the known capabilities', () => {
        expect(['cpu', 'video', 'gpu', 'ai'].every(isCapability)).toBe(true);
    });

    it('refuses anything else', () => {
        expect(isCapability('tpu')).toBe(false);
        expect(isCapability(undefined)).toBe(false);
    });
});
