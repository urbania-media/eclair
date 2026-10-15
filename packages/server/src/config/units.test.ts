import { describe, expect, it } from 'vitest';

import { parseDuration, parseSize } from './units.ts';

describe('parseDuration', () => {
    it.each([
        ['500ms', 500],
        ['30s', 30_000],
        ['10m', 600_000],
        ['1h', 3_600_000],
        ['1.5h', 5_400_000],
        ['7d', 604_800_000],
    ])('parses %s', (value, expected) => {
        expect(parseDuration(value)).toBe(expected);
    });

    it.each(['', '10', 'h', '1w', '-1h', '1 h'])('refuses %j', (value) => {
        expect(() => parseDuration(value)).toThrow('is not a duration');
    });
});

describe('parseSize', () => {
    it.each([
        ['100B', 100],
        ['512KB', 512 * 1024],
        ['2GB', 2 * 1024 ** 3],
        ['2gb', 2 * 1024 ** 3],
        ['1.5GiB', 1.5 * 1024 ** 3],
        ['1 TB', 1024 ** 4],
    ])('parses %s', (value, expected) => {
        expect(parseSize(value)).toBe(expected);
    });

    it.each(['', '2', 'GB', '2XB', '-1GB'])('refuses %j', (value) => {
        expect(() => parseSize(value)).toThrow('is not a size');
    });
});
