import { OperationError } from '@eclair-js/operation';
import type {
    EmbedOperationContext,
    EmbedProvider,
    HttpRequestOptions,
    HttpResponse,
} from '@eclair-js/operation';
import type { EmbedMetadata, ProbeMetadata } from '@eclair-js/protocol';

/** The options of `embed.download`. */
export interface DownloadRequest {
    /** `best`, or the largest height to download. */
    quality: 'best' | number;
    audioOnly: boolean;
}

/** A provider of the plugin: what the server matches, how `embed.probe` reads it, and how `embed.download` downloads it when it can. */
export interface ProviderModule {
    provider: EmbedProvider;
    probe(context: EmbedOperationContext): Promise<ProbeMetadata>;
    /**
     * Downloads the embed's file to the work directory and declares it as an output. Returns the
     * metadata of what it downloaded.
     */
    download?(
        context: EmbedOperationContext,
        request: DownloadRequest,
    ): Promise<Record<string, unknown>>;
}

/** The hosts of a provider, with and without `www.`, in lowercase. */
export function hostIn(url: URL, hosts: readonly string[]): boolean {
    return url.protocol === 'https:' && hosts.includes(url.hostname.toLowerCase());
}

/** The path's segments, without empty ones: `/a//b/` is `['a', 'b']`. */
export function segments(url: URL): string[] {
    return url.pathname.split('/').filter((segment) => segment !== '');
}

/** What an embed's metadata is, without the fields a provider didn't give. */
export function probeMetadata(
    fields: Omit<ProbeMetadata, 'mime' | 'embed'> & { embed: EmbedMetadata },
): ProbeMetadata {
    return removeUndefined({ ...fields, mime: 'text/html' }) as ProbeMetadata;
}

/** A copy without `undefined`, empty strings and empty objects, deeply. */
export function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (
            child === undefined ||
            child === '' ||
            (typeof child === 'number' && Number.isNaN(child))
        ) {
            continue;
        }
        if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
            const nested = removeUndefined(child as Record<string, unknown>);
            if (Object.keys(nested).length > 0) {
                result[key] = nested;
            }
            continue;
        }
        result[key] = child;
    }
    return result;
}

/** A positive number from a number or a numeric string, or `undefined`. */
export function positive(value: unknown): number | undefined {
    const number = typeof value === 'string' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

/** A string, or `undefined` for anything else. */
export function string(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** An `https` URL, or `undefined`. Protocol-relative URLs (`//host/…`) are read as `https`. */
export function httpsUrl(value: unknown): string | undefined {
    const text = string(value);
    if (text === undefined) {
        return undefined;
    }
    const absolute = text.startsWith('//') ? `https:${text}` : text;
    return URL.canParse(absolute) && new URL(absolute).protocol === 'https:' ? absolute : undefined;
}

/** An ISO 8601 date and time in UTC, from a date or seconds since the epoch. */
export function isoDate(value: unknown): string | undefined {
    const date =
        typeof value === 'number'
            ? new Date(value * 1000)
            : typeof value === 'string'
              ? new Date(value)
              : undefined;
    return date === undefined || Number.isNaN(date.getTime())
        ? undefined
        : date.toISOString().replace(/\.000Z$/, 'Z');
}

/** Seconds of an ISO 8601 duration (`PT1H2M3S`, `P1DT2H`), or `undefined`. */
export function isoDuration(value: unknown): number | undefined {
    const match =
        typeof value === 'string'
            ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
            : null;
    if (match === null) {
        return undefined;
    }
    const [, days, hours, minutes, seconds] = match;
    return positive(
        Number(days ?? 0) * 86_400 +
            Number(hours ?? 0) * 3600 +
            Number(minutes ?? 0) * 60 +
            Number(seconds ?? 0),
    );
}

/** The `src` of the first `iframe` of an oEmbed's HTML. */
export function iframeSource(html: unknown): string | undefined {
    const match = typeof html === 'string' ? /<iframe[^>]*\ssrc="([^"]+)"/i.exec(html) : null;
    return httpsUrl(match?.[1]?.replaceAll('&amp;', '&'));
}

/**
 * Fails the task for a provider's error status: a missing or private embed is
 * `provider_unavailable`, a refusal of the server is `provider_refused`, anything else
 * `provider_failed`.
 */
export function statusError(title: string, status: number): OperationError {
    if (status === 404 || status === 410) {
        return new OperationError('provider_unavailable', `${title} has no such video or audio.`);
    }
    if (status === 401 || status === 403) {
        return new OperationError(
            'provider_unavailable',
            `${title} doesn't let other sites read it: it is private, or can't be embedded.`,
        );
    }
    if (status === 429) {
        return new OperationError('provider_refused', `${title} limits the server's requests.`);
    }
    return new OperationError('provider_failed', `${title} answered ${status}.`);
}

/** Sends a request and reads its JSON, failing the task when the status isn't 200. */
export async function requestJson(
    context: EmbedOperationContext,
    title: string,
    url: string,
    options?: HttpRequestOptions,
    onError?: (response: HttpResponse) => Promise<OperationError | undefined>,
): Promise<Record<string, unknown>> {
    const response = await context.http(url, options);
    if (response.status !== 200) {
        throw (await onError?.(response)) ?? statusError(title, response.status);
    }
    const body = await response.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new OperationError('provider_failed', `${title} didn't answer an object.`);
    }
    return body as Record<string, unknown>;
}

/** A nested object, or an empty one. */
export function objectAt(value: unknown, key: string): Record<string, unknown> {
    const child =
        typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)[key]
            : undefined;
    return typeof child === 'object' && child !== null && !Array.isArray(child)
        ? (child as Record<string, unknown>)
        : {};
}

/** The URL of a query: `base` with `params`, encoded. */
export function withQuery(base: string, params: Record<string, string>): string {
    const url = new URL(base);
    for (const [name, value] of Object.entries(params)) {
        url.searchParams.set(name, value);
    }
    return url.toString();
}
