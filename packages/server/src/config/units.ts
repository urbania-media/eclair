const DURATION_UNITS: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

const SIZE_UNITS: Record<string, number> = {
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
};

/** Matches a duration such as `500ms`, `30s`, `10m`, `1h` or `7d`. */
export const DURATION_PATTERN = '^[0-9]+(\\.[0-9]+)?(ms|s|m|h|d)$';

/** Matches a size such as `512KB`, `2GB` or `1.5GiB`, case-insensitive. */
export const SIZE_PATTERN = '^[0-9]+(\\.[0-9]+)?\\s*([KkMmGgTt][Ii]?)?[Bb]$';

/** Parses a duration (`1h`, `7d`, `500ms`) into milliseconds. */
export function parseDuration(value: string): number {
    const match = new RegExp(DURATION_PATTERN).exec(value.trim());
    const unit = match?.[2];
    if (match === null || unit === undefined) {
        throw new Error(
            `"${value}" is not a duration: use a number and ms, s, m, h or d (1h, 7d).`,
        );
    }
    return Math.round(Number.parseFloat(value) * (DURATION_UNITS[unit] ?? 1));
}

/** Parses a size (`2GB`, `512KB`) into bytes. KB, MB, GB and TB are multiples of 1024. */
export function parseSize(value: string): number {
    const match = new RegExp(SIZE_PATTERN).exec(value.trim());
    if (match === null) {
        throw new Error(`"${value}" is not a size: use a number and B, KB, MB, GB or TB (2GB).`);
    }
    const unit = `${match[2] ?? ''}b`.toLowerCase();
    return Math.round(Number.parseFloat(value) * (SIZE_UNITS[unit] ?? 1));
}
