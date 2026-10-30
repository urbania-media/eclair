import type { PanneauPlugin } from '@panneau/core';

import {
    CodeDisplay,
    HoursDisplay,
    StatusDisplay,
    TasksDisplay,
    WebhooksDisplay,
} from './displays.tsx';
import { catalogs } from './messages/index.ts';
import { JobPage } from './pages/JobPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { UsagePage } from './pages/UsagePage.tsx';
import { ItemActions } from './project/ItemActions.tsx';
import { ProjectKeys } from './project/ProjectKeys.tsx';
import { ProjectStorages } from './project/ProjectStorages.tsx';
import { WebhookSecret } from './project/WebhookSecret.tsx';

/** The dashboard's pages, layout components, displays and messages. */
export const dashboardPlugin: PanneauPlugin = {
    id: 'eclair',
    locales: catalogs,
    pages: {
        'eclair-overview': OverviewPage,
        'eclair-job': JobPage,
        'eclair-usage': UsagePage,
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
