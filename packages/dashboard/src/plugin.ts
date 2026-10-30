import type { PanneauPlugin } from '@panneau/core';

import { SignOutPage } from './pages/SignOutPage.tsx';

/** The dashboard's pages, layout components and displays, for the definition to name. */
export const dashboardPlugin: PanneauPlugin = {
    id: 'eclair',
    pages: {
        'eclair-sign-out': SignOutPage,
    },
};
