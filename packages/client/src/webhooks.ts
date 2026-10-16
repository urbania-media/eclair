import type { Job, WebhookEvent } from '@eclair-js/protocol';

/** How old a signature may be, in seconds (see the protocol). */
export const SIGNATURE_TOLERANCE = 300;

const encoder = new TextEncoder();

async function hmac(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = new Uint8Array(
        await crypto.subtle.sign('HMAC', key, encoder.encode(payload)),
    );
    return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings without returning early, so the time doesn't tell how much matched. */
function equal(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return difference === 0;
}

/**
 * Checks a `t=…,v1=…` signature against a payload: a recent timestamp, and one `v1` value that is
 * the HMAC-SHA256 of `{t}.{payload}` with the secret.
 */
export async function verifySignature(
    header: string | null | undefined,
    secret: string,
    payload: string,
    options: { tolerance?: number; now?: number } = {},
): Promise<boolean> {
    if (header === null || header === undefined) {
        return false;
    }
    const parts = header.split(',').map((part) => part.split('='));
    const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
        !Number.isInteger(timestamp) ||
        Math.abs(now - timestamp) > (options.tolerance ?? SIGNATURE_TOLERANCE)
    ) {
        return false;
    }
    const expected = await hmac(secret, `${timestamp}.${payload}`);
    return parts.some(
        ([key, value]) => key === 'v1' && value !== undefined && equal(value, expected),
    );
}

export interface WebhookDelivery {
    event: WebhookEvent;
    /** Id of the delivery, the same for every attempt: use it to ignore duplicates. */
    delivery: string;
    job: Job;
}

/** The headers of a request, from a `Headers` object or a plain object (Node, Express). */
type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderSource, name: string): string | undefined {
    if (headers instanceof Headers) {
        return headers.get(name) ?? undefined;
    }
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads a webhook of Eclair: checks its signature with the project's webhook secret, then returns
 * its event, delivery id and job. Returns `undefined` for a request that isn't from Eclair: answer
 * it with a 401. `body` is the raw body, before any JSON parsing.
 */
export async function readWebhook(
    headers: HeaderSource,
    body: string,
    secret: string,
    options: { tolerance?: number; now?: number } = {},
): Promise<WebhookDelivery | undefined> {
    if (!(await verifySignature(header(headers, 'eclair-signature'), secret, body, options))) {
        return undefined;
    }
    const event = header(headers, 'eclair-event');
    const delivery = header(headers, 'eclair-delivery');
    if (event === undefined || delivery === undefined) {
        return undefined;
    }
    return { event: event as WebhookEvent, delivery, job: JSON.parse(body) as Job };
}

/** SHA-256 of a body, in hex, as `Eclair-Content-Sha256` sends it. */
export async function sha256(body: ArrayBuffer | Uint8Array | string): Promise<string> {
    const data =
        typeof body === 'string'
            ? encoder.encode(body)
            : body instanceof Uint8Array
              ? body
              : new Uint8Array(body);
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>),
    );
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of an empty body, which a signed `GET` of an `http` storage covers. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Checks a request from Eclair to an `http` storage (`storage.read` or `storage.write` in the
 * protocol): the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}`. `path` is the storage path, not
 * URL-encoded; `bodySha256` is the hash you computed of the body you received (`EMPTY_SHA256` for
 * a `GET`), never the header's.
 */
export function verifyStorageRequest(
    header: string | null | undefined,
    secret: string,
    path: string,
    bodySha256: string,
    options: { tolerance?: number; now?: number } = {},
): Promise<boolean> {
    return verifySignature(header, secret, `${path}.${bodySha256}`, options);
}
