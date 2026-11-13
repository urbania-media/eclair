import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { memoryCache, runEmbedOperation } from '@eclair-js/operation/testing';
import type { FakeResponse, RunEmbedOperationOptions } from '@eclair-js/operation/testing';
import { validate } from '@eclair-js/protocol';

import plugin from './index.ts';
import { embedProbe } from './probe.ts';

function fixture(name: string): unknown {
    return JSON.parse(
        readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'),
    ) as unknown;
}

/** Runs `embed.probe` and checks its metadata against the protocol. */
async function probe(
    url: string,
    responses: RunEmbedOperationOptions['responses'],
    rest: Partial<RunEmbedOperationOptions> = {},
) {
    const result = await runEmbedOperation(embedProbe, {
        url,
        providers: plugin.embedProviders,
        responses,
        ...rest,
    });
    await result.cleanup();
    expect(validate('ProbeMetadata', result.metadata)).toMatchObject({ valid: true });
    return result;
}

const ok = (name: string): FakeResponse => ({ body: fixture(name) });

describe('embed.probe', () => {
    describe('YouTube', () => {
        const url = 'https://youtu.be/aqz-KE-bpKQ';

        it('reads oEmbed without a key', async () => {
            const { metadata, requests } = await probe(url, {
                'https://www.youtube.com/oembed': ok('youtube-oembed'),
            });
            expect(metadata).toMatchObject({
                kind: 'video',
                mime: 'text/html',
                width: 1920,
                height: 1080,
                embed: {
                    provider: 'youtube',
                    id: 'aqz-KE-bpKQ',
                    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
                    embedUrl: 'https://www.youtube.com/embed/aqz-KE-bpKQ',
                    title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
                    author: { name: 'Blender', url: 'https://www.youtube.com/@BlenderOfficial' },
                    thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg',
                    embeddable: true,
                },
            });
            expect(metadata).not.toHaveProperty('duration');
            expect(metadata).not.toHaveProperty('embed.author.id');
            expect(
                requests.map(({ url: request }) => new URL(request).searchParams.get('url')),
            ).toEqual(['https://www.youtube.com/watch?v=aqz-KE-bpKQ']);
        });

        it('reads the Data API with a key: duration, channel and privacy', async () => {
            const { metadata, requests } = await probe(
                url,
                { 'https://www.googleapis.com/youtube/v3/videos': ok('youtube-api') },
                { credentials: { apiKey: 'a-key' } },
            );
            expect(metadata).toMatchObject({
                kind: 'video',
                duration: 635,
                embed: {
                    author: {
                        id: 'UCSMOQeBJ2RAnuFungnQOxLg',
                        name: 'Blender',
                        url: 'https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg',
                    },
                    thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg',
                    publishedAt: '2014-11-10T14:05:55Z',
                    embeddable: true,
                    live: false,
                    privacy: 'public',
                },
            });
            expect(metadata).not.toHaveProperty('embed.html');
            const request = new URL(requests[0]?.url ?? '');
            expect(request.searchParams.get('id')).toBe('aqz-KE-bpKQ');
            expect(request.searchParams.has('key')).toBe(false);
            expect(requests[0]?.headers?.['x-goog-api-key']).toBe('a-key');
        });

        it('tells a missing video from an exhausted quota', async () => {
            await expect(
                probe(url, {
                    'https://www.youtube.com/oembed': { status: 400, body: 'Bad Request' },
                }),
            ).rejects.toMatchObject({ code: 'provider_unavailable' });
            await expect(
                probe(
                    url,
                    { 'https://www.googleapis.com/youtube/v3/videos': { body: { items: [] } } },
                    { credentials: { apiKey: 'a-key' } },
                ),
            ).rejects.toMatchObject({ code: 'provider_unavailable' });
            await expect(
                probe(
                    url,
                    {
                        'https://www.googleapis.com/youtube/v3/videos': {
                            status: 403,
                            body: fixture('youtube-api-quota'),
                        },
                    },
                    { credentials: { apiKey: 'a-key' } },
                ),
            ).rejects.toMatchObject({ code: 'provider_refused' });
        });
    });

    describe('Vimeo', () => {
        it('reads oEmbed without a token, duration included', async () => {
            const { metadata } = await probe('https://vimeo.com/76979871', {
                'https://vimeo.com/api/oembed.json': ok('vimeo-oembed'),
            });
            expect(metadata).toMatchObject({
                kind: 'video',
                duration: 62,
                width: 1920,
                height: 1080,
                embed: {
                    provider: 'vimeo',
                    id: '76979871',
                    embedUrl: 'https://player.vimeo.com/video/76979871',
                    author: { name: 'Vimeo', url: 'https://vimeo.com/staff' },
                },
            });
        });

        it('reads the API with a token, with the hash of an unlisted video', async () => {
            const { metadata, requests } = await probe(
                'https://player.vimeo.com/video/76979871?h=8272103f6e',
                { 'https://api.vimeo.com/videos/76979871:8272103f6e': ok('vimeo-api') },
                { credentials: { token: 'a-token' } },
            );
            expect(metadata).toMatchObject({
                duration: 62,
                embed: {
                    url: 'https://vimeo.com/76979871/8272103f6e',
                    embedUrl: 'https://player.vimeo.com/video/76979871?h=8272103f6e',
                    author: { id: '152184', name: 'Vimeo' },
                    thumbnailUrl: 'https://i.vimeocdn.com/video/452001751-d_1920x1080',
                    publishedAt: '2013-10-15T18:08:29Z',
                    embeddable: true,
                    privacy: 'public',
                },
            });
            expect(requests[0]?.headers?.['authorization']).toBe('bearer a-token');
        });

        it('fails for a missing video', async () => {
            await expect(
                probe('https://vimeo.com/1', {
                    'https://vimeo.com/api/oembed.json': { status: 404, body: '' },
                }),
            ).rejects.toMatchObject({ code: 'provider_unavailable' });
        });
    });

    describe('Dailymotion', () => {
        it('reads its public API', async () => {
            const { metadata } = await probe('https://dai.ly/x7tgad0', {
                'https://api.dailymotion.com/video/x7tgad0': ok('dailymotion-api'),
            });
            expect(metadata).toMatchObject({
                kind: 'video',
                duration: 87,
                embed: {
                    provider: 'dailymotion',
                    id: 'x7tgad0',
                    title: 'Midnight Sun | Iceland',
                    author: {
                        id: 'x2djcgk',
                        name: 'Dailymotion player demo',
                        url: 'https://www.dailymotion.com/dailymotionplayerdemo2',
                    },
                    embedUrl: 'https://geo.dailymotion.com/player.html?video=x7tgad0',
                    publishedAt: '2020-04-22T15:59:41Z',
                    embeddable: true,
                    live: false,
                    privacy: 'public',
                },
            });
            expect(metadata).not.toHaveProperty('embed.description');
        });

        it('fails for a missing video', async () => {
            await expect(
                probe('https://dai.ly/xzzzzzzz', {
                    'https://api.dailymotion.com/video/xzzzzzzz': {
                        status: 404,
                        body: fixture('dailymotion-api-404'),
                    },
                }),
            ).rejects.toMatchObject({ code: 'provider_unavailable' });
        });
    });

    it('reads SoundCloud oEmbed, an audio with its player', async () => {
        const { metadata } = await probe('https://soundcloud.com/forss/flickermood', {
            'https://soundcloud.com/oembed': ok('soundcloud-oembed'),
        });
        expect(metadata).toMatchObject({
            kind: 'audio',
            embed: {
                provider: 'soundcloud',
                id: 'forss/flickermood',
                title: 'Flickermood by Forss',
                author: { id: 'forss', name: 'Forss', url: 'https://soundcloud.com/forss' },
                embedUrl:
                    'https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true&maxheight=166',
            },
        });
    });

    describe('Spotify', () => {
        const url = 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6';

        it('reads oEmbed without credentials', async () => {
            const { metadata } = await probe(url, {
                'https://open.spotify.com/oembed': ok('spotify-oembed'),
            });
            expect(metadata).toMatchObject({
                kind: 'audio',
                embed: {
                    provider: 'spotify',
                    title: 'Speak To Me - 2011 Remastered Version',
                    embedUrl:
                        'https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6?utm_source=oembed',
                },
            });
            expect(metadata).not.toHaveProperty('duration');
        });

        it('adds the Web API with an app, and keeps its token', async () => {
            const cache = memoryCache();
            const responses = {
                'https://open.spotify.com/oembed': ok('spotify-oembed'),
                'https://accounts.spotify.com/api/token': ok('spotify-token'),
                'https://api.spotify.com/v1/tracks/6rqhFgbbKwnb9MLmUQDhG6': ok('spotify-api-track'),
            };
            const credentials = { clientId: 'id', clientSecret: 'secret' };
            const { metadata, requests } = await probe(url, responses, { credentials, cache });
            expect(metadata).toMatchObject({
                duration: 67.96,
                embed: {
                    author: { id: '0k17h0D3J5VfsdmQ1iZtE9', name: 'Pink Floyd' },
                    thumbnailUrl:
                        'https://i.scdn.co/image/ab67616d0000b27305d4eec40a828850aa8cd2f7',
                    publishedAt: '1973-03-01T00:00:00Z',
                },
            });
            const token = requests.find(({ url: request }) => request.includes('/api/token'));
            expect(token).toMatchObject({
                method: 'POST',
                body: 'grant_type=client_credentials',
                headers: { authorization: `Basic ${Buffer.from('id:secret').toString('base64')}` },
            });

            const again = await probe(url, responses, {
                credentials,
                cache,
                options: { refresh: true },
            });
            expect(again.requests.map(({ url: request }) => request.split('?')[0])).toEqual([
                'https://open.spotify.com/oembed',
                'https://api.spotify.com/v1/tracks/6rqhFgbbKwnb9MLmUQDhG6',
            ]);
        });
    });

    it('reads TikTok oEmbed, which may give nothing but the player', async () => {
        const { metadata } = await probe(
            'https://www.tiktok.com/@scout2015/video/6718335390845095173',
            { 'https://www.tiktok.com/oembed': ok('tiktok-oembed') },
        );
        expect(metadata).toEqual({
            kind: 'video',
            mime: 'text/html',
            embed: {
                provider: 'tiktok',
                id: '6718335390845095173',
                url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
                embedUrl:
                    'https://www.tiktok.com/player/v1/6718335390845095173?embed_from=oembed&music_info=1&description=1&autoplay=1&muted=1',
                embeddable: true,
                html: (fixture('tiktok-oembed') as { html: string }).html,
            },
        });
    });

    describe('Instagram', () => {
        const url = 'https://www.instagram.com/reel/C0abcdefGhI/';
        const endpoint = 'https://graph.facebook.com/v23.0/instagram_oembed';

        it('needs a Meta token', async () => {
            await expect(probe(url, {})).rejects.toMatchObject({ code: 'provider_failed' });
        });

        it("reads Meta's oEmbed with one", async () => {
            const { metadata, requests } = await probe(
                url,
                { [endpoint]: ok('instagram-oembed') },
                { credentials: { accessToken: 'app|secret' } },
            );
            expect(metadata).toMatchObject({
                kind: 'video',
                width: 640,
                height: 1136,
                embed: {
                    provider: 'instagram',
                    id: 'C0abcdefGhI',
                    embedUrl: 'https://www.instagram.com/reel/C0abcdefGhI/embed/',
                    author: { name: 'instagram' },
                },
            });
            expect(new URL(requests[0]?.url ?? '').searchParams.get('access_token')).toBe(
                'app|secret',
            );
        });

        it('tells a refused token from a missing post', async () => {
            const credentials = { accessToken: 'app|secret' };
            await expect(
                probe(
                    url,
                    { [endpoint]: { status: 400, body: { error: { code: 190 } } } },
                    { credentials },
                ),
            ).rejects.toMatchObject({ code: 'provider_failed' });
            await expect(
                probe(
                    url,
                    { [endpoint]: { status: 400, body: { error: { code: 100 } } } },
                    { credentials },
                ),
            ).rejects.toMatchObject({ code: 'provider_unavailable' });
            await expect(
                probe(
                    url,
                    { [endpoint]: { status: 400, body: { error: { code: 4 } } } },
                    { credentials },
                ),
            ).rejects.toMatchObject({ code: 'provider_refused' });
        });
    });

    it('answers from its cache for an hour, unless asked to refresh', async () => {
        const cache = memoryCache();
        const responses = { 'https://www.youtube.com/oembed': ok('youtube-oembed') };
        const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
        const first = await probe(url, responses, { cache });
        const second = await probe(url, responses, { cache });
        expect(second.requests).toEqual([]);
        expect(second.metadata).toEqual(first.metadata);
        const withKey = await probe(
            url,
            { 'https://www.googleapis.com/youtube/v3/videos': ok('youtube-api') },
            { cache, credentials: { apiKey: 'a-key' } },
        );
        expect(withKey.requests).toHaveLength(1);
        const refreshed = await probe(url, responses, { cache, options: { refresh: true } });
        expect(refreshed.requests).toHaveLength(1);
    });
});
