import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { createEclairAdapter } from './adapter/adapter.ts';
import { createTokenStore } from './adapter/token.ts';
import { pickLocale } from './messages/index.ts';

// The overview is the dashboard's home: Panneau's home page ignores `pages.home` of the
// definition, https://github.com/folkloreinc/panneau-js/issues/139
if (/^\/dashboard\/?$/.test(window.location.pathname)) {
    window.history.replaceState(null, '', '/dashboard/pages/overview');
}

const locale = pickLocale();
document.documentElement.lang = locale;
const tokens = createTokenStore();
const adapter = createEclairAdapter({ tokens, locale });

const element = document.getElementById('eclair');
if (element === null) {
    throw new Error('The page has no #eclair element.');
}
createRoot(element).render(
    <StrictMode>
        <App adapter={adapter} tokens={tokens} locale={locale} />
    </StrictMode>,
);
