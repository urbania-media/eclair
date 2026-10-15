import { describe, expect, it } from 'vitest';

import { apiUrl } from './index.ts';

describe('apiUrl', () => {
    it('adds the protocol version to the path', () => {
        expect(apiUrl('https://eclair.test', '/jobs')).toBe('https://eclair.test/v1/jobs');
    });

    it('normalizes slashes', () => {
        expect(apiUrl('https://eclair.test/', 'jobs')).toBe('https://eclair.test/v1/jobs');
    });
});
