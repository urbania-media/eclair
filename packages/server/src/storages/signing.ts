import { createHmac } from 'node:crypto';

import { safeEqual, sha256 } from '../crypto.ts';

/** SHA-256 of an empty body, which a signed `GET` covers. */
export const EMPTY_SHA256 = sha256('');

/** How old a signature may be, in seconds (see the protocol). */
export const SIGNATURE_TOLERANCE = 300;

function hmac(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
}

/** `t=<unix time>,v1=<hex HMAC-SHA256 of {t}.{payload}>`, as the protocol's `Signature`. */
export function sign(
    secret: string,
    payload: string,
    timestamp = Math.floor(Date.now() / 1000),
): string {
    return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`)}`;
}

/** The signature of a webhook: over the timestamp and the body. */
export function signWebhook(secret: string, body: string, timestamp?: number): string {
    return sign(secret, body, timestamp);
}

/**
 * The signature of a request to an `http` storage: over the timestamp, the storage path (not
 * URL-encoded) and the SHA-256 of the body.
 */
export function signStorageRequest(
    secret: string,
    path: string,
    bodySha256: string,
    timestamp?: number,
): string {
    return sign(secret, `${path}.${bodySha256}`, timestamp);
}

/**
 * Checks a signature header against a payload, as a receiver does: a recent timestamp and one
 * matching `v1` value.
 */
export function verifySignature(
    header: string,
    secret: string,
    payload: string,
    now = Math.floor(Date.now() / 1000),
    tolerance = SIGNATURE_TOLERANCE,
): boolean {
    const parts = header.split(',').map((part) => part.split('='));
    const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > tolerance) {
        return false;
    }
    const expected = hmac(secret, `${timestamp}.${payload}`);
    return parts.some(
        ([key, value]) => key === 'v1' && value !== undefined && safeEqual(value, expected),
    );
}
