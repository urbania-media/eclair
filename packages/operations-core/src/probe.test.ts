import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { thumbHashToApproximateAspectRatio, thumbHashToAverageRGBA } from 'thumbhash';
import { describe, expect, it } from 'vitest';

import { runOperation } from '@eclair-js/operation/testing';
import { validate } from '@eclair-js/protocol';

import { probe } from './probe.ts';

function fixture(name: string): string {
    return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

function hasBinary(name: string): boolean {
    return spawnSync(name, ['-h'], { stdio: 'ignore' }).error === undefined;
}

// The image's CI job sets ECLAIR_TEST_BINARIES: there, a missing binary fails instead of skipping.
const required = process.env['ECLAIR_TEST_BINARIES'] === '1';
const missing = probe.binaries.filter((binary) => !hasBinary(binary));

async function probeFixture(name: string, options: Record<string, unknown> = {}) {
    const result = await runOperation(probe, { input: fixture(name), options });
    await result.cleanup();
    expect(validate('ProbeMetadata', result.metadata).valid).toBe(true);
    expect(result.files).toEqual([]);
    return result.metadata;
}

describe('probe without binaries', () => {
    it('reports the type and size of any file', async () => {
        expect(await probeFixture('random.bin')).toEqual({
            kind: 'other',
            mime: 'application/octet-stream',
            size: 2048,
        });
    });

    it('reads the size of an SVG from its root element', async () => {
        expect(await probeFixture('image.svg')).toEqual({
            kind: 'image',
            mime: 'image/svg+xml',
            extension: 'svg',
            size: 174,
            width: 120,
            height: 80,
            rotation: 0,
            animated: false,
        });
    });

    it('adds a checksum when asked', async () => {
        const metadata = await probeFixture('random.bin', { checksum: true });
        expect(metadata?.['checksum']).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe.skipIf(missing.length > 0 && !required)('probe', () => {
    it('has its binaries', () => {
        expect(missing).toEqual([]);
    });

    it('reads a video', async () => {
        expect(await probeFixture('video.mp4')).toMatchObject({
            kind: 'video',
            mime: 'video/mp4',
            extension: 'mp4',
            width: 160,
            height: 120,
            rotation: 0,
            frameRate: 25,
            videoCodec: 'h264',
            audioCodec: 'aac',
            audioChannels: 2,
            duration: expect.closeTo(1, 1),
            bitrate: expect.any(Number),
        });
    });

    it('reads the rotation of a video, clockwise', async () => {
        // The fixture has a display matrix that turns it 90° counterclockwise.
        expect(await probeFixture('rotated.mp4')).toMatchObject({
            width: 160,
            height: 120,
            rotation: 270,
        });
    });

    it('reads an audio file', async () => {
        const metadata = await probeFixture('audio.mp3');
        expect(metadata).toMatchObject({
            kind: 'audio',
            mime: 'audio/mpeg',
            audioCodec: 'mp3',
            audioChannels: 1,
            duration: expect.closeTo(1, 1),
        });
        expect(metadata).not.toHaveProperty('width');
    });

    it('reads an image', async () => {
        expect(await probeFixture('image.png')).toEqual({
            kind: 'image',
            mime: 'image/png',
            extension: 'png',
            size: 299,
            width: 64,
            height: 48,
            rotation: 0,
            animated: false,
        });
    });

    it('reads the EXIF orientation, and never the GPS data', async () => {
        const metadata = await probeFixture('photo.jpg');
        expect(metadata).toMatchObject({
            kind: 'image',
            width: 40,
            height: 30,
            rotation: 90,
            exif: { Make: 'Eclair', Model: 'Fixture', Orientation: '6' },
        });
        expect(JSON.stringify(metadata)).not.toMatch(/GPS|45\/1/);
        expect(await probeFixture('photo.jpg', { exif: false })).not.toHaveProperty('exif');
    });

    it('recognizes an animated image', async () => {
        expect(await probeFixture('animated.gif')).toMatchObject({
            mime: 'image/gif',
            width: 20,
            height: 20,
            animated: true,
        });
    });

    it('reads HEIC and HEIF sequences at their primary image', async () => {
        expect(await probeFixture('sequence.heic')).toMatchObject({
            kind: 'image',
            mime: 'image/heic-sequence',
            width: 64,
            height: 64,
        });
        expect(await probeFixture('sequence.heif')).toMatchObject({
            kind: 'image',
            mime: 'image/heif-sequence',
            width: 64,
            height: 64,
        });
    });

    it('adds a ThumbHash placeholder of an image when asked, upright', async () => {
        expect(await probeFixture('photo.jpg')).not.toHaveProperty('thumbhash');

        const metadata = await probeFixture('photo.jpg', { thumbhash: true });
        const hash = Buffer.from(String(metadata?.['thumbhash']), 'base64');
        // The fixture is 40 × 30 with the EXIF orientation 6: upright, it is 30 × 40.
        expect(thumbHashToApproximateAspectRatio(hash)).toBeCloseTo(0.75, 1);
    });

    it('keeps the colors and the transparency in the placeholder', async () => {
        const square = await probeFixture('image.png', { thumbhash: true });
        const color = thumbHashToAverageRGBA(Buffer.from(String(square?.['thumbhash']), 'base64'));
        // The fixture is one color, srgb(51,102,204).
        expect(color.r * 255).toBeCloseTo(51, -1);
        expect(color.g * 255).toBeCloseTo(102, -1);
        expect(color.b * 255).toBeCloseTo(204, -1);
        expect(color.a).toBe(1);

        const transparent = await probeFixture('transparent.png', { thumbhash: true });
        const average = thumbHashToAverageRGBA(
            Buffer.from(String(transparent?.['thumbhash']), 'base64'),
        );
        // Its right fifth is transparent.
        expect(average.a).toBeLessThan(0.95);

        const sequence = await probeFixture('sequence.heic', { thumbhash: true });
        expect(sequence?.['thumbhash']).toEqual(expect.any(String));
    });

    it('gives no placeholder to an SVG, a video or an unreadable image', async () => {
        expect(await probeFixture('image.svg', { thumbhash: true })).not.toHaveProperty(
            'thumbhash',
        );
        expect(await probeFixture('video.mp4', { thumbhash: true })).not.toHaveProperty(
            'thumbhash',
        );
    });

    it('reads a PDF', async () => {
        expect(await probeFixture('document.pdf')).toMatchObject({
            kind: 'document',
            mime: 'application/pdf',
            pageCount: 2,
            width: 200,
            height: 100,
        });
    });

    it('reads the names of a font', async () => {
        expect(await probeFixture('font.ttf')).toMatchObject({
            kind: 'font',
            mime: 'font/ttf',
            fontNames: ['Eclair Test'],
        });
    });

    it('fails clearly on a file that lies about its type', async () => {
        await expect(runOperation(probe, { input: fixture('broken.mp4') })).rejects.toMatchObject({
            code: 'input_unreadable',
            message: "The file can't be read as video.",
        });
    });
});
