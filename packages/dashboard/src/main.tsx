import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { createEclairAdapter } from './adapter/adapter.ts';
import { createTokenStore } from './adapter/token.ts';
import { createAuth } from './definition.ts';
import { createMessages, pickLocale } from './messages/index.ts';

const locale = pickLocale();
document.documentElement.lang = locale;
const adapter = createEclairAdapter({ tokens: createTokenStore(), locale });

const element = document.getElementById('eclair');
if (element === null) {
    throw new Error('The page has no #eclair element.');
}
createRoot(element).render(
    <StrictMode>
        <App adapter={adapter} locale={locale} auth={createAuth(createMessages(locale))} />
    </StrictMode>,
);
