import type { DefinitionInput, User } from '@panneau/protocol';
import type { IntlShape } from 'react-intl';

import { type Locale, t } from './messages/index.ts';

export interface DefinitionOptions {
    intl: IntlShape;
    locale: Locale;
    /** The URL of the admin API. */
    baseUrl: string;
    user: User;
}

/**
 * The dashboard's definition: Eclair implements no Panneau protocol, so the definition is static,
 * in the operator's locale, and the adapter maps it onto the admin API (decision 0021).
 */
export function createDefinition({
    intl,
    locale,
    baseUrl,
    user,
}: DefinitionOptions): DefinitionInput {
    return {
        protocol: 1,
        name: t(intl, 'app.name'),
        locale,
        locales: [locale],
        api: { baseUrl },
        resources: [],
        pages: {
            'sign-out': { component: 'eclair-sign-out', label: t(intl, 'signOut.label') },
        },
        menus: {
            main: [
                { type: 'resources' },
                { type: 'separator' },
                { type: 'page', page: 'sign-out', icon: 'log-out' },
            ],
        },
        // Signing in is the dashboard's own page: the admin token (decision 0021).
        auth: { mode: 'panneau', password: false },
        search: { enabled: false },
        user,
    };
}
