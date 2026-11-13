import { describe, expect, it } from 'vitest';

import plugin from './index.ts';

/** The provider that recognizes a URL, with the embed it read. */
function match(url: string): { provider: string; id: string; url: string } | undefined {
    for (const provider of plugin.embedProviders) {
        const found = provider.match(new URL(url));
        if (found !== undefined) {
            return { provider: provider.name, ...found };
        }
    }
    return undefined;
}

describe('embed providers', () => {
    it('are the seven of decision 0022', () => {
        expect(plugin.embedProviders.map(({ name }) => name).sort()).toEqual([
            'dailymotion',
            'instagram',
            'soundcloud',
            'spotify',
            'tiktok',
            'vimeo',
            'youtube',
        ]);
    });

    it.each([
        [
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=10s',
            'youtube',
            'aqz-KE-bpKQ',
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        ],
        [
            'https://youtu.be/aqz-KE-bpKQ?si=abc',
            'youtube',
            'aqz-KE-bpKQ',
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        ],
        [
            'https://m.youtube.com/shorts/aqz-KE-bpKQ',
            'youtube',
            'aqz-KE-bpKQ',
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        ],
        [
            'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
            'youtube',
            'aqz-KE-bpKQ',
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        ],
        [
            'https://www.youtube.com/live/aqz-KE-bpKQ',
            'youtube',
            'aqz-KE-bpKQ',
            'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        ],
        ['https://vimeo.com/76979871', 'vimeo', '76979871', 'https://vimeo.com/76979871'],
        [
            'https://vimeo.com/76979871/8272103f6e',
            'vimeo',
            '76979871',
            'https://vimeo.com/76979871/8272103f6e',
        ],
        [
            'https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0',
            'vimeo',
            '76979871',
            'https://vimeo.com/76979871/8272103f6e',
        ],
        [
            'https://vimeo.com/channels/staffpicks/76979871',
            'vimeo',
            '76979871',
            'https://vimeo.com/76979871',
        ],
        [
            'https://vimeo.com/showcase/123/video/76979871',
            'vimeo',
            '76979871',
            'https://vimeo.com/76979871',
        ],
        [
            'https://www.dailymotion.com/video/x7tgad0',
            'dailymotion',
            'x7tgad0',
            'https://www.dailymotion.com/video/x7tgad0',
        ],
        [
            'https://www.dailymotion.com/video/x7tgad0_midnight-sun',
            'dailymotion',
            'x7tgad0',
            'https://www.dailymotion.com/video/x7tgad0',
        ],
        [
            'https://dai.ly/x7tgad0',
            'dailymotion',
            'x7tgad0',
            'https://www.dailymotion.com/video/x7tgad0',
        ],
        [
            'https://geo.dailymotion.com/player.html?video=x7tgad0',
            'dailymotion',
            'x7tgad0',
            'https://www.dailymotion.com/video/x7tgad0',
        ],
        [
            'https://soundcloud.com/forss/flickermood',
            'soundcloud',
            'forss/flickermood',
            'https://soundcloud.com/forss/flickermood',
        ],
        [
            'https://soundcloud.com/forss/flickermood/s-AbC123',
            'soundcloud',
            'forss/flickermood',
            'https://soundcloud.com/forss/flickermood/s-AbC123',
        ],
        [
            'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=x',
            'spotify',
            '6rqhFgbbKwnb9MLmUQDhG6',
            'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
        ],
        [
            'https://open.spotify.com/intl-fr/episode/512ojhOuo1ktJprKbVcKyQ',
            'spotify',
            '512ojhOuo1ktJprKbVcKyQ',
            'https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ',
        ],
        [
            'https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=fr',
            'tiktok',
            '6718335390845095173',
            'https://www.tiktok.com/@scout2015/video/6718335390845095173',
        ],
        [
            'https://www.instagram.com/p/C0abcdefGhI/',
            'instagram',
            'C0abcdefGhI',
            'https://www.instagram.com/p/C0abcdefGhI/',
        ],
        [
            'https://www.instagram.com/reels/C0abcdefGhI/',
            'instagram',
            'C0abcdefGhI',
            'https://www.instagram.com/reel/C0abcdefGhI/',
        ],
        [
            'https://www.instagram.com/someone/reel/C0abcdefGhI/?igsh=x',
            'instagram',
            'C0abcdefGhI',
            'https://www.instagram.com/reel/C0abcdefGhI/',
        ],
    ])('recognize %s', (url, provider, id, canonical) => {
        expect(match(url)).toEqual({ provider, id, url: canonical });
    });

    it.each([
        // Other hosts, lookalikes and plain http.
        'https://www.youtube.com.evil.example/watch?v=aqz-KE-bpKQ',
        'https://evil.example/https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        'http://www.youtube.com/watch?v=aqz-KE-bpKQ',
        'https://user@vimeo.example.com/76979871',
        // Pages that aren't one video or audio.
        'https://www.youtube.com/watch?v=too-short',
        'https://www.youtube.com/@BlenderOfficial',
        'https://www.youtube.com/playlist?list=PL123',
        'https://vimeo.com/staff',
        'https://vimeo.com/channels/staffpicks',
        'https://soundcloud.com/forss',
        'https://soundcloud.com/forss/sets/an-album',
        'https://soundcloud.com/discover/sets/weekly',
        'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv',
        'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
        'https://www.tiktok.com/@scout2015',
        'https://www.instagram.com/someone/',
        'https://www.instagram.com/stories/someone/123/',
    ])("don't recognize %s", (url) => {
        expect(match(url)).toBeUndefined();
    });
});
