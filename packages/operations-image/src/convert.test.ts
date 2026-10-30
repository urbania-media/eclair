import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { convert } from './convert.ts';
import { identify, pixel, runOn } from './test-helpers.ts';

describe.skipIf(skipWithoutBinaries(convert.binaries))('image.convert', () => {
    it('has its binaries', () => {
        expect(missingBinaries(convert.binaries)).toEqual([]);
    });

    it('writes an upright WebP without EXIF or GPS by default', async () => {
        const result = await runOn(convert, 'photo.jpg');
        try {
            expect(result.files).toEqual([
                {
                    name: 'image.webp',
                    path: expect.stringMatching(/image\.webp$/),
                    mime: 'image/webp',
                    role: 'main',
                },
            ]);
            // The fixture is 40 × 30 with the EXIF orientation 6 (a quarter turn) and GPS tags.
            expect(result.metadata).toEqual({ width: 30, height: 40 });
            const output = identify(result.files[0]?.path ?? '');
            expect(output).toMatchObject({ format: 'WEBP', width: 30, height: 40 });
            expect(output.properties).not.toMatch(/GPS|exif/i);
        } finally {
            await result.cleanup();
        }
    });

    it('scales down to JPEG, with transparency on white', async () => {
        const result = await runOn(convert, 'palette.png', {
            format: 'jpeg',
            maxWidth: 100,
            quality: 90,
        });
        try {
            expect(result.files[0]).toMatchObject({ name: 'image.jpg', mime: 'image/jpeg' });
            expect(result.metadata).toEqual({ width: 100, height: 50 });
            // The right fifth of the fixture is transparent.
            expect(pixel(result.files[0]?.path ?? '', 95, 25)).toMatch(
                /^srgb\(25[0-5],25[0-5],25[0-5]\)$/,
            );
        } finally {
            await result.cleanup();
        }
    });

    it('never enlarges', async () => {
        const result = await runOn(convert, 'photo.jpg', { maxWidth: 1000, format: 'png' });
        try {
            expect(result.metadata).toEqual({ width: 30, height: 40 });
        } finally {
            await result.cleanup();
        }
    });

    it('reads HEIC and writes AVIF', async () => {
        const result = await runOn(convert, 'photo.heic', { format: 'avif', maxHeight: 60 });
        try {
            expect(result.files[0]).toMatchObject({ name: 'image.avif', mime: 'image/avif' });
            expect(result.metadata).toEqual({ width: 80, height: 60 });
        } finally {
            await result.cleanup();
        }
    });

    it('reads HEIC and HEIF sequences at their primary image', async () => {
        for (const name of ['sequence.heic', 'sequence.heif']) {
            const result = await runOn(convert, name, { format: 'jpeg' });
            try {
                expect(result.metadata).toEqual({ width: 64, height: 64 });
                // The primary image is the first frame, red.
                expect(pixel(result.files[0]?.path ?? '', 32, 32)).toMatch(
                    /^srgb\((19[0-9]|2[0-1][0-9]),([3-6][0-9]),([3-6][0-9])\)$/,
                );
            } finally {
                await result.cleanup();
            }
        }
    });

    it('renders an SVG', async () => {
        const result = await runOn(convert, 'image.svg', { format: 'png' });
        try {
            expect(result.metadata).toEqual({ width: 120, height: 80 });
            expect(pixel(result.files[0]?.path ?? '', 60, 40)).toBe('srgba(51,102,204,1)');
        } finally {
            await result.cleanup();
        }
    });

    it('reads the first frame of a GIF', async () => {
        const result = await runOn(convert, 'animated.gif', { format: 'png' });
        try {
            expect(result.metadata).toEqual({ width: 20, height: 20 });
        } finally {
            await result.cleanup();
        }
    });

    it('adds a ThumbHash placeholder to the image when asked', async () => {
        const plain = await runOn(convert, 'photo.jpg', { maxWidth: 100 });
        const result = await runOn(convert, 'photo.jpg', { maxWidth: 100, thumbhash: true });
        try {
            expect(plain.files[0]?.thumbhash).toBeUndefined();
            expect(result.files[0]?.thumbhash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        } finally {
            await plain.cleanup();
            await result.cleanup();
        }
    });
});
