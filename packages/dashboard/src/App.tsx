import { Panneau } from '@panneau/app';
import type { DataAdapter } from '@panneau/data';
import { type Auth, type BootConfig, validateBootConfig } from '@panneau/protocol';
import { useState } from 'react';

import { iconLoader } from './icons.ts';
import type { Locale } from './messages/index.ts';
import { dashboardPlugin } from './plugin.ts';

export interface AppProps {
    adapter: DataAdapter;
    locale: Locale;
    /** How the operator signs in: the admin token, for Panneau's login page. */
    auth: Auth;
    /** The path of the dashboard. Defaults to `/dashboard`, where the API serves it. */
    basePath?: string;
    /** The URL of the admin API. Defaults to `/admin/v1`. */
    apiBaseUrl?: string;
}

function bootConfig(locale: Locale, auth: Auth, basePath: string, apiBaseUrl: string): BootConfig {
    const result = validateBootConfig({ protocol: 1, apiBaseUrl, basePath, locale, auth });
    if (!result.success) {
        throw new Error('The boot config of the dashboard is invalid.');
    }
    return result.data;
}

/**
 * The dashboard: Panneau's app on the Eclair adapter. Without the admin token, or once the server
 * refuses it, Panneau shows its login page, where the operator pastes the token (decision 0037 of
 * Panneau). Its sidebar signs out.
 */
export function App({
    adapter,
    locale,
    auth,
    basePath = '/dashboard',
    apiBaseUrl = '/admin/v1',
}: AppProps) {
    const [config] = useState(() => bootConfig(locale, auth, basePath, apiBaseUrl));
    return (
        <Panneau
            config={config}
            adapter={adapter}
            plugins={[dashboardPlugin]}
            iconLoader={iconLoader}
        />
    );
}
