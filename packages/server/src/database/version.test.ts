import { describe, expect, it } from 'vitest';

import { isSupportedVersion, parseServerVersion } from './version.ts';

describe('parseServerVersion', () => {
    it('reads MySQL and PostgreSQL versions', () => {
        expect(parseServerVersion('8.4.3')).toEqual({ major: 8, minor: 4 });
        expect(parseServerVersion('15.10 (Debian 15.10-1.pgdg120+1)')).toEqual({
            major: 15,
            minor: 10,
        });
    });

    it('refuses MariaDB and unknown formats', () => {
        expect(parseServerVersion('11.4.2-MariaDB-ubu2404')).toBeUndefined();
        expect(parseServerVersion('devel')).toBeUndefined();
    });
});

describe('isSupportedVersion', () => {
    it('accepts MySQL 8.4 and later', () => {
        expect(isSupportedVersion('mysql', '8.4.0')).toBe(true);
        expect(isSupportedVersion('mysql', '9.1.0')).toBe(true);
        expect(isSupportedVersion('mysql', '8.0.40')).toBe(false);
    });

    it('accepts SQLite 3.38 and later', () => {
        expect(isSupportedVersion('sqlite', '3.53.4')).toBe(true);
        expect(isSupportedVersion('sqlite', '3.37.2')).toBe(false);
    });

    it('accepts PostgreSQL 15 and later', () => {
        expect(isSupportedVersion('postgres', '15.0')).toBe(true);
        expect(isSupportedVersion('postgres', '18.1')).toBe(true);
        expect(isSupportedVersion('postgres', '14.15')).toBe(false);
    });
});
