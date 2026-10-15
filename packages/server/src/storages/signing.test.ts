import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { EMPTY_SHA256, sign, signStorageRequest, signWebhook, verifySignature } from './signing.ts';

describe('signatures', () => {
    const secret = 'whsec_test';

    it('sign {t}.{payload} with HMAC-SHA256', () => {
        const expected = createHmac('sha256', secret).update('1760536992.{"a":1}').digest('hex');
        expect(signWebhook(secret, '{"a":1}', 1760536992)).toBe(`t=1760536992,v1=${expected}`);
        expect(signStorageRequest(secret, 'videos/42/a.mp4', EMPTY_SHA256, 1)).toBe(
            sign(secret, `videos/42/a.mp4.${EMPTY_SHA256}`, 1),
        );
    });

    it('verify recent signatures only', () => {
        const now = 1760536992;
        const header = signWebhook(secret, 'body', now);
        expect(verifySignature(header, secret, 'body', now + 10)).toBe(true);
        expect(verifySignature(header, secret, 'other', now)).toBe(false);
        expect(verifySignature(header, 'whsec_other', 'body', now)).toBe(false);
        expect(verifySignature(header, secret, 'body', now + 301)).toBe(false);
        expect(verifySignature('garbage', secret, 'body', now)).toBe(false);
    });

    it('accept any of several v1 values', () => {
        const now = 1760536992;
        const valid = signWebhook(secret, 'body', now).split('v1=')[1];
        expect(
            verifySignature(`t=${now},v1=${'0'.repeat(64)},v1=${valid}`, secret, 'body', now),
        ).toBe(true);
    });
});
