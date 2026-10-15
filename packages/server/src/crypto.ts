import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Encrypts a secret with `ECLAIR_SECRET_KEY` (AES-256-GCM). The result is text:
 * `v1.<iv>.<ciphertext and tag>`, in base64url. The version allows a new format later.
 */
export function encryptSecret(key: Buffer, plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([ciphertext, cipher.getAuthTag()]);
    return `${VERSION}.${iv.toString('base64url')}.${payload.toString('base64url')}`;
}

/**
 * Decrypts a secret from `encryptSecret()`. Throws when the key is wrong or the value was changed,
 * without saying more: the message never contains the value.
 */
export function decryptSecret(key: Buffer, value: string): string {
    const [version, iv, payload] = value.split('.');
    if (version !== VERSION || iv === undefined || payload === undefined) {
        throw new Error('The encrypted value has an unknown format.');
    }
    const data = Buffer.from(payload, 'base64url');
    try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(data.subarray(data.length - TAG_LENGTH));
        return Buffer.concat([
            decipher.update(data.subarray(0, data.length - TAG_LENGTH)),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        throw new Error(
            "Can't decrypt a stored secret: ECLAIR_SECRET_KEY isn't the key it was encrypted with.",
        );
    }
}

/** SHA-256 of a value, in hexadecimal. */
export function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

/** A random token: a prefix and 32 random bytes in base64url (`ek_…`). */
export function randomToken(prefix: string, bytes = 32): string {
    return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

/** Compares two strings in constant time. */
export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
