import { Type } from 'typebox';

import { OperationError, defineEmbedProvider } from '@eclair-js/operation';
import type { EmbedOperationContext } from '@eclair-js/operation';
import type { ProbeMetadata } from '@eclair-js/protocol';

import {
    hostIn,
    httpsUrl,
    objectAt,
    positive,
    probeMetadata,
    requestJson,
    segments,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'Spotify';
const ID = /^[A-Za-z0-9]{22}$/;
/** Tracks and podcast episodes: albums, playlists and shows are lists, not one media. */
const TYPES = new Set(['track', 'episode']);

function parse(url: URL): { type: string; id: string } | undefined {
    if (!hostIn(url, ['open.spotify.com'])) {
        return undefined;
    }
    const parts = segments(url);
    // Localized pages: /intl-fr/track/<id>.
    const [type, id] = parts[0]?.startsWith('intl-') === true ? parts.slice(1) : parts;
    return type !== undefined && TYPES.has(type) && id !== undefined && ID.test(id)
        ? { type, id }
        : undefined;
}

export const provider = defineEmbedProvider({
    name: 'spotify',
    title: TITLE,
    match(url) {
        const parsed = parse(url);
        return parsed === undefined
            ? undefined
            : { id: parsed.id, url: `https://open.spotify.com/${parsed.type}/${parsed.id}` };
    },
    credentials: Type.Object(
        {
            clientId: Type.String({ minLength: 1, description: 'The client id of a Spotify app' }),
            clientSecret: Type.String({ minLength: 1, description: "The app's client secret" }),
        },
        { additionalProperties: false },
    ),
});

/** An app token of the client credentials flow, cached until it expires. */
async function accessToken(
    context: EmbedOperationContext,
    clientId: string,
    clientSecret: string,
): Promise<string> {
    const key = `token:${clientId}`;
    const cached = await context.cache.get(key);
    if (typeof cached === 'string') {
        return cached;
    }
    const body = await requestJson(
        context,
        TITLE,
        'https://accounts.spotify.com/api/token',
        {
            method: 'POST',
            headers: {
                authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        },
        (response) =>
            Promise.resolve(
                response.status === 400 || response.status === 401
                    ? new OperationError(
                          'provider_failed',
                          'Spotify refused the client credentials: check the credentials of the project.',
                      )
                    : undefined,
            ),
    );
    const token = string(body['access_token']);
    if (token === undefined) {
        throw new OperationError('provider_failed', 'Spotify gave no access token.');
    }
    await context.cache.set(key, token, Math.max(60, (positive(body['expires_in']) ?? 3600) - 60));
    return token;
}

/** A day of a release date, as `YYYY-MM-DD`, in ISO 8601: Spotify gives only a year sometimes. */
function releaseDate(value: unknown): string | undefined {
    const date = string(value);
    return date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : undefined;
}

/** The largest image of a list. */
function largestImage(images: unknown): string | undefined {
    const list = Array.isArray(images) ? (images as Record<string, unknown>[]) : [];
    const largest = list.reduce<Record<string, unknown> | undefined>(
        (best, image) =>
            (positive(image['width']) ?? 0) > (positive(best?.['width']) ?? 0) ? image : best,
        undefined,
    );
    return httpsUrl(largest?.['url'] ?? list[0]?.['url']);
}

/** What the Web API adds to oEmbed: the duration, the author and the release date. */
async function details(
    context: EmbedOperationContext,
    type: string,
    clientId: string,
    clientSecret: string,
): Promise<
    Partial<ProbeMetadata> & {
        author?: Record<string, unknown>;
        publishedAt?: string;
        description?: string;
        thumbnailUrl?: string;
    }
> {
    const token = await accessToken(context, clientId, clientSecret);
    const body = await requestJson(
        context,
        TITLE,
        type === 'episode'
            ? // Episodes need a market with app tokens; the US one has the most.
              withQuery(`https://api.spotify.com/v1/episodes/${context.input.id}`, { market: 'US' })
            : `https://api.spotify.com/v1/tracks/${context.input.id}`,
        { headers: { authorization: `Bearer ${token}` } },
    );
    const duration = positive(body['duration_ms']);
    if (type === 'episode') {
        const show = objectAt(body, 'show');
        return {
            duration: duration === undefined ? undefined : duration / 1000,
            description: string(body['description']),
            author: {
                id: string(show['id']),
                name: string(show['name']),
                url: httpsUrl(objectAt(show, 'external_urls')['spotify']),
            },
            thumbnailUrl: largestImage(body['images']),
            publishedAt: releaseDate(body['release_date']),
        };
    }
    const [artist] = Array.isArray(body['artists'])
        ? (body['artists'] as Record<string, unknown>[])
        : [];
    const album = objectAt(body, 'album');
    return {
        duration: duration === undefined ? undefined : duration / 1000,
        author: {
            id: string(artist?.['id']),
            name: string(artist?.['name']),
            url: httpsUrl(objectAt(artist, 'external_urls')['spotify']),
        },
        thumbnailUrl: largestImage(album['images']),
        publishedAt: releaseDate(album['release_date']),
    };
}

/** oEmbed for the player, and the Web API with the project's app for the rest. */
export const spotify: ProviderModule = {
    provider,
    async probe(context) {
        const { id, url } = context.input;
        const [type = 'track'] = segments(new URL(url));
        const body = await requestJson(
            context,
            TITLE,
            withQuery('https://open.spotify.com/oembed', { url }),
        );
        const clientId = context.credentials?.['clientId'];
        const clientSecret = context.credentials?.['clientSecret'];
        const more =
            clientId === undefined || clientSecret === undefined
                ? {}
                : await details(context, type, clientId, clientSecret);
        return probeMetadata({
            kind: 'audio',
            duration: more.duration,
            embed: {
                provider: 'spotify',
                id,
                url,
                embedUrl:
                    httpsUrl(body['iframe_url']) ?? `https://open.spotify.com/embed/${type}/${id}`,
                title: string(body['title']),
                description: more.description,
                author: more.author,
                thumbnailUrl: more.thumbnailUrl ?? httpsUrl(body['thumbnail_url']),
                publishedAt: more.publishedAt,
                embeddable: true,
                html: string(body['html']),
            },
        });
    },
};
