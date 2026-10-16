import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { poster, posterStart } from './poster.ts';
import { probeFile, runOn } from './test-helpers.ts';

describe('posterStart', () => {
    it('looks 10% into the video, leaving 5 seconds before the end', () => {
        expect(posterStart(100)).toBe(10);
        expect(posterStart(5.5)).toBe(0.5);
        expect(posterStart(8)).toBeCloseTo(0.8);
        expect(posterStart(20)).toBe(2);
        expect(posterStart(3)).toBe(0);
    });
});

describe.skipIf(skipWithoutBinaries(poster.binaries))('video.poster', () => {
    it('has its binaries', () => {
        expect(missingBinaries(poster.binaries)).toEqual([]);
    });

    it('writes one representative frame', async () => {
        const result = await runOn(poster, 'video.mp4');
        try {
            expect(result.files).toEqual([
                {
                    name: 'poster.jpg',
                    path: expect.stringMatching(/poster\.jpg$/),
                    mime: 'image/jpeg',
                    role: 'poster',
                },
            ]);
            expect(result.metadata).toEqual({ width: 320, height: 180 });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                codec_name: 'mjpeg',
                width: 320,
                height: 180,
            });
        } finally {
            await result.cleanup();
        }
    });

    it('takes the frame at a given time, scaled down', async () => {
        const result = await runOn(poster, 'silent-portrait.mp4', {
            time: 1,
            maxHeight: 160,
            format: 'png',
        });
        try {
            expect(result.files[0]).toMatchObject({ name: 'poster.png', mime: 'image/png' });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                codec_name: 'png',
                width: 90,
                height: 160,
            });
        } finally {
            await result.cleanup();
        }
    });
});
