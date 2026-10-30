import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { createEclairAdapter } from './adapter/adapter.ts';
import { createTokenStore } from './adapter/token.ts';
import { pickLocale } from './messages/index.ts';

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
