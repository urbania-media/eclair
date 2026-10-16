import { Type } from 'typebox';

import { OperationError } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

/** Image types the operations read, with libvips. GIFs are read at their first frame. */
export const IMAGE_MIMES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/tiff',
    'image/svg+xml',
];

/** No limit, for a side `vips thumbnail` shouldn't constrain. */
const UNBOUNDED = 10_000_000;

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export const FORMATS: Record<
    ImageFormat,
    { extension: string; mime: string; coder: string; quality: number | undefined }
> = {
    jpeg: { extension: 'jpg', mime: 'image/jpeg', coder: 'jpeg', quality: 85 },
    png: { extension: 'png', mime: 'image/png', coder: 'png', quality: undefined },
    webp: { extension: 'webp', mime: 'image/webp', coder: 'webp', quality: 80 },
    avif: { extension: 'avif', mime: 'image/avif', coder: 'avif', quality: 50 },
};

export const Format = (fallback: ImageFormat) =>
    Type.Union(
        [Type.Literal('jpeg'), Type.Literal('png'), Type.Literal('webp'), Type.Literal('avif')],
        { default: fallback, description: 'Image format.' },
    );

export const Quality = Type.Optional(
    Type.Integer({
        minimum: 1,
        maximum: 100,
        description: 'Quality of JPEG, WebP and AVIF, from 1 to 100: 85, 80 and 50 by default.',
    }),
);

/**
 * The environment of vips: its untrusted loaders (ImageMagick, MATLAB, FITS…) are blocked, so a
 * file is only read by the loader of its detected type. librsvg is one of them: it's allowed for
 * SVG inputs only.
 */
export function vipsEnvironment(mime: string): Record<string, string> {
    return mime === 'image/svg+xml' ? {} : { VIPS_BLOCK_UNTRUSTED: '1' };
}

/** The file name of a vips output, with its save options: no metadata, alpha flattened on white. */
export function vipsTarget(path: string, format: ImageFormat, quality: number | undefined): string {
    const settings = FORMATS[format];
    const options = ['keep=none'];
    const q = quality ?? settings.quality;
    if (q !== undefined) {
        options.push(`Q=${q}`);
    }
    if (format === 'jpeg') {
        options.push('background=255');
    }
    return `${path}[${options.join(',')}]`;
}

export interface ResizeOptions {
    width?: number | undefined;
    height?: number | undefined;
    crop?: 'none' | 'centre' | 'attention' | undefined;
}

/**
 * Writes `input` to `output` within a size, upright and in sRGB, never enlarged. `output` is a
 * `vipsTarget()`.
 */
export async function vipsThumbnail(
    context: OperationContext,
    input: string,
    mime: string,
    output: string,
    resize: ResizeOptions,
): Promise<void> {
    try {
        await context.exec(
            'vips',
            [
                'thumbnail',
                input,
                output,
                String(resize.width ?? UNBOUNDED),
                '--height',
                String(resize.height ?? UNBOUNDED),
                '--size',
                'down',
                '--export-profile',
                'srgb',
                ...(resize.crop === undefined || resize.crop === 'none'
                    ? []
                    : ['--crop', resize.crop]),
            ],
            { env: vipsEnvironment(mime) },
        );
    } catch (error) {
        throw new OperationError('input_unreadable', "The file can't be read as an image.", {
            cause: error,
        });
    }
}

/** The size of an image the operation wrote, read with ImageMagick. */
export async function imageSize(
    context: OperationContext,
    path: string,
    format: ImageFormat,
): Promise<{ width: number; height: number }> {
    const { stdout } = await context.exec('magick', [
        'identify',
        '-ping',
        '-format',
        '%w %h\\n',
        `${FORMATS[format].coder}:${path}`,
    ]);
    const [width, height] = (stdout.trim().split('\n')[0] ?? '').split(' ').map(Number);
    return { width: width ?? 0, height: height ?? 0 };
}
