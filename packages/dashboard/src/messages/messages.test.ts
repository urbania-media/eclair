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
            for (const id of Object.keys(catalogs[locale])) {
                expect(() =>
                    intl.formatMessage({ id }, { message: 'x', code: (chunks) => chunks }),
                ).not.toThrow();
            }
        }
    });
});
