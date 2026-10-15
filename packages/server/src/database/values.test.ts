import { describe, expect, it } from 'vitest';

import { readBoolean, readDate, readJson, readNumber, readOptionalDate, toJson } from './values.ts';

describe('values', () => {
    it('reads dates from a Date or ISO text', () => {
        const date = new Date('2026-10-15T14:00:00.123Z');
        expect(readDate(date)).toBe(date);
        expect(readDate('2026-10-15T14:00:00.123Z')).toEqual(date);
        expect(readOptionalDate(null)).toBeUndefined();
        expect(() => readDate('yesterday')).toThrow(TypeError);
    });

    it('reads JSON parsed or as text', () => {
        expect(readJson({ a: 1 })).toEqual({ a: 1 });
        expect(readJson('{"a":1}')).toEqual({ a: 1 });
        expect(readJson('[1,2]')).toEqual([1, 2]);
        expect(toJson([1, 2])).toBe('[1,2]');
    });

    it('reads booleans from every database', () => {
        expect([true, 1, '1', 1n].map(readBoolean)).toEqual([true, true, true, true]);
        expect([false, 0, '0', null].map(readBoolean)).toEqual([false, false, false, false]);
    });

    it('reads big integers as numbers', () => {
        expect(readNumber('2147483648')).toBe(2147483648);
        expect(readNumber(42)).toBe(42);
        expect(() => readNumber('lots')).toThrow(TypeError);
    });
});
