import type { AdminProject, ApiKey, Preset, Storage } from '@eclair-js/protocol';

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

export function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    return {
        id: 'key_01M672QS31VYVYR6B3TESBGVTP',
        name: 'platform',
        prefix: 'ek_2_DdCJy0',
        scopes: ['jobs:read', 'jobs:write'],
        createdAt: '2026-10-29T08:00:00.000Z',
        lastUsedAt: null,
        revoked: false,
        ...overrides,
    };
}

export function storage(overrides: Partial<Storage> = {}): Storage {
    return {
        name: 'media',
        kind: 's3',
        location: 's3://urbania-niche-dev (tor1.digitaloceanspaces.com)',
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
        ...overrides,
    };
}

export function preset(overrides: Partial<Preset> = {}): Preset {
    return {
        name: 'mediatheque/video',
        scope: 'global',
        version: 3,
        description: 'Video for the media library',
        tasks: {
            probe: { op: 'probe' },
            poster: { op: 'video.poster' },
            h264: { op: 'video.transcode', options: { codec: 'h264' } },
        },
        ...overrides,
    } as Preset;
}
