import { describe, expect, it } from 'vitest';

import { checkDatabase, getDialect, getSqlitePath } from './dialect.ts';

describe('getDialect', () => {
    it('reads the dialect from the URL scheme', () => {
        expect(getDialect('mysql://eclair:secret@localhost:3306/eclair')).toBe('mysql');
        expect(getDialect('postgres://eclair:secret@localhost:5432/eclair')).toBe('postgres');
        expect(getDialect('postgresql://eclair:secret@localhost/eclair')).toBe('postgres');
        expect(getDialect('sqlite:///var/lib/eclair/eclair.db')).toBe('sqlite');
    });

    it('refuses other databases without leaking the password', () => {
        expect(() => getDialect('mongodb://eclair:secret@localhost/eclair')).toThrow(/mongodb:/);
        expect(() => getDialect('mongodb://eclair:secret@localhost/eclair')).not.toThrow(/secret/);
        expect(() => getDialect('not a url secret')).not.toThrow(/secret/);
    });
});

describe('getSqlitePath', () => {
    it('reads absolute, relative and in-memory databases', () => {
        expect(getSqlitePath('sqlite:///var/lib/eclair/eclair.db')).toBe(
            '/var/lib/eclair/eclair.db',
        );
        expect(getSqlitePath('sqlite:data/eclair.db')).toBe('data/eclair.db');
        expect(getSqlitePath('sqlite::memory:')).toBe(':memory:');
        expect(getSqlitePath('sqlite:///tmp/my%20eclair.db')).toBe('/tmp/my eclair.db');
    });

    it('refuses a host, which would be read as a path by mistake', () => {
        expect(() => getSqlitePath('sqlite://data/eclair.db')).toThrow(/no host/);
        expect(() => getSqlitePath('sqlite://eclair:secret@localhost/eclair.db')).not.toThrow(
            /secret/,
        );
    });

    it('needs a file', () => {
        expect(() => getSqlitePath('sqlite:///')).toThrow(/no file path/);
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
