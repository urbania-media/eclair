import type { Item, ListQuery, ListResponse } from '@panneau/protocol';

/** The page size of lists that don't say. */
export const PER_PAGE = 20;

function text(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return Array.isArray(value) ? value.map(text).join(' ') : String(value);
}

function compare(left: unknown, right: unknown, collator: Intl.Collator): number {
    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }
    if (left === null || left === undefined) {
        return right === null || right === undefined ? 0 : 1;
    }
    if (right === null || right === undefined) {
        return -1;
    }
    return collator.compare(text(left), text(right));
}

/**
 * A page of items that the admin API answers whole (projects, keys, storages, presets): filters
 * (equal values), search, sort and page applied here, as a backend would. `applyListQuery()` of
 * `@panneau/lists` does the same, but brings React and CSS into the adapter.
 */
export function pageOf<T extends Item>(items: readonly T[], query: ListQuery): ListResponse {
    const perPage = query.perPage ?? PER_PAGE;
    const page = query.page ?? 1;
    let result = [...items];
    Object.entries(query.filter ?? {}).forEach(([key, expected]) => {
        if (
            expected === undefined ||
            expected === null ||
            (typeof expected === 'object' && !Array.isArray(expected))
        ) {
            return;
        }
        const accepted = (Array.isArray(expected) ? expected : [expected]).map(String);
        result = result.filter((item) => {
            const value = item[key];
            return (Array.isArray(value) ? value : [value]).some((entry) =>
                accepted.includes(String(entry)),
            );
        });
    });
    const q = query.q?.trim().toLowerCase() ?? '';
    if (q !== '') {
        result = result.filter((item) =>
            Object.entries(item).some(
                ([key, value]) =>
                    !['id', 'version', 'abilities'].includes(key) &&
                    text(value).toLowerCase().includes(q),
            ),
        );
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sort = query.sort ?? [];
    if (sort.length > 0) {
        result.sort((a, b) => {
            for (const part of sort) {
                const key = part.replace(/^-/, '');
                const order = compare(a[key], b[key], collator);
                if (order !== 0) {
                    return part.startsWith('-') ? -order : order;
                }
            }
            return 0;
        });
    }
    const total = result.length;
    return {
        data: result.slice((page - 1) * perPage, page * perPage),
        meta: { page, perPage, total, lastPage: Math.max(1, Math.ceil(total / perPage)) },
    };
}

/** The ids an action targets: Eclair's actions are on items, never on a query. */
export function selectedIds(request: { selection?: unknown }): string[] {
    const selection = request.selection as { ids?: unknown } | undefined;
    return Array.isArray(selection?.ids) ? selection.ids.map(String) : [];
}

/** The value of a filter, as one string. */
export function filterValue(query: ListQuery, id: string): string | undefined {
    const value = query.filter?.[id];
    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]) : undefined;
    }
    return value === undefined || value === null || value === '' || typeof value === 'object'
        ? undefined
        : String(value);
}

/** Runs an action on each item, and counts what failed. */
export async function forEachItem(ids: readonly string[], run: (id: string) => Promise<unknown>) {
    const outcomes = await Promise.allSettled(ids.map(run));
    const results = outcomes.flatMap((outcome, index) =>
        outcome.status === 'rejected'
            ? [
                  {
                      id: ids[index] ?? '',
                      status: 'failed' as const,
                      message:
                          outcome.reason instanceof Error
                              ? outcome.reason.message
                              : String(outcome.reason),
                  },
              ]
            : [],
    );
    return {
        summary: { succeeded: ids.length - results.length, failed: results.length, skipped: 0 },
        results,
        refresh: 'items' as const,
    };
}
