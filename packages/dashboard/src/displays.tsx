import type { DisplayProps } from '@panneau/lists';
import { EmptyValue } from '@panneau/lists';
import { Badge, type BadgeTone } from '@panneau/ui';
import { useIntl } from 'react-intl';

const TONES: Record<string, BadgeTone> = {
    active: 'success',
    disabled: 'neutral',
    revoked: 'neutral',
};

/**
 * A status as a badge in its tone: the badges of `select` displays have no tone per option,
 * https://github.com/folkloreinc/panneau-js/issues/144
 */
export function StatusDisplay({ value, field }: DisplayProps) {
    if (typeof value !== 'string' || value === '') {
        return <EmptyValue />;
    }
    const label = field?.options?.find((option) => option.value === value)?.label ?? value;
    return <Badge tone={TONES[value] ?? 'neutral'}>{label}</Badge>;
}

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
