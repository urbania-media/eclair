import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from './crypto.ts';

const key = randomBytes(32);

describe('encryptSecret', () => {
    it('round-trips, with a new IV each time', () => {
        const first = encryptSecret(key, 's3cret ✓');
        const second = encryptSecret(key, 's3cret ✓');
        expect(first).not.toBe(second);
        expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
        expect(decryptSecret(key, first)).toBe('s3cret ✓');
    });

    it('refuses another key or a changed value, without the value in the message', () => {
        const encrypted = encryptSecret(key, 'hunter2');
        expect(() => decryptSecret(randomBytes(32), encrypted)).toThrow(/ECLAIR_SECRET_KEY/);

        const [version, iv, payload = ''] = encrypted.split('.');
        const changed = `${version}.${iv}.${payload.slice(0, -2)}AA`;
        expect(() => decryptSecret(key, changed)).toThrow(/ECLAIR_SECRET_KEY/);
        expect(() => decryptSecret(key, 'plain')).toThrow(/unknown format/);
    });
});

describe('tokens', () => {
    it('creates prefixed random tokens', () => {
        const token = randomToken('ek_');
        expect(token).toMatch(/^ek_[\w-]{43}$/);
        expect(randomToken('ek_')).not.toBe(token);
    });

    it('hashes and compares', () => {
        expect(sha256('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
        expect(safeEqual('abc', 'abc')).toBe(true);
        expect(safeEqual('abc', 'abd')).toBe(false);
        expect(safeEqual('abc', 'abcd')).toBe(false);
    });
});
