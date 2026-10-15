import { describe, expect, it } from 'vitest';

import { checkDatabase, getDialect } from './dialect.ts';

describe('getDialect', () => {
    it('reads the dialect from the URL scheme', () => {
        expect(getDialect('mysql://eclair:secret@localhost:3306/eclair')).toBe('mysql');
        expect(getDialect('postgres://eclair:secret@localhost:5432/eclair')).toBe('postgres');
        expect(getDialect('postgresql://eclair:secret@localhost/eclair')).toBe('postgres');
    });

    it('refuses other databases without leaking the password', () => {
        expect(() => getDialect('sqlite://eclair:secret@localhost/eclair')).toThrow(/sqlite:/);
        expect(() => getDialect('sqlite://eclair:secret@localhost/eclair')).not.toThrow(/secret/);
        expect(() => getDialect('not a url secret')).not.toThrow(/secret/);
    });
});

// Runs against the database in DATABASE_URL. CI sets ECLAIR_TEST_DIALECT for each database of its
// matrix, so a missing DATABASE_URL fails there instead of skipping.
const databaseUrl = process.env['DATABASE_URL'];
const expectedDialect = process.env['ECLAIR_TEST_DIALECT'];

describe.skipIf(databaseUrl === undefined && expectedDialect === undefined)('checkDatabase', () => {
    it('connects to a supported server', async () => {
        expect(databaseUrl, 'DATABASE_URL').toBeDefined();
        const status = await checkDatabase(databaseUrl ?? '');
        if (expectedDialect !== undefined) {
            expect(status.dialect).toBe(expectedDialect);
        }
        expect(status.supported, `${status.dialect} ${status.version}`).toBe(true);
    });
});
