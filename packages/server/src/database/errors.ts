/**
 * Whether an error is a violation of a unique constraint, on any of the three databases:
 * PostgreSQL `23505`, MySQL `ER_DUP_ENTRY`, SQLite `SQLITE_CONSTRAINT_UNIQUE` (2067) or
 * `SQLITE_CONSTRAINT_PRIMARYKEY` (1555).
 */
export function isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    const { code, errcode } = error as { code?: unknown; errcode?: unknown };
    return code === '23505' || code === 'ER_DUP_ENTRY' || errcode === 2067 || errcode === 1555;
}
