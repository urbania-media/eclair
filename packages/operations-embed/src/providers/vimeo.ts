import { Type } from 'typebox';

import { defineEmbedProvider } from '@eclair-js/operation';
import type { EmbedOperationContext } from '@eclair-js/operation';
import type { ProbeMetadata } from '@eclair-js/protocol';

import {
    hostIn,
    httpsUrl,
    isoDate,
    objectAt,
    positive,
    probeMetadata,
    requestJson,
    segments,
    string,
    withQuery,
} from '../common.ts';
import type { ProviderModule } from '../common.ts';

const TITLE = 'Vimeo';
const ID = /^\d{1,12}$/;
const HASH = /^[0-9a-f]{6,32}$/;

/** The id and the hash of an unlisted video, from any of Vimeo's page and player URLs. */
function parse(url: URL): { id: string; hash: string | undefined } | undefined {
    const parts = segments(url);
    if (hostIn(url, ['player.vimeo.com'])) {
        const [video, id] = parts;
        return video === 'video' && id !== undefined
            ? { id, hash: url.searchParams.get('h') ?? undefined }
            : undefined;
    }
    if (!hostIn(url, ['vimeo.com', 'www.vimeo.com'])) {
        return undefined;
    }
    const [first, second, third, fourth] = parts;
    if (first !== undefined && ID.test(first)) {
        // vimeo.com/<id> and vimeo.com/<id>/<hash>.
        return { id: first, hash: second };
    }
    if (first === 'channels' && third !== undefined) {
        return { id: third, hash: undefined };
    }
    if (first === 'groups' && third === 'videos' && fourth !== undefined) {
        return { id: fourth, hash: undefined };
    }
    if (first === 'showcase' && third === 'video' && fourth !== undefined) {
        return { id: fourth, hash: undefined };
    }
    return undefined;
}

export const provider = defineEmbedProvider({
    name: 'vimeo',
    title: TITLE,
    match(url) {
        const parsed = parse(url);
        if (parsed === undefined || !ID.test(parsed.id)) {
            return undefined;
        }
        const hash = parsed.hash !== undefined && HASH.test(parsed.hash) ? parsed.hash : undefined;
        return {
            id: parsed.id,
            url: `https://vimeo.com/${parsed.id}${hash === undefined ? '' : `/${hash}`}`,
        };
    },
    credentials: Type.Object(
        { token: Type.String({ minLength: 1, description: 'A Vimeo API access token' }) },
        { additionalProperties: false },
    ),
});

const PRIVACY: Record<string, 'public' | 'unlisted' | 'private'> = {
    anybody: 'public',
    unlisted: 'unlisted',
    // Hidden from Vimeo, but playable where it is embedded.
    disable: 'unlisted',
    nobody: 'private',
    password: 'private',
    contacts: 'private',
    users: 'private',
};

/** The hash of an unlisted video, from the canonical URL. */
function hashOf(context: EmbedOperationContext): string | undefined {
    return segments(new URL(context.input.url))[1];
}

/** With a token: the API, which gives the author's id, the privacy and the release time. */
async function probeWithApi(context: EmbedOperationContext, token: string): Promise<ProbeMetadata> {
    const { id, url } = context.input;
    const hash = hashOf(context);
    const body = await requestJson(
        context,
        TITLE,
        withQuery(`https://api.vimeo.com/videos/${id}${hash === undefined ? '' : `:${hash}`}`, {
            fields: 'name,description,link,player_embed_url,duration,width,height,release_time,privacy,pictures.base_link,pictures.sizes,user.uri,user.name,user.link',
        }),
        {
            headers: {
                authorization: `bearer ${token}`,
                accept: 'application/vnd.vimeo.*+json;version=3.4',
            },
        },
    );
    const privacy = objectAt(body, 'privacy');
    const user = objectAt(body, 'user');
    const pictures = objectAt(body, 'pictures');
    const sizes = Array.isArray(pictures['sizes'])
        ? (pictures['sizes'] as Record<string, unknown>[])
        : [];
    const largest = sizes.reduce<Record<string, unknown> | undefined>(
        (best, size) =>
            (positive(size['width']) ?? 0) > (positive(best?.['width']) ?? 0) ? size : best,
        undefined,
    );
    const view = string(privacy['view']);
    return probeMetadata({
        kind: 'video',
        duration: positive(body['duration']),
        width: positive(body['width']),
        height: positive(body['height']),
        embed: {
            provider: 'vimeo',
            id,
            url,
            embedUrl: httpsUrl(body['player_embed_url']) ?? `https://player.vimeo.com/video/${id}`,
            title: string(body['name']),
            description: string(body['description']),
            author: {
                id: string(user['uri'])?.split('/').pop(),
                name: string(user['name']),
                url: httpsUrl(user['link']),
            },
            thumbnailUrl: httpsUrl(largest?.['link']) ?? httpsUrl(pictures['base_link']),
            publishedAt: isoDate(body['release_time']),
            embeddable:
                string(privacy['embed']) === undefined ? undefined : privacy['embed'] !== 'private',
            privacy: view === undefined ? undefined : PRIVACY[view],
        },
    });
}

/** Without a token: oEmbed, which has the duration but not the author's id or the privacy. */
async function probeWithOembed(context: EmbedOperationContext): Promise<ProbeMetadata> {
    const { id, url } = context.input;
    const body = await requestJson(
        context,
        TITLE,
        withQuery('https://vimeo.com/api/oembed.json', { url, width: '1920' }),
    );
    return probeMetadata({
        kind: 'video',
        duration: positive(body['duration']),
        width: positive(body['width']),
        height: positive(body['height']),
        embed: {
            provider: 'vimeo',
            id,
            url,
            embedUrl: `https://player.vimeo.com/video/${id}${
                hashOf(context) === undefined ? '' : `?h=${hashOf(context)}`
            }`,
            title: string(body['title']),
            description: string(body['description']),
            author: { name: string(body['author_name']), url: httpsUrl(body['author_url']) },
            thumbnailUrl: httpsUrl(body['thumbnail_url']),
            embeddable: true,
            html: string(body['html']),
        },
    });
}

export const vimeo: ProviderModule = {
    provider,
    probe(context) {
        const token = context.credentials?.['token'];
        return token === undefined ? probeWithOembed(context) : probeWithApi(context, token);
    },
};
