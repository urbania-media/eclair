import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    EMPTY_SHA256,
    readWebhook,
    sha256,
    verifySignature,
    verifyStorageRequest,
} from './webhooks.ts';

const secret = 'whsec_test';
const now = 1_760_536_992;

function sign(payload: string, timestamp = now): string {
    return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
}

describe('readWebhook', () => {
    const body = JSON.stringify({
        id: 'job_01JA2Y8C6W4N5V7TQ3H9XK0B2M',
        status: 'completed',
        createdAt: '2026-10-15T14:00:00Z',
        tasks: {},
    });

    it('reads a webhook signed with the secret', async () => {
        const headers = new Headers({
            'eclair-event': 'job.completed',
            'eclair-delivery': 'whd_1',
            'eclair-signature': sign(body),
        });
        expect(await readWebhook(headers, body, secret, { now })).toEqual({
            event: 'job.completed',
            delivery: 'whd_1',
            job: JSON.parse(body),
        });
        // Plain objects, as Node and Express give them.
        const plain = {
            'eclair-event': 'job.completed',
            'eclair-delivery': 'whd_1',
            'eclair-signature': sign(body),
        };
        expect(await readWebhook(plain, body, secret, { now })).toBeDefined();
    });

    it('refuses a changed body, another secret and an old signature', async () => {
        const headers = {
            'eclair-event': 'job.completed',
            'eclair-delivery': 'whd_1',
            'eclair-signature': sign(body),
        };
        expect(await readWebhook(headers, `${body} `, secret, { now })).toBeUndefined();
        expect(await readWebhook(headers, body, 'whsec_other', { now })).toBeUndefined();
        expect(await readWebhook(headers, body, secret, { now: now + 301 })).toBeUndefined();
        expect(await readWebhook({}, body, secret, { now })).toBeUndefined();
    });
});

describe('signatures', () => {
    it('accept one of several v1 values', async () => {
        const valid = sign('payload').split('v1=')[1];
        expect(
            await verifySignature(`t=${now},v1=${'0'.repeat(64)},v1=${valid}`, secret, 'payload', {
                now,
            }),
        ).toBe(true);
        expect(await verifySignature('garbage', secret, 'payload', { now })).toBe(false);
        expect(await verifySignature(undefined, secret, 'payload', { now })).toBe(false);
    });

    it('verify the requests of an http storage', async () => {
        const body = 'file content';
        const digest = await sha256(body);
        expect(digest).toBe(createHash('sha256').update(body).digest('hex'));
        expect(
            await verifyStorageRequest(
                sign(`videos/42/a.mp4.${digest}`),
                secret,
                'videos/42/a.mp4',
                digest,
                { now },
            ),
        ).toBe(true);
        expect(
            await verifyStorageRequest(
                sign(`videos/42/a.mp4.${EMPTY_SHA256}`),
                secret,
                'videos/42/a.mp4',
                EMPTY_SHA256,
                { now },
            ),
        ).toBe(true);
        expect(await sha256('')).toBe(EMPTY_SHA256);
    });
});
