import type { DisplayProps } from '@panneau/lists';
import { EmptyValue } from '@panneau/lists';
import { Badge } from '@panneau/ui';
import { useIntl } from 'react-intl';

import styles from './displays.module.css';
import { flattenMetadata, shorten } from './metadata.ts';
import { TONES } from './tones.ts';

/** A value as code: a key's prefix, a storage's location, the operations of a preset. */
export function CodeDisplay({ value }: DisplayProps) {
    if (value === null || value === undefined || value === '') {
        return <EmptyValue />;
    }
    return <code>{String(value)}</code>;
}

/** Seconds as hours and minutes: `133 h 40 min`. */
export function HoursDisplay({ value }: DisplayProps) {
    const intl = useIntl();
    if (typeof value !== 'number') {
        return <EmptyValue />;
    }
    return <span>{formatHours(intl.formatNumber, value)}</span>;
}

export function formatHours(formatNumber: (value: number) => string, seconds: number): string {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0
        ? `${formatNumber(hours)} h ${String(minutes % 60).padStart(2, '0')} min`
        : `${minutes} min`;
}

/** The tasks of a job that are done, out of all: a bar and `2 / 4`. */
export function TasksDisplay({ value }: DisplayProps) {
    const tasks = value as { done?: number; total?: number; failed?: boolean } | null;
    if (tasks === null || typeof tasks.total !== 'number' || tasks.total === 0) {
        return <EmptyValue />;
    }
    const done = tasks.done ?? 0;
    return (
        <span className={styles.tasks}>
            <span className={styles.track} aria-hidden="true">
                <span
                    className={tasks.failed === true ? styles.barFailed : styles.bar}
                    style={{ width: `${(done / tasks.total) * 100}%` }}
                />
            </span>
            <span className={styles.count}>
                {done} / {tasks.total}
            </span>
        </span>
    );
}

/** How a project's webhooks went over 24 hours. */
export function WebhooksDisplay({ value }: DisplayProps) {
    const intl = useIntl();
    if (typeof value !== 'string') {
        return <EmptyValue />;
    }
    return (
        <Badge tone={TONES[value] ?? 'neutral'}>
            {intl.formatMessage({ id: `webhooks.${value}` })}
        </Badge>
    );
}

/** At most this many entries of metadata in a list: the rest is counted. */
const METADATA_SHOWN = 3;

/**
 * A job's metadata in a list: one line per entry, nested objects as dot paths, long values
 * shortened in their middle, at most three lines. The whole value is in each line's title.
 */
export function MetadataDisplay({ value }: DisplayProps) {
    const entries = flattenMetadata(value);
    if (entries.length === 0) {
        return <EmptyValue />;
    }
    const rest = entries.length - METADATA_SHOWN;
    return (
        <span className={styles.metadata}>
            {entries.slice(0, METADATA_SHOWN).map(([key, text]) => (
                <span key={key} className={styles.entry} title={`${key}: ${text}`}>
                    <span className={styles.key}>{key}</span> <code>{shorten(text)}</code>
                </span>
            ))}
            {rest > 0 ? <span className={styles.key}>+{rest}</span> : null}
        </span>
    );
}
