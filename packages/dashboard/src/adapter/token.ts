/**
 * Where the admin token is kept: `sessionStorage`, so it lasts as long as the tab (decision 0021).
 * The app watches it: signing out, or the server refusing the token, shows the login page.
 */
export interface TokenStore {
    get(): string | null;
    set(token: string): void;
    clear(): void;
    subscribe(listener: () => void): () => void;
}

const KEY = 'eclair.adminToken';

/**
 * A token store on a `Storage`, `sessionStorage` by default. A storage that throws (a browser that
 * refuses it) keeps the token in memory instead, until the page is reloaded.
 */
export function createTokenStore(
    storage: Storage | null = globalThis.sessionStorage ?? null,
): TokenStore {
    let memory: string | null = null;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    const read = () => {
        try {
            return storage?.getItem(KEY) ?? memory;
        } catch {
            return memory;
        }
    };
    return {
        get: read,
        set(token) {
            memory = token;
            try {
                storage?.setItem(KEY, token);
            } catch {
                // Kept in memory
            }
            notify();
        },
        clear() {
            const had = read() !== null;
            memory = null;
            try {
                storage?.removeItem(KEY);
            } catch {
                // Nothing stored
            }
            if (had) {
                notify();
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
