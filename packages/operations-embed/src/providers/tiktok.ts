import { defineEmbedProvider } from '@eclair-js/operation';

import {
    hostIn,
    httpsUrl,
    iframeSource,
    positive,
    probeMetadata,
    requestJson,
    segments,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'TikTok';
const ID = /^\d{5,25}$/;
const USER = /^@[A-Za-z0-9._]{1,64}$/;

export const provider = defineEmbedProvider({
    name: 'tiktok',
    title: TITLE,
    match(url) {
        if (!hostIn(url, ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'])) {
            return undefined;
        }
        const [user, video, id] = segments(url);
        return user !== undefined &&
            USER.test(user) &&
            video === 'video' &&
            id !== undefined &&
            ID.test(id)
            ? { id, url: `https://www.tiktok.com/${user}/video/${id}` }
            : undefined;
    },
});

/**
 * oEmbed, without credentials. TikTok's oEmbed gives the player and sometimes the title, the
 * author and the thumbnail, never the duration. It answers for ids that don't exist too, so a
 * missing video isn't detected here.
 */
export const tiktok: ProviderModule = {
    provider,
    async probe(context) {
        const { id, url } = context.input;
        const body = await requestJson(
            context,
            TITLE,
            withQuery('https://www.tiktok.com/oembed', { url }),
        );
        return probeMetadata({
            kind: 'video',
            width: positive(body['thumbnail_width']),
            height: positive(body['thumbnail_height']),
            embed: {
                provider: 'tiktok',
                id,
                url,
                embedUrl: iframeSource(body['html']) ?? `https://www.tiktok.com/player/v1/${id}`,
                title: string(body['title']),
                // The author as TikTok answers it, never as the URL names it.
                author: {
                    id: string(body['author_unique_id']),
                    name: string(body['author_name']),
                    url: httpsUrl(body['author_url']),
                },
                thumbnailUrl: httpsUrl(body['thumbnail_url']),
                embeddable: true,
                html: string(body['html']),
            },
        });
    },
};
