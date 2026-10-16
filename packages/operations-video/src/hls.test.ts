import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { hls, planRenditions } from './hls.ts';
import { probeFile, runOn } from './test-helpers.ts';

const MEDIATHEQUE = [
    { size: 360, bitrate: 800 },
    { size: 720, bitrate: 2000 },
    { size: 1080, bitrate: 4000 },
];

describe('planRenditions', () => {
    it('keeps the renditions that fit the video, by short side', () => {
        expect(planRenditions(1280, 720, MEDIATHEQUE, 128)).toEqual([
            { name: '360p', width: 640, height: 360, bitrate: 800, audioBitrate: 128 },
            { name: '720p', width: 1280, height: 720, bitrate: 2000, audioBitrate: 128 },
        ]);
        expect(planRenditions(1080, 1920, MEDIATHEQUE, 96)).toEqual([
            { name: '360p', width: 360, height: 640, bitrate: 800, audioBitrate: 96 },
            { name: '720p', width: 720, height: 1280, bitrate: 2000, audioBitrate: 96 },
            { name: '1080p', width: 1080, height: 1920, bitrate: 4000, audioBitrate: 96 },
        ]);
    });

    it('makes the smallest one at the size of a smaller video', () => {
        expect(planRenditions(320, 180, MEDIATHEQUE, 128)).toEqual([
            { name: '180p', width: 320, height: 180, bitrate: 800, audioBitrate: 128 },
        ]);
    });
});

describe.skipIf(skipWithoutBinaries(hls.binaries))('video.hls', () => {
    it('has its binaries', () => {
        expect(missingBinaries(hls.binaries)).toEqual([]);
    });

    it('writes a master playlist, a playlist per rendition and their segments', async () => {
        const result = await runOn(hls, 'video.mp4', {
            renditions: [
                { size: 144, bitrate: 200 },
                { size: 180, bitrate: 400, audioBitrate: 64 },
            ],
            segmentDuration: 2,
        });
        try {
            const names = result.files.map(({ name, role }) => `${role}:${name}`);
            expect(names.slice(0, 2)).toEqual(['main:master.m3u8', 'playlist:144p.m3u8']);
            expect(names).toContain('segment:144p_000.ts');
            expect(names).toContain('segment:144p_001.ts');
            expect(names).toContain('playlist:180p.m3u8');
            expect(names).toContain('segment:180p_001.ts');
            expect(result.metadata).toEqual({
                renditions: [
                    { name: '144p', width: 256, height: 144, bitrate: 200 },
                    { name: '180p', width: 320, height: 180, bitrate: 400 },
                ],
            });

            const master = await readFile(result.files[0]?.path ?? '', 'utf8');
            expect(master).toContain('#EXTM3U');
            expect(master).toMatch(/RESOLUTION=256x144/);
            expect(master).toMatch(/RESOLUTION=320x180/);
            expect(master).toContain('\n144p.m3u8');
            expect(master).toContain('\n180p.m3u8');

            const playlist = await readFile(
                result.files.find(({ name }) => name === '180p.m3u8')?.path ?? '',
                'utf8',
            );
            expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
            // Segments are named relative to the playlist, so the files can move together.
            expect(playlist).toMatch(/^180p_000\.ts$/m);

            const segment = result.files.find(({ name }) => name === '180p_000.ts');
            expect(segment?.mime).toBe('video/mp2t');
            expect(
                probeFile(segment?.path ?? '').streams.map(({ codec_name }) => codec_name),
            ).toEqual(['h264', 'aac']);
            expect(result.progress.length).toBeGreaterThan(0);
        } finally {
            await result.cleanup();
        }
    });

    it('writes video-only renditions for a silent video', async () => {
        const result = await runOn(hls, 'silent-portrait.mp4');
        try {
            expect(result.metadata).toEqual({
                renditions: [{ name: '180p', width: 180, height: 320, bitrate: 800 }],
            });
            const segment = result.files.find(({ role }) => role === 'segment');
            expect(probeFile(segment?.path ?? '').streams.map((s) => s.codec_name)).toEqual([
                'h264',
            ]);
        } finally {
            await result.cleanup();
        }
    });
});
