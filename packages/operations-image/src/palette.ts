import { join } from 'node:path';
import { Type } from 'typebox';

import { defineOperation } from '@eclair-js/operation';

import { IMAGE_MIMES, vipsTarget, vipsThumbnail } from './media.ts';

/** The side the image is reduced to before its colors are counted. */
const SAMPLE_SIZE = 100;

const PaletteOptions = Type.Object(
    {
        count: Type.Integer({
            minimum: 1,
            maximum: 16,
            default: 5,
            description: 'The most colors to return.',
        }),
    },
    { additionalProperties: false },
);

const HISTOGRAM_ENTRY = /^\s*(\d+):\s*\([^)]*\)\s*#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?\b/;

/**
 * Reads the histogram of `magick identify -verbose` (`  1200: (255,0,0,255) #FF0000FF red`, under
 * `Histogram:`): colors and their share of the opaque pixels, the most frequent first. Pixels
 * mostly transparent are left out. The image's ImageMagick policy denies the `histogram:` and
 * `info:` coders, so the histogram comes from `identify`.
 */
export function parseHistogram(verbose: string): { hex: string; ratio: number }[] {
    const lines = verbose.split('\n');
    const start = lines.findIndex((line) => /^\s*Histogram:\s*$/.test(line));
    const colors: { hex: string; count: number }[] = [];
    for (const line of start === -1 ? [] : lines.slice(start + 1)) {
        const match = HISTOGRAM_ENTRY.exec(line);
        if (match?.[1] === undefined || match[2] === undefined) {
            break;
        }
        if (match[3] !== undefined && Number.parseInt(match[3], 16) < 128) {
            continue;
        }
        const hex = `#${match[2].toLowerCase()}`;
        const existing = colors.find((color) => color.hex === hex);
        if (existing === undefined) {
            colors.push({ hex, count: Number(match[1]) });
        } else {
            existing.count += Number(match[1]);
        }
    }
    const total = colors.reduce((sum, { count }) => sum + count, 0);
    return colors
        .sort((a, b) => b.count - a.count)
        .map(({ hex, count }) => ({ hex, ratio: Math.round((count / total) * 1000) / 1000 }));
}

/**
 * The dominant colors of an image and their share, like the palette and dominant color of
 * laravel-mediatheque's `ColorExtractor`. Transparent pixels don't count.
 */
export const palette = defineOperation({
    name: 'image.palette',
    version: 1,
    description:
        'The dominant colors of an image, as hex colors with their share of the opaque pixels.',
    accepts: { mimes: IMAGE_MIMES },
    capability: 'cpu',
    binaries: ['vips', 'magick'],
    options: PaletteOptions,
    outputs: { files: false, metadata: true },

    async run(context, options) {
        const sample = join(context.workdir, 'sample.png');
        await vipsThumbnail(
            context,
            context.input.path,
            context.input.mime,
            vipsTarget(sample, 'png', undefined),
            {
                width: SAMPLE_SIZE,
                height: SAMPLE_SIZE,
            },
        );
        const quantized = join(context.workdir, 'quantized.png');
        await context.exec('magick', [
            `png:${sample}`,
            '-colors',
            String(options.count),
            '-depth',
            '8',
            `png:${quantized}`,
        ]);
        const { stdout } = await context.exec('magick', [
            'identify',
            '-verbose',
            `png:${quantized}`,
        ]);
        const colors = parseHistogram(stdout).slice(0, options.count);
        return {
            metadata: {
                ...(colors[0] === undefined ? {} : { dominant: colors[0].hex }),
                colors,
            },
        };
    },
});
