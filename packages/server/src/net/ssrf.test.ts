import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    BlockedUrlError,
    checkUrl,
    guardedRequest,
    isAllowedHost,
    isPublicAddress,
} from './ssrf.ts';

describe('isPublicAddress', () => {
    it.each([
        ['8.8.8.8', true],
        ['2606:4700::1111', true],
        ['10.0.0.1', false],
        ['172.16.5.4', false],
        ['192.168.1.1', false],
        ['127.0.0.1', false],
        ['169.254.169.254', false],
        ['100.64.1.1', false],
        ['0.0.0.0', false],
        ['224.0.0.1', false],
        ['::1', false],
        ['::ffff:127.0.0.1', false],
        ['::ffff:8.8.8.8', true],
        ['fd00::1', false],
        ['fe80::1', false],
        ['64:ff9b::a00:1', false],
        ['not an address', false],
    ])('%s is public: %s', (address, expected) => {
        expect(isPublicAddress(address)).toBe(expected);
    });
});

describe('isAllowedHost', () => {
    it('matches exact hosts and subdomains of a wildcard', () => {
        const patterns = ['cdn.example.com', '*.niche.media'];
        expect(isAllowedHost('cdn.example.com', patterns)).toBe(true);
        expect(isAllowedHost('CDN.example.com.', patterns)).toBe(true);
        expect(isAllowedHost('files.niche.media', patterns)).toBe(true);
        expect(isAllowedHost('niche.media', patterns)).toBe(false);
        expect(isAllowedHost('evilniche.media', patterns)).toBe(false);
        expect(isAllowedHost('example.com', patterns)).toBe(false);
    });
});

describe('checkUrl', () => {
    it('only allows https, without credentials', () => {
        expect(() => checkUrl(new URL('https://example.com/a.mp4'))).not.toThrow();
        expect(() => checkUrl(new URL('http://example.com/a.mp4'))).toThrow(
            'Only https URLs are allowed.',
        );
        expect(() => checkUrl(new URL('file:///etc/passwd'))).toThrow(BlockedUrlError);
        expect(() => checkUrl(new URL('https://user:pass@example.com/a'))).toThrow(/credentials/);
    });

    it('refuses private literal addresses and hosts outside the allow-list', () => {
        expect(() => checkUrl(new URL('https://169.254.169.254/latest/meta-data'))).toThrow(
            '169.254.169.254 is not a public address.',
        );
        expect(() => checkUrl(new URL('https://[::1]/'))).toThrow(/not a public address/);
        expect(() =>
            checkUrl(new URL('https://other.com/a'), { allowedHosts: ['cdn.example.com'] }),
        ).toThrow("The project doesn't allow inputs from other.com.");
    });
});

describe('guardedRequest', () => {
    let server: Server;
    let base: string;

    beforeAll(async () => {
        server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            const hops = Number(url.searchParams.get('hops') ?? 0);
            if (url.pathname === '/redirect') {
                response.writeHead(302, {
                    location: hops > 0 ? `/redirect?hops=${hops - 1}` : '/file',
                });
                response.end();
            } else if (url.pathname === '/away') {
                response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
                response.end();
            } else {
                response.end('content');
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const local = { allowHttp: true, allowPrivateAddresses: true };

    it('follows redirects and gives the final URL', async () => {
        const response = await guardedRequest(`${base}/redirect?hops=2`, local);
        expect(response.statusCode).toBe(200);
        expect(await response.body.text()).toBe('content');
        expect(response.url.pathname).toBe('/file');
    });

    it('limits redirects', async () => {
        await expect(
            guardedRequest(`${base}/redirect?hops=10`, { ...local, maxRedirects: 3 }),
        ).rejects.toThrow('More than 3 redirects.');
    });

    it('checks every redirect again', async () => {
        // The first URL is allowed; the redirect goes to a host outside the allow-list.
        await expect(
            guardedRequest(`${base}/away`, { ...local, allowedHosts: ['127.0.0.1'] }),
        ).rejects.toThrow("The project doesn't allow inputs from 169.254.169.254.");
    });

    it('refuses a host that resolves to a private address when connecting', async () => {
        const port = (server.address() as AddressInfo).port;
        await expect(
            guardedRequest(`http://localhost:${port}/file`, { allowHttp: true }),
        ).rejects.toThrow("localhost doesn't resolve to a public address.");
    });
});
