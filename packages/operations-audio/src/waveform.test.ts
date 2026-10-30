import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { probeFile, runOn } from './test-helpers.ts';
import { waveform } from './waveform.ts';

describe.skipIf(skipWithoutBinaries(waveform.binaries))('audio.waveform', () => {
    it('has its binaries', () => {
        expect(missingBinaries(waveform.binaries)).toEqual([]);
    });

    it("writes the mediatheque's image and the data", async () => {
        const result = await runOn(waveform, 'audio.mp3');
        try {
            expect(result.files.map(({ name, mime, role }) => ({ name, mime, role }))).toEqual([
                { name: 'waveform.png', mime: 'image/png', role: 'main' },
                { name: 'waveform.json', mime: 'application/json', role: 'data' },
            ]);
            expect(result.metadata).toEqual({
                width: 1200,
                height: 400,
                duration: expect.closeTo(3, 1),
            });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                codec_name: 'png',
                width: 1200,
                height: 400,
                pix_fmt: 'rgba',
            });
            const data = JSON.parse(await readFile(result.files[1]?.path ?? '', 'utf8')) as {
                channels: number;
                bits: number;
                length: number;
                data: number[];
            };
            expect(data).toMatchObject({ channels: 1, bits: 8 });
            // 20 points a second, a minimum and a maximum each.
            expect(data.length).toBeCloseTo(60, -1);
            expect(data.data).toHaveLength(data.length * 2);
            // The fixture gets louder.
            expect(Math.abs(data.data.at(-1) ?? 0)).toBeGreaterThan(Math.abs(data.data[1] ?? 0));
        } finally {
            await result.cleanup();
        }
    });

    it('writes only the data, from the soundtrack of a video', async () => {
        const result = await runOn(waveform, 'video.mp4', { image: false, pixelsPerSecond: 5 });
        try {
            expect(result.files.map(({ name, role }) => `${role}:${name}`)).toEqual([
                'main:waveform.json',
            ]);
            expect(result.metadata).toEqual({ duration: expect.closeTo(4, 1) });
        } finally {
            await result.cleanup();
        }
    });

    it('draws an image with other sizes and colors', async () => {
        const result = await runOn(waveform, 'audio.m4a', {
            data: false,
            width: 300,
            height: 60,
            color: 'ff0000',
            backgroundColor: 'ffffff',
            style: 'bars',
        });
        try {
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                width: 300,
                height: 60,
            });
        } finally {
            await result.cleanup();
        }
    });

    it('refuses to write nothing', async () => {
        await expect(
            runOn(waveform, 'audio.mp3', { image: false, data: false }),
        ).rejects.toMatchObject({ code: 'operation_failed' });
    });

    it('adds a ThumbHash placeholder to the image when asked, not to the data', async () => {
        const result = await runOn(waveform, 'audio.mp3', { thumbhash: true });
        try {
            const [image, data] = result.files;
            expect(image).toMatchObject({
                name: 'waveform.png',
                thumbhash: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/),
            });
            expect(data?.name).toBe('waveform.json');
            expect(data?.thumbhash).toBeUndefined();
        } finally {
            await result.cleanup();
        }
    });
});
