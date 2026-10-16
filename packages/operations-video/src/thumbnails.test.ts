import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { probeFile, runOn } from './test-helpers.ts';
import { evenTimes, thumbnails } from './thumbnails.ts';

describe('evenTimes', () => {
    it('starts at 0, like the mediatheque', () => {
        expect(evenTimes(10, 5, false)).toEqual([0, 2, 4, 6, 8]);
    });

    it('centers the frames with inMiddle', () => {
        expect(evenTimes(12, 5, true)).toEqual([2, 4, 6, 8, 10]);
    });
});

describe.skipIf(skipWithoutBinaries(thumbnails.binaries))('video.thumbnails', () => {
    it('has its binaries', () => {
        expect(missingBinaries(thumbnails.binaries)).toEqual([]);
    });

    it('writes 5 JPEG frames at even intervals by default', async () => {
        const result = await runOn(thumbnails, 'video.mp4');
        try {
            expect(result.files.map(({ name, mime, role }) => ({ name, mime, role }))).toEqual(
                ['0.jpg', '1.jpg', '2.jpg', '3.jpg', '4.jpg'].map((name) => ({
                    name,
                    mime: 'image/jpeg',
                    role: 'thumbnail',
                })),
            );
            expect(result.metadata).toEqual({
                width: 320,
                height: 180,
                times: [0, 0.8, 1.6, 2.4, 3.2],
            });
            for (const file of result.files) {
                expect(probeFile(file.path).streams[0]).toMatchObject({
                    codec_name: 'mjpeg',
                    width: 320,
                    height: 180,
                });
            }
        } finally {
            await result.cleanup();
        }
    });

    it('centers the frames and scales them down', async () => {
        const result = await runOn(thumbnails, 'video.mp4', {
            count: 3,
            inMiddle: true,
            maxWidth: 160,
            format: 'webp',
        });
        try {
            expect(result.files.map(({ name }) => name)).toEqual(['0.webp', '1.webp', '2.webp']);
            expect(result.metadata).toEqual({ width: 160, height: 90, times: [1, 2, 3] });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                codec_name: 'webp',
                width: 160,
                height: 90,
            });
        } finally {
            await result.cleanup();
        }
    });

    it('takes frames at given times, before the end', async () => {
        const result = await runOn(thumbnails, 'video.mp4', { times: [0.5, 60], format: 'png' });
        try {
            expect(result.files.map(({ name }) => name)).toEqual(['0.png', '1.png']);
            expect(result.metadata).toMatchObject({ times: [0.5, 3.96] });
        } finally {
            await result.cleanup();
        }
    });

    it('takes a frame every few seconds', async () => {
        const result = await runOn(thumbnails, 'video.mp4', { interval: 1.5 });
        try {
            expect(result.metadata).toMatchObject({ times: [0, 1.5, 3] });
        } finally {
            await result.cleanup();
        }
    });

    it('takes frames at scene changes', async () => {
        const result = await runOn(thumbnails, 'video.mp4', { scenes: true, count: 3 });
        try {
            // The fixture changes scene every second.
            expect(result.metadata).toMatchObject({
                times: [expect.closeTo(1, 1), expect.closeTo(2, 1), expect.closeTo(3, 1)],
            });
            expect(result.files).toHaveLength(3);
        } finally {
            await result.cleanup();
        }
    });

    it('reads the size of a rotated video as displayed', async () => {
        const result = await runOn(thumbnails, 'rotated.mp4', { count: 1 });
        try {
            expect(result.metadata).toMatchObject({ width: 180, height: 320 });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                width: 180,
                height: 320,
            });
        } finally {
            await result.cleanup();
        }
    });
});
