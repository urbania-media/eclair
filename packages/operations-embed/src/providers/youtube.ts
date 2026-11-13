import { Type } from 'typebox';

import { OperationError, defineEmbedProvider } from '@eclair-js/operation';
import type { EmbedOperationContext } from '@eclair-js/operation';
import type { ProbeMetadata } from '@eclair-js/protocol';

import {
    hostIn,
    httpsUrl,
    isoDate,
    isoDuration,
    objectAt,
    positive,
    probeMetadata,
    requestJson,
    segments,
    statusError,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'YouTube';
const HOSTS = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
];
const ID = /^[A-Za-z0-9_-]{11}$/;
const PRIVACY = { public: 'public', unlisted: 'unlisted', private: 'private' } as const;

function idOf(url: URL): string | undefined {
    if (hostIn(url, ['youtu.be'])) {
        return segments(url)[0];
    }
    if (!hostIn(url, HOSTS)) {
        return undefined;
    }
    const [first, second] = segments(url);
    if (first === 'watch') {
        return url.searchParams.get('v') ?? undefined;
    }
    return first !== undefined && ['shorts', 'embed', 'live', 'v'].includes(first)
        ? second
        : undefined;
}

export const provider = defineEmbedProvider({
    name: 'youtube',
    title: TITLE,
    match(url) {
        const id = idOf(url);
        return id !== undefined && ID.test(id)
            ? { id, url: `https://www.youtube.com/watch?v=${id}` }
            : undefined;
    },
    credentials: Type.Object(
        { apiKey: Type.String({ minLength: 1, description: 'A YouTube Data API v3 key' }) },
        { additionalProperties: false },
    ),
});

/** The largest thumbnail of the Data API's list. */
function largestThumbnail(thumbnails: Record<string, unknown>): string | undefined {
    for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
        const url = httpsUrl(objectAt(thumbnails, size)['url']);
        if (url !== undefined) {
            return url;
        }
    }
    return undefined;
}

/** With a key: the Data API, which gives the duration, the channel and the privacy. */
async function probeWithApi(
    context: EmbedOperationContext,
    apiKey: string,
): Promise<ProbeMetadata> {
    const { id, url } = context.input;
    const body = await requestJson(
        context,
        TITLE,
        withQuery('https://www.googleapis.com/youtube/v3/videos', {
            part: 'snippet,contentDetails,status,player',
            id,
            maxWidth: '1920',
        }),
        // In a header rather than the URL, which logs and proxies may keep.
        { headers: { 'x-goog-api-key': apiKey } },
        async (response) => {
            const error = objectAt(await response.json().catch(() => ({})), 'error');
            const reasons = Array.isArray(error['errors'])
                ? (error['errors'] as { reason?: unknown }[]).map(({ reason }) => reason)
                : [];
            if (
                reasons.some(
                    (reason) => reason === 'quotaExceeded' || reason === 'rateLimitExceeded',
                )
            ) {
                return new OperationError(
                    'provider_refused',
                    "The project's YouTube Data API quota is exhausted for today.",
                );
            }
            if (response.status === 400 || response.status === 403) {
                return new OperationError(
                    'provider_failed',
                    'YouTube refused the API key: check the credentials of the project.',
                );
            }
            return undefined;
        },
    );
    const [item] = Array.isArray(body['items']) ? (body['items'] as unknown[]) : [];
    if (item === undefined) {
        throw new OperationError(
            'provider_unavailable',
            'YouTube has no such video, or it is private.',
        );
    }
    const snippet = objectAt(item, 'snippet');
    const status = objectAt(item, 'status');
    const player = objectAt(item, 'player');
    const channelId = string(snippet['channelId']);
    const privacy = string(status['privacyStatus']);
    return probeMetadata({
        kind: 'video',
        duration: isoDuration(objectAt(item, 'contentDetails')['duration']),
        width: positive(player['embedWidth']),
        height: positive(player['embedHeight']),
        embed: {
            provider: 'youtube',
            id,
            url,
            embedUrl: `https://www.youtube.com/embed/${id}`,
            title: string(snippet['title']),
            description: string(snippet['description']),
            author: {
                id: channelId,
                name: string(snippet['channelTitle']),
                url:
                    channelId === undefined
                        ? undefined
                        : `https://www.youtube.com/channel/${channelId}`,
            },
            thumbnailUrl: largestThumbnail(objectAt(snippet, 'thumbnails')),
            publishedAt: isoDate(snippet['publishedAt']),
            embeddable:
                typeof status['embeddable'] === 'boolean' ? status['embeddable'] : undefined,
            live:
                string(snippet['liveBroadcastContent']) === undefined
                    ? undefined
                    : snippet['liveBroadcastContent'] !== 'none',
            privacy: privacy === undefined ? undefined : PRIVACY[privacy as keyof typeof PRIVACY],
        },
    });
}

/** Without a key: oEmbed, which has no duration, channel id or privacy. */
async function probeWithOembed(context: EmbedOperationContext): Promise<ProbeMetadata> {
    const { id, url } = context.input;
    const body = await requestJson(
        context,
        TITLE,
        withQuery('https://www.youtube.com/oembed', {
            url,
            format: 'json',
            maxwidth: '1920',
            maxheight: '1080',
        }),
        {},
        // YouTube answers 400 for an id it doesn't know.
        (response) =>
            Promise.resolve(response.status === 400 ? statusError(TITLE, 404) : undefined),
    );
    return probeMetadata({
        kind: 'video',
        width: positive(body['width']),
        height: positive(body['height']),
        embed: {
            provider: 'youtube',
            id,
            url,
            embedUrl: `https://www.youtube.com/embed/${id}`,
            title: string(body['title']),
            author: { name: string(body['author_name']), url: httpsUrl(body['author_url']) },
            thumbnailUrl: httpsUrl(body['thumbnail_url']),
            // It answers for videos that other sites may play.
            embeddable: true,
            html: string(body['html']),
        },
    });
}

export const youtube: ProviderModule = {
    provider,
    probe(context) {
        const apiKey = context.credentials?.['apiKey'];
        return apiKey === undefined ? probeWithOembed(context) : probeWithApi(context, apiKey);
    },
};
