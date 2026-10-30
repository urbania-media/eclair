import { type IntlShape, createIntl, createIntlCache } from 'react-intl';

import { type MessageId, type Messages, en } from './en.ts';
import { fr } from './fr.ts';

export type { MessageId, Messages };

export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const catalogs: Record<Locale, Messages> = { en, fr };

/** The first of the browser's languages that the dashboard speaks, or English. */
export function pickLocale(
    languages: readonly string[] = globalThis.navigator?.languages ?? [],
): Locale {
    for (const language of languages) {
        const base = language.toLowerCase().split('-')[0];
        const locale = LOCALES.find((candidate) => candidate === base);
        if (locale !== undefined) {
            return locale;
        }
    }
    return 'en';
}

const cache = createIntlCache();

/** A react-intl object with the dashboard's messages, outside React (the definition). */
export function createMessages(locale: Locale): IntlShape {
    return createIntl({ locale, defaultLocale: 'en', messages: catalogs[locale] }, cache);
}

/** Formats one of the dashboard's messages. */
export function t(
    intl: IntlShape,
    id: MessageId,
    values?: Record<string, string | number | Date>,
): string {
    return intl.formatMessage({ id }, values);
}
