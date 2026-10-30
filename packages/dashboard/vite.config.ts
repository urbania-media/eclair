import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// `npm run dev -w @eclair-js/dashboard` serves the dashboard at /dashboard/, against the admin API
// of a local Eclair (`ECLAIR_URL`, http://127.0.0.1:8080 by default).
const target = process.env.ECLAIR_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
    base: '/dashboard/',
    plugins: [react()],
    resolve: {
        conditions: ['@eclair-js/source', ...defaultClientConditions],
    },
    build: {
        outDir: 'dist/app',
        emptyOutDir: true,
        // No inline script or style in the built page: the API serves it with a strict CSP.
        assetsInlineLimit: 0,
        // Panneau is one chunk: the dashboard is a single app, loaded once per session.
        chunkSizeWarningLimit: 2000,
    },
    server: {
        proxy: {
            '/admin': target,
        },
    },
});
