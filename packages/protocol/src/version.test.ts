import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from './index.ts';

describe('PROTOCOL_VERSION', () => {
    it('is v1', () => {
        expect(PROTOCOL_VERSION).toBe('v1');
    });
});
