/**
 * Reads values that the three databases return differently, so that the rest of the server sees
 * the same types everywhere (decisions 0014 and 0016):
 *
 * - dates: a `Date` from MySQL and PostgreSQL, ISO 8601 text from SQLite;
 * - JSON: parsed by the MySQL and PostgreSQL drivers, text from SQLite;
 * - booleans: `true`/`false` from PostgreSQL, 0/1 from MySQL and SQLite;
 * - big integers: a string from PostgreSQL (`bigint`), a number from the others.
 *
 * Writes need fewer helpers: dates and booleans are written as `Date` and `boolean`, and the SQLite
 * adapter converts them. JSON is always written with `toJson()`, because the PostgreSQL driver
 * would write a JavaScript array as a PostgreSQL array.
 */

export function readDate(value: unknown): Date {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }
    }
    throw new TypeError(`Expected a date, got ${typeof value}.`);
}

export function readOptionalDate(value: unknown): Date | undefined {
    return value === null || value === undefined ? undefined : readDate(value);
}

/**
 * Reads a JSON column. JSON columns only ever hold objects and arrays, so a string is the text of
 * the JSON (SQLite), never a JSON string.
 */
export function readJson<T>(value: unknown): T {
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export function readOptionalJson<T>(value: unknown): T | undefined {
    return value === null || value === undefined ? undefined : readJson<T>(value);
}

export function readBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 1n;
}

export function readNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`Expected a number, got ${typeof value}.`);
    }
    return number;
}

export function readOptionalNumber(value: unknown): number | undefined {
    return value === null || value === undefined ? undefined : readNumber(value);
}

/** Writes a JSON column. */
export function toJson(value: unknown): string {
    return JSON.stringify(value);
}
