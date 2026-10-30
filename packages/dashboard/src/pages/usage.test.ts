import { describe, expect, it } from 'vitest';

import type { UsageLine } from '@eclair-js/protocol';

import { daysBack, periodDays, recentMonths, toCsv, totalsByProject } from './usage.ts';

const now = new Date('2026-10-30T15:00:00Z');

function line(project: string, day: string, cpuSeconds: number): UsageLine {
    return {
        project,
        day,
        tasks: 1,
        cpuSeconds,
        mediaSeconds: cpuSeconds * 2,
        bytesIn: 10,
        bytesOut: 5,
        bytesStored: 0,
    };
}

describe('usage', () => {
    it('gives the days of a period, and how far back to ask for them', () => {
        expect(recentMonths(now)).toEqual(['2026-10', '2026-09', '2026-08']);
        const last30 = periodDays('last30', now);
        expect(last30).toHaveLength(30);
        expect([last30[0], last30.at(-1)]).toEqual(['2026-10-01', '2026-10-30']);
        const september = periodDays('2026-09', now);
        expect([september.length, september[0], september.at(-1)]).toEqual([
            30,
            '2026-09-01',
            '2026-09-30',
        ]);
        // The current month stops today
        expect(periodDays('2026-10', now)).toHaveLength(30);
        expect(daysBack(september, now)).toBe(60);
        expect(daysBack(last30, now)).toBe(30);
    });

    it('adds up the usage of each project over a period, the largest first', () => {
        const lines = [
            line('niche-dev', '2026-10-02', 100),
            line('urbania-ca', '2026-10-02', 300),
            line('niche-dev', '2026-10-03', 50),
            line('niche-dev', '2026-09-30', 1000),
        ];
        expect(totalsByProject(lines, periodDays('2026-10', now))).toEqual([
            expect.objectContaining({ project: 'urbania-ca', cpuSeconds: 300 }),
            expect.objectContaining({
                project: 'niche-dev',
                tasks: 2,
                cpuSeconds: 150,
                mediaSeconds: 300,
                bytesIn: 20,
            }),
        ]);
        expect(toCsv(lines, ['2026-10-02'])).toBe(
            'day,project,tasks,cpuSeconds,mediaSeconds,bytesIn,bytesOut,bytesStored\n' +
                '2026-10-02,niche-dev,1,100,200,10,5,0\n' +
                '2026-10-02,urbania-ca,1,300,600,10,5,0\n',
        );
    });
});
