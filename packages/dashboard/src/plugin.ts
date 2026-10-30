import type { PanneauPlugin } from '@panneau/core';

import { CodeDisplay, HoursDisplay, StatusDisplay } from './displays.tsx';
import { SignOutPage } from './pages/SignOutPage.tsx';
import { UsagePage } from './pages/UsagePage.tsx';
import { ProjectKeys } from './project/ProjectKeys.tsx';
import { ProjectStorages } from './project/ProjectStorages.tsx';
import { WebhookSecret } from './project/WebhookSecret.tsx';

/** The dashboard's pages, layout components and displays, for the definition to name. */
export const dashboardPlugin: PanneauPlugin = {
    id: 'eclair',
    pages: {
        'eclair-usage': UsagePage,
        'eclair-sign-out': SignOutPage,
    },
    components: {
        'eclair-webhook-secret': WebhookSecret,
        'eclair-project-keys': ProjectKeys,
        'eclair-project-storages': ProjectStorages,
    },
    displays: {
        'eclair-status': StatusDisplay,
        'eclair-code': CodeDisplay,
        'eclair-hours': HoursDisplay,
    },
};
