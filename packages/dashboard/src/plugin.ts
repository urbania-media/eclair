import type { PanneauPlugin } from '@panneau/core';

import {
    CodeDisplay,
    HoursDisplay,
    StatusDisplay,
    TasksDisplay,
    WebhooksDisplay,
} from './displays.tsx';
import { JobPage } from './pages/JobPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { SignOutPage } from './pages/SignOutPage.tsx';
import { UsagePage } from './pages/UsagePage.tsx';
import { ItemActions } from './project/ItemActions.tsx';
import { ProjectKeys } from './project/ProjectKeys.tsx';
import { ProjectStorages } from './project/ProjectStorages.tsx';
import { WebhookSecret } from './project/WebhookSecret.tsx';

/** The dashboard's pages, layout components and displays, for the definition to name. */
export const dashboardPlugin: PanneauPlugin = {
    id: 'eclair',
    pages: {
        'eclair-overview': OverviewPage,
        'eclair-job': JobPage,
        'eclair-usage': UsagePage,
        'eclair-sign-out': SignOutPage,
    },
    components: {
        'eclair-item-actions': ItemActions,
        'eclair-webhook-secret': WebhookSecret,
        'eclair-project-keys': ProjectKeys,
        'eclair-project-storages': ProjectStorages,
    },
    displays: {
        'eclair-status': StatusDisplay,
        'eclair-code': CodeDisplay,
        'eclair-hours': HoursDisplay,
        'eclair-tasks': TasksDisplay,
        'eclair-webhooks': WebhooksDisplay,
    },
};
