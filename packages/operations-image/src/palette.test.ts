import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { palette, parseHistogram } from './palette.ts';
import { runOn } from './test-helpers.ts';

/** Whether two hex colors are within a few levels on each channel: quantization rounds. */
function near(actual: string | undefined, expected: string): boolean {
    const channels = (hex: string) =>
        [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    const a = channels(actual ?? '#000000');
    return channels(expected).every((value, index) => Math.abs(value - (a[index] ?? 0)) <= 4);
}

describe('parseHistogram', () => {
    it('sorts the colors of the histogram section, and leaves transparent pixels out', () => {
        expect(
            parseHistogram(
                [
                    '  Colors: 4',
                    '  Histogram:',
                    '        30: (0,0,255,255) #0000FFFF blue',
                    '        50: (255,0,0,255) #FF0000FF red',
                    '        20: (0,0,0,0) #00000000 none',
                    '        10: (255,255,255) #FFFFFF white',
                    '  Colormap entries: 4',
                    '  Colormap:',
                    '    0: (255,0,0,1) #FF0000FF red',
                ].join('\n'),
            ),
        ).toEqual([
            { hex: '#ff0000', ratio: 0.556 },
            { hex: '#0000ff', ratio: 0.333 },
            { hex: '#ffffff', ratio: 0.111 },
        ]);
    });
});

describe.skipIf(skipWithoutBinaries(palette.binaries))('image.palette', () => {
    it('has its binaries', () => {
        expect(missingBinaries(palette.binaries)).toEqual([]);
    });

    it('returns the dominant colors of the opaque pixels', async () => {
        const result = await runOn(palette, 'palette.png', { count: 3 });
        try {
            expect(result.files).toEqual([]);
            // Half of the fixture is red, 30% blue, the rest transparent.
            const colors = result.metadata?.['colors'] as { hex: string; ratio: number }[];
            expect(colors).toHaveLength(2);
            expect(near(colors[0]?.hex, '#ff0000')).toBe(true);
            expect(near(colors[1]?.hex, '#0000ff')).toBe(true);
            expect(colors.map(({ ratio }) => ratio)).toEqual([
                expect.closeTo(0.625, 1),
                expect.closeTo(0.375, 1),
            ]);
            expect(result.metadata?.['dominant']).toBe(colors[0]?.hex);
        } finally {
            await result.cleanup();
        }
    });

    it('reads a photo and an SVG', async () => {
        const photo = await runOn(palette, 'photo.heic');
        const svg = await runOn(palette, 'image.svg', { count: 1 });
        try {
            expect((photo.metadata?.['colors'] as unknown[]).length).toBeGreaterThan(1);
            const colors = svg.metadata?.['colors'] as { hex: string; ratio: number }[];
            expect(colors).toHaveLength(1);
            expect(near(colors[0]?.hex, '#3366cc')).toBe(true);
            expect(colors[0]?.ratio).toBe(1);
        } finally {
            await photo.cleanup();
            await svg.cleanup();
        }
    });
});
