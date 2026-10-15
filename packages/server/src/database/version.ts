import type { Dialect } from './dialect.ts';

/** Oldest supported server versions, as `[major, minor]` (see decision 0007). */
export const MINIMUM_VERSIONS: Record<Dialect, readonly [number, number]> = {
    mysql: [8, 4],
    postgres: [15, 0],
    // JSON functions are built in from 3.38. Node 24 bundles a later version.
    sqlite: [3, 38],
};

export interface ServerVersion {
    major: number;
    minor: number;
}

/**
 * Parses the version a database server reports: `8.4.3` for MySQL, `15.10 (Debian …)` for
 * PostgreSQL, `3.50.4` for SQLite. Returns `undefined` for MariaDB, which isn't supported, and for unknown formats.
 */
export function parseServerVersion(version: string): ServerVersion | undefined {
    if (/mariadb/i.test(version)) {
        return undefined;
    }
    const match = /^(\d+)\.(\d+)/.exec(version);
    if (match === null) {
        return undefined;
    }
    return { major: Number(match[1]), minor: Number(match[2]) };
}

export function isSupportedVersion(dialect: Dialect, version: string): boolean {
    const parsed = parseServerVersion(version);
    if (parsed === undefined) {
        return false;
    }
    const [major, minor] = MINIMUM_VERSIONS[dialect];
    return parsed.major > major || (parsed.major === major && parsed.minor >= minor);
}
