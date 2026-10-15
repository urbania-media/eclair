import { describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';

import { createId, isId } from './ids.ts';

describe('createId', () => {
    it('creates ids that the protocol accepts', () => {
        expect(validate('JobId', createId('job')).valid).toBe(true);
        expect(validate('UploadId', createId('upload')).valid).toBe(true);
    });

    it('creates ids that sort in creation order', () => {
        const ids = Array.from({ length: 100 }, () => createId('task'));
        expect([...ids].sort()).toEqual(ids);
    });
});

describe('isId', () => {
    it('checks the prefix and the ULID', () => {
        expect(isId('job', createId('job'))).toBe(true);
        expect(isId('job', createId('task'))).toBe(false);
        expect(isId('job', 'job_123')).toBe(false);
        expect(isId('job', 42)).toBe(false);
    });
});
