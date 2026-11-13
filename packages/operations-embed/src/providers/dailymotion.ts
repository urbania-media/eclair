import { defineEmbedProvider } from '@eclair-js/operation';

import {
    hostIn,
    httpsUrl,
    isoDate,
    positive,
    probeMetadata,
    requestJson,
    segments,
    statusError,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'Dailymotion';
const ID = /^[a-z0-9]{5,20}$/;

function idOf(url: URL): string | undefined {
    if (hostIn(url, ['dai.ly'])) {
        return segments(url)[0];
    }
    if (hostIn(url, ['geo.dailymotion.com'])) {
        return url.searchParams.get('video') ?? undefined;
    }
    if (!hostIn(url, ['dailymotion.com', 'www.dailymotion.com'])) {
        return undefined;
    }
    const parts = segments(url);
    const index = parts[0] === 'embed' ? 1 : 0;
    // Old URLs append a slug: /video/x7tgad0_midnight-sun.
    return parts[index] === 'video' ? parts[index + 1]?.split('_')[0] : undefined;
}

export const provider = defineEmbedProvider({
    name: 'dailymotion',
    title: TITLE,
    match(url) {
        const id = idOf(url);
        return id !== undefined && ID.test(id)
            ? { id, url: `https://www.dailymotion.com/video/${id}` }
            : undefined;
    },
});

/** Its public API, without credentials, gives everything but the dimensions. */
export const dailymotion: ProviderModule = {
    provider,
    async probe(context) {
        const { id, url } = context.input;
        const body = await requestJson(
            context,
            TITLE,
            withQuery(`https://api.dailymotion.com/video/${id}`, {
                fields: 'id,title,description,duration,thumbnail_url,owner.id,owner.screenname,owner.url,created_time,allow_embed,private,mode,embed_url',
            }),
            {},
            // A private video is a 403, as a missing one is a 404.
            (response) => Promise.resolve(statusError(TITLE, response.status)),
        );
        return probeMetadata({
            kind: 'video',
            duration: positive(body['duration']),
            embed: {
                provider: 'dailymotion',
                id,
                url,
                embedUrl:
                    httpsUrl(body['embed_url']) ??
                    `https://geo.dailymotion.com/player.html?video=${id}`,
                title: string(body['title']),
                description: string(body['description']),
                author: {
                    id: string(body['owner.id']),
                    name: string(body['owner.screenname']),
                    url: httpsUrl(body['owner.url']),
                },
                thumbnailUrl: httpsUrl(body['thumbnail_url']),
                publishedAt: isoDate(body['created_time']),
                embeddable:
                    typeof body['allow_embed'] === 'boolean' ? body['allow_embed'] : undefined,
                live: string(body['mode']) === undefined ? undefined : body['mode'] === 'live',
                // A private video is readable through its private id only: unlisted, in our words.
                privacy:
                    typeof body['private'] === 'boolean'
                        ? body['private']
                            ? 'unlisted'
                            : 'public'
                        : undefined,
            },
        });
    },
};
