/** A metadata value as text: strings as they are, other values as JSON. */
function toText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The entries of a job's metadata, nested objects flattened into dot paths:
 * `{ mediatheque: { media: "med_…" } }` is `[["mediatheque.media", "med_…"]]`. Arrays stay JSON.
 */
export function flattenMetadata(metadata: unknown, prefix = ''): [string, string][] {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return prefix === '' ? [] : [[prefix, toText(metadata)]];
    }
    return Object.entries(metadata).flatMap(([key, value]): [string, string][] => {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? flattenMetadata(value, path)
            : [[path, toText(value)]];
    });
}

/**
 * A long value shortened in its middle, so that ids keep their prefix and their end:
 * `run_01M66WR189DQ1YH99JP3W54FD1` is `run_01M66WR…4FD1`.
 */
export function shorten(value: string, max = 16): string {
    if (value.length <= max) {
        return value;
    }
    const end = 4;
    return `${value.slice(0, max - end - 1)}…${value.slice(-end)}`;
}
