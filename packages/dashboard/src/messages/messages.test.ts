import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';

import { catalogs, pickLocale } from './index.ts';

describe('messages', () => {
    it('picks the first language of the browser that the dashboard speaks', () => {
        expect(pickLocale(['de-DE', 'fr-CA', 'en'])).toBe('fr');
        expect(pickLocale(['en-US'])).toBe('en');
        expect(pickLocale(['de'])).toBe('en');
        expect(pickLocale([])).toBe('en');
    });

    it('has every message in French, and each one formats', () => {
        expect(Object.keys(catalogs.fr).sort()).toEqual(Object.keys(catalogs.en).sort());
        for (const locale of ['en', 'fr'] as const) {
            const intl = createIntl({
                locale,
                messages: catalogs[locale],
                onError: (error) => {
                    throw error;
                },
            });
            for (const [id, message] of Object.entries(catalogs[locale])) {
                // Every placeholder gets a number, which plurals need too.
                const names = [...message.matchAll(/\{(\w+)/g)].map(([, name]) => name ?? '');
                const values = Object.fromEntries(names.map((name) => [name, 1]));
                expect(() =>
                    intl.formatMessage({ id }, { ...values, code: (chunks) => chunks }),
                ).not.toThrow();
            }
        }
    });
});
