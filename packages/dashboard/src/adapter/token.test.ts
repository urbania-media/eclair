import { describe, expect, it, vi } from 'vitest';

import { MemoryStorage } from '../testing/fetch.ts';
import { createTokenStore } from './token.ts';

describe('createTokenStore', () => {
    it('keeps the token in the storage, and tells its listeners', () => {
        const storage = new MemoryStorage();
        const tokens = createTokenStore(storage);
        const listener = vi.fn();
        const unsubscribe = tokens.subscribe(listener);
        expect(tokens.get()).toBeNull();
        tokens.set('secret');
        expect(storage.getItem('eclair.adminToken')).toBe('secret');
        expect(createTokenStore(storage).get()).toBe('secret');
        tokens.clear();
        expect(tokens.get()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);
        // Clearing nothing changes nothing
        tokens.clear();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        tokens.set('again');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('keeps the token in memory when the storage throws', () => {
        const storage = new MemoryStorage();
        storage.getItem = () => {
            throw new Error('Refused');
        };
        storage.setItem = storage.getItem;
        storage.removeItem = storage.getItem;
        const tokens = createTokenStore(storage);
        tokens.set('secret');
        expect(tokens.get()).toBe('secret');
        tokens.clear();
        expect(tokens.get()).toBeNull();
    });

    it('keeps the token in memory without a storage', () => {
        const tokens = createTokenStore(null);
        tokens.set('secret');
        expect(tokens.get()).toBe('secret');
    });
});
