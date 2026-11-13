import { Type } from 'typebox';

import { OperationError, defineEmbedProvider } from '@eclair-js/operation';

import {
    hostIn,
    httpsUrl,
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

const TITLE = 'Instagram';
const CODE = /^[A-Za-z0-9_-]{5,64}$/;
/** The version of Meta's Graph API that `instagram_oembed` is called with. */
const GRAPH_VERSION = 'v23.0';
/** Graph API error codes of a rate limit. */
const RATE_LIMITS = new Set([4, 17, 32, 613]);

export const provider = defineEmbedProvider({
    name: 'instagram',
    title: TITLE,
    match(url) {
        if (!hostIn(url, ['instagram.com', 'www.instagram.com'])) {
            return undefined;
        }
        const parts = segments(url);
        // /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, and the same under /<user>/.
        const index = parts.findIndex((part) => ['p', 'reel', 'reels', 'tv'].includes(part));
        const type = parts[index];
        const code = parts[index + 1];
        if (
            index < 0 ||
            index > 1 ||
            type === undefined ||
            code === undefined ||
            !CODE.test(code)
        ) {
            return undefined;
        }
        return {
            id: code,
            url: `https://www.instagram.com/${type === 'p' ? 'p' : 'reel'}/${code}/`,
        };
    },
    credentials: Type.Object(
        {
            accessToken: Type.String({
                minLength: 1,
                description: "A Meta app's access token (app-id|app-secret), with oEmbed Read",
            }),
        },
        { additionalProperties: false },
    ),
});

/** Meta's oEmbed, which needs an app token. A post can be an image or a video; a reel is a video. */
export const instagram: ProviderModule = {
    provider,
    async probe(context) {
        const { id, url } = context.input;
        const token = context.credentials?.['accessToken'];
        if (token === undefined) {
            throw new OperationError(
                'provider_failed',
                'Instagram needs a Meta access token: set the credentials of the project.',
            );
        }
        const body = await requestJson(
            context,
            TITLE,
            withQuery(`https://graph.facebook.com/${GRAPH_VERSION}/instagram_oembed`, {
                url,
                maxwidth: '658',
                access_token: token,
            }),
            {},
            async (response) => {
                const error = objectAt(await response.json().catch(() => ({})), 'error');
                const code = error['code'];
                if (typeof code === 'number' && RATE_LIMITS.has(code)) {
                    return new OperationError(
                        'provider_refused',
                        'Meta limits the requests of the app.',
                    );
                }
                if (code === 190) {
                    return new OperationError(
                        'provider_failed',
                        'Meta refused the access token: check the credentials of the project.',
                    );
                }
                // Meta answers 400 for a post that is missing, private or can't be embedded.
                return statusError(TITLE, response.status === 400 ? 404 : response.status);
            },
        );
        const reel = new URL(url).pathname.startsWith('/reel/');
        return probeMetadata({
            kind: reel ? 'video' : 'other',
            width: positive(body['thumbnail_width']),
            height: positive(body['thumbnail_height']),
            embed: {
                provider: 'instagram',
                id,
                url,
                embedUrl: `${url}embed/`,
                author: { name: string(body['author_name']) },
                thumbnailUrl: httpsUrl(body['thumbnail_url']),
                embeddable: true,
                html: string(body['html']),
            },
        });
    },
};
