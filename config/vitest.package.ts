import { basename } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

/**
 * Shared Vitest config of the `@eclair-js/*` packages. Imports between packages resolve to their
 * TypeScript sources (the `@eclair-js/source` export condition), so tests don't need a build.
 */
export function definePackageConfig(root: string): ViteUserConfig {
    return defineConfig({
        root,
        resolve: {
            conditions: ['@eclair-js/source'],
        },
        ssr: {
            resolve: {
                conditions: ['@eclair-js/source'],
            },
        },
        test: {
            name: basename(root),
            environment: 'node',
            include: ['src/**/*.test.ts'],
        },
    });
}
