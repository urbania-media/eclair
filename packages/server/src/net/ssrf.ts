import ipaddr from 'ipaddr.js';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';
import type { Dispatcher } from 'undici';

export interface GuardOptions {
    /**
     * Hosts that URLs may point to: `cdn.example.com`, or `*.example.com` for its subdomains. Any
     * public host when not set.
     */
    allowedHosts?: readonly string[] | undefined;
    /** Only for tests, against a local server. Never set from configuration. */
    allowPrivateAddresses?: boolean;
    /** Only for tests, against a local server. Never set from configuration. */
    allowHttp?: boolean;
}

/** A URL that the guard refuses. Its message can be shown to the client. */
export class BlockedUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BlockedUrlError';
    }
}

/**
 * Whether an address is a public unicast address. Private, loopback, link-local (cloud metadata),
 * carrier-grade NAT, multicast, reserved and translation ranges are not. An IPv4 address mapped in
 * IPv6 is checked as IPv4.
 */
export function isPublicAddress(address: string): boolean {
    if (!ipaddr.isValid(address)) {
        return false;
    }
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
        parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() === 'unicast';
}

/** Whether a host matches one of the patterns: exact, or `*.example.com` for its subdomains. */
export function isAllowedHost(host: string, patterns: readonly string[]): boolean {
    const hostname = host.toLowerCase().replace(/\.$/, '');
    return patterns.some((pattern) => {
        const normalized = pattern.toLowerCase();
        return normalized.startsWith('*.')
            ? hostname.endsWith(normalized.slice(1))
            : hostname === normalized;
    });
}

/** Checks a URL before connecting: scheme, credentials, allowed hosts and literal addresses. */
export function checkUrl(url: URL, options: GuardOptions = {}): void {
    const schemes = options.allowHttp === true ? ['https:', 'http:'] : ['https:'];
    if (!schemes.includes(url.protocol)) {
        throw new BlockedUrlError(
            `Only ${schemes.map((scheme) => scheme.slice(0, -1)).join(' and ')} URLs are allowed.`,
        );
    }
    if (url.username !== '' || url.password !== '') {
        throw new BlockedUrlError('URLs with credentials are not allowed: use a presigned URL.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (options.allowedHosts !== undefined && !isAllowedHost(host, options.allowedHosts)) {
        throw new BlockedUrlError(`The project doesn't allow inputs from ${host}.`);
    }
    if (isIP(host) !== 0 && options.allowPrivateAddresses !== true && !isPublicAddress(host)) {
        throw new BlockedUrlError(`${host} is not a public address.`);
    }
}

type LookupCallback = (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
) => void;

/**
 * A DNS lookup that only returns public addresses. Used when the connection opens, so a host that
 * resolves to a public address for the check and a private one for the connection (DNS rebinding)
 * is still refused.
 */
function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error !== null) {
            callback(error, []);
            return;
        }
        const allowed = addresses.filter(({ address }) => isPublicAddress(address));
        if (allowed.length === 0) {
            const blocked = new BlockedUrlError(
                `${hostname} doesn't resolve to a public address.`,
            ) as NodeJS.ErrnoException;
            blocked.code = 'EBLOCKED';
            callback(blocked, []);
            return;
        }
        if (options.all === true) {
            callback(null, allowed);
        } else {
            const [first] = allowed;
            callback(null, first?.address ?? '', first?.family);
        }
    });
}

let guardedAgent: Agent | undefined;

/** The agent that connects only to public addresses. */
function agentFor(options: GuardOptions): Dispatcher | undefined {
    if (options.allowPrivateAddresses === true) {
        return undefined;
    }
    guardedAgent ??= new Agent({ connect: { lookup: publicLookup as never } });
    return guardedAgent;
}

export interface GuardedRequestOptions extends GuardOptions {
    method?: 'GET' | 'HEAD';
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** Redirects followed, each checked again. */
    maxRedirects?: number;
    /** Milliseconds to wait for the response headers. */
    headersTimeout?: number;
}

/** The cause of a blocked connection, when undici wraps it. */
function blockedCause(error: unknown): BlockedUrlError | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
        if (current instanceof BlockedUrlError) {
            return current;
        }
        current = (current as { cause?: unknown }).cause;
    }
    return undefined;
}

/**
 * Sends a request to a URL that a client gave, through the guard: checks the URL, connects only
 * to public addresses, and follows redirects one by one, checking each. Throws a
 * `BlockedUrlError` when the URL or a redirect is refused.
 */
export async function guardedRequest(
    input: string,
    options: GuardedRequestOptions = {},
): Promise<Dispatcher.ResponseData & { url: URL }> {
    let url = new URL(input);
    const maxRedirects = options.maxRedirects ?? 5;
    for (let redirects = 0; ; redirects += 1) {
        checkUrl(url, options);
        let response: Dispatcher.ResponseData;
        try {
            response = await request(url, {
                method: options.method ?? 'GET',
                headers: options.headers ?? {},
                signal: options.signal,
                dispatcher: agentFor(options),
                headersTimeout: options.headersTimeout ?? 30_000,
            });
        } catch (error) {
            throw blockedCause(error) ?? error;
        }
        const location = response.headers['location'];
        if (response.statusCode >= 300 && response.statusCode < 400 && location !== undefined) {
            await response.body.dump();
            if (redirects >= maxRedirects) {
                throw new BlockedUrlError(`More than ${maxRedirects} redirects.`);
            }
            url = new URL(Array.isArray(location) ? (location[0] ?? '') : location, url);
            continue;
        }
        return Object.assign(response, { url });
    }
}
