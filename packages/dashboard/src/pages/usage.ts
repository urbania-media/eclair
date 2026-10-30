import type { UsageLine } from '@eclair-js/protocol';

/** A period of the usage page: the last 30 days, or a calendar month (`2026-10`). */
export type Period = 'last30' | `${number}-${number}`;

/** The current month and the two before it, newest first. */
export function recentMonths(now: Date): Period[] {
    return [0, 1, 2].map((back) => {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return date.toISOString().slice(0, 7) as Period;
    });
}

/** The UTC days of a period, oldest first, as `YYYY-MM-DD`. */
export function periodDays(period: Period, now: Date): string[] {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const day = 24 * 60 * 60 * 1000;
    let start: number;
    let end: number;
    if (period === 'last30') {
        start = today - 29 * day;
        end = today;
    } else {
        const [year, month] = period.split('-').map(Number) as [number, number];
        start = Date.UTC(year, month - 1, 1);
        end = Math.min(Date.UTC(year, month, 1) - day, today);
    }
    const days: string[] = [];
    for (let time = start; time <= end; time += day) {
        days.push(new Date(time).toISOString().slice(0, 10));
    }
    return days;
}

/** How many days back `GET /admin/v1/usage` must go to cover a period. */
export function daysBack(days: readonly string[], now: Date): number {
    const first = days[0];
    if (first === undefined) {
        return 1;
    }
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(1, Math.round((today - Date.parse(first)) / (24 * 60 * 60 * 1000)) + 1);
}

export interface ProjectUsage {
    project: string;
    tasks: number;
    cpuSeconds: number;
    mediaSeconds: number;
    bytesIn: number;
    bytesOut: number;
    bytesStored: number;
}

/** The usage of each project over the days of a period, the largest task time first. */
export function totalsByProject(lines: readonly UsageLine[], days: readonly string[]) {
    const inPeriod = new Set(days);
    const totals = new Map<string, ProjectUsage>();
    lines
        .filter((line) => inPeriod.has(line.day))
        .forEach((line) => {
            const total = totals.get(line.project) ?? {
                project: line.project,
                tasks: 0,
                cpuSeconds: 0,
                mediaSeconds: 0,
                bytesIn: 0,
                bytesOut: 0,
                bytesStored: 0,
            };
            total.tasks += line.tasks;
            total.cpuSeconds += line.cpuSeconds;
            total.mediaSeconds += line.mediaSeconds;
            total.bytesIn += line.bytesIn;
            total.bytesOut += line.bytesOut;
            total.bytesStored += line.bytesStored;
            totals.set(line.project, total);
        });
    return [...totals.values()].sort((a, b) => b.cpuSeconds - a.cpuSeconds);
}

/** The usage lines of a period as CSV, one line per project and day. */
export function toCsv(lines: readonly UsageLine[], days: readonly string[]): string {
    const inPeriod = new Set(days);
    const header = [
        'day',
        'project',
        'tasks',
        'cpuSeconds',
        'mediaSeconds',
        'bytesIn',
        'bytesOut',
        'bytesStored',
    ];
    const rows = lines
        .filter((line) => inPeriod.has(line.day))
        .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project))
        .map((line) =>
            [
                line.day,
                line.project,
                line.tasks,
                line.cpuSeconds,
                line.mediaSeconds,
                line.bytesIn,
                line.bytesOut,
                line.bytesStored,
            ].join(','),
        );
    return `${[header.join(','), ...rows].join('\n')}\n`;
}
