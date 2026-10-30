import type { AdminProject } from '@eclair-js/protocol';

export const ADMIN_TOKEN = 'admin-token-for-tests';

export function project(overrides: Partial<AdminProject> = {}): AdminProject {
    return {
        id: 'prj_01M66Q3NV0000000000000000A',
        slug: 'niche-dev',
        name: 'Niche dev',
        priority: 'normal',
        webhookUrl: 'https://niche.example.com/eclair/webhooks',
        settings: { concurrency: 4 },
        disabled: false,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-29T08:30:00.000Z',
        ...overrides,
    };
}
