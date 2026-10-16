import { join } from 'node:path';
import { Type } from 'typebox';

import { defineOperation } from '@eclair-js/operation';

import {
    FORMATS,
    Format,
    IMAGE_MIMES,
    Quality,
    imageSize,
    vipsTarget,
    vipsThumbnail,
} from './media.ts';

const ConvertOptions = Type.Object(
    {
        format: Format('webp'),
        maxWidth: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: 32_000,
                description: 'Maximum width, in pixels. Images are never enlarged.',
            }),
        ),
        maxHeight: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: 32_000,
                description: 'Maximum height, in pixels. Images are never enlarged.',
            }),
        ),
        quality: Quality,
    },
    { additionalProperties: false },
);

/**
 * Converts an image to JPEG, PNG, WebP or AVIF, upright, in sRGB and without its metadata (EXIF,
 * GPS, XMP), within a size. Transparency is flattened on white in JPEG.
 */
export const convert = defineOperation({
    name: 'image.convert',
    version: 1,
    description:
        'JPEG, PNG, WebP or AVIF within a size, auto-oriented, in sRGB, with EXIF, GPS and other metadata stripped.',
    accepts: { mimes: IMAGE_MIMES },
    capability: 'cpu',
    binaries: ['vips', 'magick'],
    options: ConvertOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const { extension, mime } = FORMATS[options.format];
        const name = `image.${extension}`;
        const path = join(context.workdir, name);
        await vipsThumbnail(
            context,
            context.input.path,
            context.input.mime,
            vipsTarget(path, options.format, options.quality),
            { width: options.maxWidth, height: options.maxHeight },
        );
        context.output(name, path, { mime, role: 'main' });
        return { metadata: { ...(await imageSize(context, path, options.format)) } };
    },
});
