import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { probeFile, runOn } from './test-helpers.ts';
import { fitResolution, thumbnails } from './thumbnails.ts';

/** Checks sizes to the pixel: pdftoppm rounds up or down depending on the page. */
function expectSizes(
    streams: ({ width?: number; height?: number } | undefined)[],
    expected: [number, number][],
): void {
    expect(streams).toHaveLength(expected.length);
    for (const [index, [width, height]] of expected.entries()) {
        expect(Math.abs((streams[index]?.width ?? 0) - width)).toBeLessThanOrEqual(1);
        expect(Math.abs((streams[index]?.height ?? 0) - height)).toBeLessThanOrEqual(1);
    }
}

describe('fitResolution', () => {
    it('lowers the resolution to fit a size, never raises it', () => {
        const letter = { width: 612, height: 792 };
        expect(fitResolution(letter, 150, undefined, undefined)).toBe(150);
        expect(fitResolution(letter, 150, 425, undefined)).toBe(50);
        expect(fitResolution(letter, 150, 10_000, 330)).toBe(30);
    });
});

describe.skipIf(skipWithoutBinaries(thumbnails.binaries))('document.thumbnails', () => {
    it('has its binaries', () => {
        expect(missingBinaries(thumbnails.binaries)).toEqual([]);
    });

    it('renders every page at 150 dpi in JPEG, like the mediatheque', async () => {
        const result = await runOn(thumbnails, 'document.pdf');
        try {
            expect(result.files.map(({ name, mime, role }) => ({ name, mime, role }))).toEqual(
                ['0.jpg', '1.jpg', '2.jpg'].map((name) => ({
                    name,
                    mime: 'image/jpeg',
                    role: 'thumbnail',
                })),
            );
            expect(result.metadata).toEqual({ pageCount: 3, pages: [1, 2, 3] });
            // 200 × 100 points at 150 dpi; the second page is portrait, the third is rotated.
            const streams = result.files.map(({ path }) => probeFile(path).streams[0]);
            expect(streams[0]?.codec_name).toBe('mjpeg');
            expectSizes(streams, [
                [417, 208],
                [208, 417],
                [208, 417],
            ]);
            expect(result.progress.at(-1)).toBe(1);
        } finally {
            await result.cleanup();
        }
    });

    it('renders some pages in PNG, within a size', async () => {
        const result = await runOn(thumbnails, 'document.pdf', {
            pages: [3, 1, 9],
            maxWidth: 100,
            format: 'png',
        });
        try {
            expect(result.files.map(({ name }) => name)).toEqual(['0.png', '1.png']);
            expect(result.metadata).toEqual({ pageCount: 3, pages: [3, 1] });
            const streams = result.files.map(({ path }) => probeFile(path).streams[0]);
            expect(streams[0]?.codec_name).toBe('png');
            expectSizes(streams, [
                [100, 200],
                [100, 50],
            ]);
        } finally {
            await result.cleanup();
        }
    });

    it('renders the first pages', async () => {
        const result = await runOn(thumbnails, 'document.pdf', { count: 2, resolution: 72 });
        try {
            expect(result.metadata).toEqual({ pageCount: 3, pages: [1, 2] });
        } finally {
            await result.cleanup();
        }
    });

    it('fails on pages the document lacks, and on a broken PDF', async () => {
        await expect(runOn(thumbnails, 'document.pdf', { pages: [7] })).rejects.toMatchObject({
            code: 'unsupported_input',
        });
        await expect(runOn(thumbnails, 'broken.pdf')).rejects.toMatchObject({
            code: 'input_unreadable',
        });
    });
});
