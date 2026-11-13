import { defineEmbedProvider } from '@eclair-js/operation';

import {
    hostIn,
    httpsUrl,
    iframeSource,
    probeMetadata,
    requestJson,
    segments,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'SoundCloud';
const NAME = /^[a-z0-9_-]{1,255}$/i;
/** First segments that are pages of SoundCloud, not users. */
const RESERVED_USERS = new Set([
    'discover',
    'stream',
    'you',
    'search',
    'upload',
    'charts',
    'pages',
    'terms-of-use',
    'messages',
    'notifications',
    'settings',
    'people',
    'tags',
]);
/** Second segments that are pages of a user, not tracks. */
const RESERVED_TRACKS = new Set([
    'sets',
    'tracks',
    'albums',
    'likes',
    'reposts',
    'popular-tracks',
    'followers',
    'following',
    'comments',
]);

export const provider = defineEmbedProvider({
    name: 'soundcloud',
    title: TITLE,
    match(url) {
        if (!hostIn(url, ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'])) {
            return undefined;
        }
        const [user, track, secret, ...rest] = segments(url);
        if (
            user === undefined ||
            track === undefined ||
            rest.length > 0 ||
            !NAME.test(user) ||
            !NAME.test(track) ||
            RESERVED_USERS.has(user) ||
            RESERVED_TRACKS.has(track)
        ) {
            return undefined;
        }
        // A private track is shared with its secret token: /user/track/s-AbC123.
        if (secret !== undefined && !/^s-[A-Za-z0-9]+$/.test(secret)) {
            return undefined;
        }
        const path = [user, track, secret].filter((part) => part !== undefined).join('/');
        return { id: `${user}/${track}`, url: `https://soundcloud.com/${path}` };
    },
});

/** oEmbed only: SoundCloud's API is closed to new applications, so there is no duration. */
export const soundcloud: ProviderModule = {
    provider,
    async probe(context) {
        const { id, url } = context.input;
        const body = await requestJson(
            context,
            TITLE,
            withQuery('https://soundcloud.com/oembed', { format: 'json', url, maxheight: '166' }),
        );
        const authorUrl = httpsUrl(body['author_url']);
        return probeMetadata({
            kind: 'audio',
            embed: {
                provider: 'soundcloud',
                id,
                url,
                embedUrl: iframeSource(body['html']),
                title: string(body['title']),
                author: {
                    // The account's permalink, as SoundCloud answers it, never as the request gave it.
                    id: authorUrl === undefined ? undefined : segments(new URL(authorUrl))[0],
                    name: string(body['author_name']),
                    url: authorUrl,
                },
                thumbnailUrl: httpsUrl(body['thumbnail_url']),
                embeddable: true,
                html: string(body['html']),
            },
        });
    },
};
