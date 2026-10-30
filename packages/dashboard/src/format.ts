import type { IntlShape } from 'react-intl';

/**
 * A duration in milliseconds, without the empty units: `1 h 02 min`, `3 min 10 s`, `1.4 s`, `40 ms`.
 */
export function formatDuration(intl: IntlShape, milliseconds: number): string {
    if (milliseconds < 1000) {
        return `${intl.formatNumber(Math.round(milliseconds))} ms`;
    }
    if (milliseconds < 10_000) {
        return `${intl.formatNumber(milliseconds / 1000, { maximumFractionDigits: 1 })} s`;
    }
    const seconds = Math.round(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) {
        return `${intl.formatNumber(hours)} h ${String(minutes).padStart(2, '0')} min`;
    }
    return minutes > 0 ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${rest} s`;
}

/** How long ago a date was: `8 minutes ago`, `il y a 2 heures`. */
export function formatAgo(intl: IntlShape, date: string | Date, now = Date.now()): string {
    const seconds = Math.round((new Date(date).getTime() - now) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 86_400],
        ['hour', 3600],
        ['minute', 60],
    ];
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return intl.formatRelativeTime(Math.round(seconds / size), unit, { numeric: 'auto' });
        }
    }
    return intl.formatRelativeTime(seconds, 'second', { numeric: 'auto' });
}

/** Bytes in the largest unit under a thousand of it: `742 MB`, `1.9 TB`. */
export function formatBytes(intl: IntlShape, bytes: number): string {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
    let value = bytes;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index += 1;
    }
    return intl.formatNumber(value, {
        style: 'unit',
        unit: units[index],
        maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
    });
}
