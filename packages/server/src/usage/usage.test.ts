import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createId } from '../ids.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { usageReport } from './usage.ts';

let services: Services;

beforeAll(async () => {
    services = await createTestServices();
    const niche = (await services.projects.create({ slug: 'niche' })).project;
    const other = (await services.projects.create({ slug: 'other' })).project;
    const row = (projectId: string, at: string, cpu: number, bytes: number) => ({
        id: createId('usage'),
        project_id: projectId,
        operation: 'probe@1',
        cpu_ms: cpu,
        media_ms: 2000,
        bytes_in: bytes,
        bytes_out: 0,
        bytes_stored: 0,
        created_at: new Date(at),
    });
    await services.database.kysely
        .insertInto('usage')
        .values([
            row(niche.id, '2026-10-14T23:59:59.000Z', 1500, 1024 ** 2),
            row(niche.id, '2026-10-15T00:00:00.000Z', 500, 3 * 1024 ** 2),
            row(niche.id, '2026-10-15T12:00:00.000Z', 500, 5 * 1024 ** 3),
            row(other.id, '2026-10-15T08:00:00.000Z', 250, 1),
            row(other.id, '2026-09-01T08:00:00.000Z', 99_000, 1),
        ])
        .execute();
});

afterAll(async () => {
    await services.database.close();
});

describe('usageReport', () => {
    it('sums the usage of each project per UTC day', async () => {
        const report = await usageReport(services.database, {
            since: new Date('2026-10-01T00:00:00Z'),
        });
        expect(report).toEqual([
            {
                project: 'niche',
                day: '2026-10-14',
                tasks: 1,
                cpuSeconds: 1.5,
                mediaSeconds: 2,
                bytesIn: 1024 ** 2,
                bytesOut: 0,
                bytesStored: 0,
            },
            {
                project: 'niche',
                day: '2026-10-15',
                tasks: 2,
                cpuSeconds: 1,
                mediaSeconds: 4,
                bytesIn: 3 * 1024 ** 2 + 5 * 1024 ** 3,
                bytesOut: 0,
                bytesStored: 0,
            },
            {
                project: 'other',
                day: '2026-10-15',
                tasks: 1,
                cpuSeconds: 0.3,
                mediaSeconds: 2,
                bytesIn: 1,
                bytesOut: 0,
                bytesStored: 0,
            },
        ]);
    });

    it('keeps one project', async () => {
        const niche = await services.projects.get('niche');
        const report = await usageReport(services.database, {
            since: new Date('2026-10-15T00:00:00Z'),
            projectId: niche.id,
        });
        expect(report.map(({ project, day }) => `${project} ${day}`)).toEqual(['niche 2026-10-15']);
    });
});
