import { Panneau } from '@panneau/app';
import type { DataAdapter } from '@panneau/data';
import { withPanneauMessages } from '@panneau/intl';
import { type BootConfig, validateBootConfig } from '@panneau/protocol';
import { PanneauRoot } from '@panneau/ui';
import { useState, useSyncExternalStore } from 'react';
import { IntlProvider } from 'react-intl';

import type { TokenStore } from './adapter/token.ts';
import { iconLoader } from './icons.ts';
import { type LoginNotice, LoginPage } from './login/LoginPage.tsx';
import { type Locale, catalogs } from './messages/index.ts';
import { dashboardPlugin } from './plugin.ts';
import { SignOutContext } from './session.tsx';

export interface AppProps {
    adapter: DataAdapter;
    tokens: TokenStore;
    locale: Locale;
    /** The path of the dashboard. Defaults to `/dashboard`, where the API serves it. */
    basePath?: string;
    /** The URL of the admin API. Defaults to `/admin/v1`. */
    apiBaseUrl?: string;
}

function bootConfig(locale: Locale, basePath: string, apiBaseUrl: string): BootConfig {
    const result = validateBootConfig({ protocol: 1, apiBaseUrl, basePath, locale });
    if (!result.success) {
        throw new Error('The boot config of the dashboard is invalid.');
    }
    return result.data;
}

/**
 * The dashboard: the login page without an admin token, Panneau's app with one. When the server
 * refuses the token, or the operator signs out, the token is forgotten and the login page says
 * why. Each sign-in mounts a new app, with a new query cache.
 */
export function App({
    adapter,
    tokens,
    locale,
    basePath = '/dashboard',
    apiBaseUrl = '/admin/v1',
}: AppProps) {
    const token = useSyncExternalStore(tokens.subscribe, tokens.get);
    const [notice, setNotice] = useState<LoginNotice | null>(null);
    const [config] = useState(() => bootConfig(locale, basePath, apiBaseUrl));
    const [messages] = useState(() => withPanneauMessages(locale, catalogs[locale]));

    const signOut = () => {
        // Back to the home: signing in again mustn't open the sign-out page.
        window.history.replaceState(null, '', basePath);
        setNotice('signedOut');
        void adapter.logout();
    };

    return (
        // Panneau doesn't load the messages of plugins yet, so the dashboard provides them all:
        // https://github.com/folkloreinc/panneau-js/issues/138
        <IntlProvider locale={locale} defaultLocale="en" messages={messages}>
            {token === null ? (
                <PanneauRoot locale={locale} colorScheme="auto" iconLoader={iconLoader}>
                    <LoginPage adapter={adapter} notice={notice} />
                </PanneauRoot>
            ) : (
                <SignOutContext value={signOut}>
                    <Panneau
                        key={token}
                        config={config}
                        adapter={adapter}
                        plugins={[dashboardPlugin]}
                        iconLoader={iconLoader}
                        onUnauthorized={() => {
                            setNotice('sessionEnded');
                            tokens.clear();
                        }}
                    />
                </SignOutContext>
            )}
        </IntlProvider>
    );
}
