import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { problems } from './problem.ts';

/**
 * The one inline style of the dashboard: React Aria adds a `<style>` for `touch-action` on
 * pressable elements. Its hash allows it, rather than `'unsafe-inline'`. A test checks it against
 * the installed React Aria. The dashboard sets no theme: a theme's `<style>` elements would need a
 * nonce, which Panneau takes since 5.0.0-alpha.9 (`nonce` of `<Panneau>`).
 */
export const REACT_ARIA_STYLE_HASH = 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=';

/**
 * The Content Security Policy of the dashboard: its own scripts, styles and images only, and
 * requests to its own origin, the admin API.
 */
export const DASHBOARD_CSP = [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' '${REACT_ARIA_STYLE_HASH}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

const HEADERS = {
    'content-security-policy': DASHBOARD_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

export interface StaticFile {
    body: Buffer;
    type: string;
    etag: string;
}

async function listFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** Reads the built dashboard once: a few files, served from memory. */
export async function loadDashboard(root: string): Promise<Map<string, StaticFile>> {
    const files = new Map<string, StaticFile>();
    for (const path of await listFiles(root)) {
        const type = TYPES[extname(path)];
        if (type === undefined) {
            continue;
        }
        const body = await readFile(join(root, path));
        // With the policy: a browser that revalidates the page gets a new policy with it.
        const etag = `"${createHash('sha256').update(body).update(DASHBOARD_CSP).digest('base64url').slice(0, 27)}"`;
        files.set(path, { body, type, etag });
    }
    if (!files.has('index.html')) {
        throw new Error(`The dashboard in ${root} has no index.html: build it first.`);
    }
    return files;
}

export interface DashboardOptions {
    /** The built dashboard: `dist/app` of `@eclair-js/dashboard`. */
    files: Map<string, StaticFile>;
}

/**
 * `/dashboard/`: the operations dashboard (decision 0021), a static app on the admin API. Its
 * assets have hashed names and are cached for good; any other path is the app's page, whose
 * routes are in the browser. Every response has a strict Content Security Policy.
 */
export async function dashboardRoutes(
    app: FastifyInstance,
    { files }: DashboardOptions,
): Promise<void> {
    const send = (
        request: FastifyRequest,
        reply: FastifyReply,
        file: StaticFile,
        cache: string,
    ) => {
        reply.headers({ ...HEADERS, 'cache-control': cache, etag: file.etag });
        if (request.headers['if-none-match'] === file.etag) {
            return reply.code(304).send();
        }
        return reply.type(file.type).send(file.body);
    };

    app.get('/dashboard', async (_request, reply) => reply.redirect('/dashboard/', 308));

    app.get('/dashboard/*', async (request, reply) => {
        const path = (request.params as { '*': string })['*'];
        const file = files.get(path);
        if (file !== undefined && path !== 'index.html') {
            // Vite names assets by their content.
            return send(
                request,
                reply,
                file,
                path.startsWith('assets/')
                    ? 'public, max-age=31536000, immutable'
                    : 'public, max-age=3600',
            );
        }
        // A missing asset is a 404, not the page: a script that is HTML only hides the error.
        if (path.startsWith('assets/') || extname(path) !== '') {
            throw problems.notFound(`No file ${path} in the dashboard.`);
        }
        const index = files.get('index.html');
        if (index === undefined) {
            throw problems.notFound('The dashboard is not built.');
        }
        return send(request, reply, index, 'no-cache');
    });
}

/**
 * The built dashboard of the installed `@eclair-js/dashboard`, or `undefined` with a reason when
 * it can't be read (a checkout that didn't build it).
 */
export async function findDashboard(): Promise<
    { files: Map<string, StaticFile>; error?: undefined } | { files?: undefined; error: Error }
> {
    try {
        const manifest = fileURLToPath(import.meta.resolve('@eclair-js/dashboard/package.json'));
        return { files: await loadDashboard(join(dirname(manifest), 'dist', 'app')) };
    } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }
}
