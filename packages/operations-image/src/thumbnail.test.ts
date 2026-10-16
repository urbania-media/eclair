import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { identify, runOn } from './test-helpers.ts';
import { thumbnail } from './thumbnail.ts';

describe.skipIf(skipWithoutBinaries(thumbnail.binaries))('image.thumbnail', () => {
    it('has its binaries', () => {
        expect(missingBinaries(thumbnail.binaries)).toEqual([]);
    });

    it('writes thumbnails at each size, fitted or cropped', async () => {
        const result = await runOn(thumbnail, 'palette.png', {
            sizes: [{ width: 50 }, { width: 40, height: 40, crop: 'centre' }, { height: 10 }],
            format: 'webp',
        });
        try {
            expect(result.files.map(({ name, mime, role }) => ({ name, mime, role }))).toEqual(
                ['0.webp', '1.webp', '2.webp'].map((name) => ({
                    name,
                    mime: 'image/webp',
                    role: 'thumbnail',
                })),
            );
            expect(result.metadata).toEqual({
                sizes: [
                    { width: 50, height: 25 },
                    { width: 40, height: 40 },
                    { width: 20, height: 10 },
                ],
            });
            expect(identify(result.files[1]?.path ?? '')).toMatchObject({ format: 'WEBP' });
        } finally {
            await result.cleanup();
        }
    });

    it('writes a 320 px JPEG by default, never enlarged', async () => {
        const result = await runOn(thumbnail, 'photo.jpg');
        try {
            expect(result.files.map(({ name }) => name)).toEqual(['0.jpg']);
            expect(result.metadata).toEqual({ sizes: [{ width: 30, height: 40 }] });
        } finally {
            await result.cleanup();
        }
    });

    it('makes thumbnails of the first page of a PDF', async () => {
        const result = await runOn(thumbnail, 'document.pdf', {
            sizes: [{ width: 100 }, { width: 50, height: 50, crop: 'attention' }],
            format: 'png',
        });
        try {
            // The first page is 200 × 100 points.
            expect(result.metadata).toEqual({
                sizes: [
                    { width: 100, height: 50 },
                    { width: 50, height: 50 },
                ],
            });
        } finally {
            await result.cleanup();
        }
    });

    it('refuses a crop without both sides', async () => {
        await expect(
            runOn(thumbnail, 'photo.jpg', { sizes: [{ width: 10, crop: 'centre' }] }),
        ).rejects.toMatchObject({ code: 'operation_failed' });
    });
});
