import type { Redis } from 'ioredis';

import { OperationError } from '@eclair-js/operation';
import type { HttpRequestOptions, HttpResponse, OperationCache } from '@eclair-js/operation';

import { BlockedUrlError, guardedRequest } from '../net/ssrf.ts';
import type { GuardOptions } from '../net/ssrf.ts';
import { REDIS_PREFIX } from '../redis.ts';

/** Largest body of a provider's answer. */
const MAX_BODY = 2 * 1024 * 1024;

/** Longest a value stays in an operation's cache, whatever the operation asks: a day. */
const MAX_TTL = 24 * 60 * 60;

/** Builds the cache of an operation for a project. */
export type OperationCacheFactory = (projectId: string, operation: string) => OperationCache;

/** A cache that keeps nothing, without Redis. */
export const NO_CACHE: OperationCache = {
    get: () => Promise.resolve(undefined),
    set: () => Promise.resolve(),
};

/**
 * Caches of operations in Redis, under the project and the operation (rule 3 of AGENTS.md). A
 * failure of Redis reads as a miss: the cache only saves requests to providers.
 */
export function redisOperationCache(redis: Redis): OperationCacheFactory {
    return (projectId, operation) => {
        const prefix = `${REDIS_PREFIX}:cache:${projectId}:${operation}:`;
        return {
            async get(key) {
                try {
                    const value = await redis.get(prefix + key);
                    return value === null ? undefined : (JSON.parse(value) as unknown);
                } catch {
                    return undefined;
                }
            },
            async set(key, value, ttl) {
                const seconds = Math.max(1, Math.min(MAX_TTL, Math.round(ttl)));
                try {
                    await redis.set(prefix + key, JSON.stringify(value), 'EX', seconds);
                } catch {
                    // A cache that can't write only costs another request later.
                }
            },
        };
    };
}

/** Reads a body up to `MAX_BODY` bytes. */
async function readBody(body: AsyncIterable<Buffer | Uint8Array>): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
        size += chunk.length;
        if (size > MAX_BODY) {
            throw new OperationError(
                'provider_failed',
                `The provider answered more than ${MAX_BODY} bytes.`,
            );
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * The `http()` of an embed operation: requests to providers through the SSRF guard, with a
 * timeout and the task's abort signal. A network failure is `provider_failed`.
 */
export function operationHttp(
    signal: AbortSignal,
    guard: Pick<GuardOptions, 'allowHttp' | 'allowPrivateAddresses'> | undefined,
): (url: string, options?: HttpRequestOptions) => Promise<HttpResponse> {
    return async (url, options = {}) => {
        const timeout = options.timeout ?? 10_000;
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
        let response;
        try {
            response = await guardedRequest(url, {
                ...guard,
                method: options.method ?? 'GET',
                headers: { 'user-agent': 'Eclair', ...options.headers },
                ...(options.body === undefined ? {} : { body: options.body }),
                signal: requestSignal,
                headersTimeout: timeout,
                bodyTimeout: timeout,
                maxRedirects: 3,
            });
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            const host = URL.canParse(url) ? new URL(url).host : 'the provider';
            throw new OperationError(
                'provider_failed',
                error instanceof BlockedUrlError
                    ? error.message
                    : `Could not reach ${host}: ${(error as Error).message}`,
                { cause: error },
            );
        }
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
                headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            }
        }
        let text: Promise<string> | undefined;
        const read = () => (text ??= readBody(response.body));
        return {
            status: response.statusCode,
            headers,
            text: read,
            json: async () => {
                const body = await read();
                try {
                    return JSON.parse(body) as unknown;
                } catch (error) {
                    throw new OperationError(
                        'provider_failed',
                        `${new URL(url).host} didn't answer JSON.`,
                        { cause: error },
                    );
                }
            },
        };
    };
}
