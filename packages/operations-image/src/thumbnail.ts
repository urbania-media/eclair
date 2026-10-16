import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation } from '@eclair-js/operation';

import {
    FORMATS,
    Format,
    IMAGE_MIMES,
    Quality,
    imageSize,
    vipsTarget,
    vipsThumbnail,
} from './media.ts';

/** The largest page a PDF is rendered at before its thumbnails are made, in pixels. */
const MAX_PAGE_SIZE = 8000;

const Size = Type.Object(
    {
        width: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000 })),
        height: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000 })),
        crop: Type.Union(
            [Type.Literal('none'), Type.Literal('centre'), Type.Literal('attention')],
            {
                default: 'none',
                description:
                    '`none` fits the image in the size; `centre` fills the size and crops the middle; `attention` crops the most interesting part. Cropping needs a width and a height.',
            },
        ),
    },
    { additionalProperties: false },
);

const ThumbnailOptions = Type.Object(
    {
        sizes: Type.Array(Size, {
            minItems: 1,
            maxItems: 20,
            default: [{ width: 320, height: 320 }],
            description: 'One thumbnail per size, never larger than the image.',
        }),
        format: Format('jpeg'),
        quality: Quality,
    },
    { additionalProperties: false },
);

/**
 * Thumbnails at given sizes, from an image or the first page of a PDF: `0.jpg`, `1.jpg`…, one per
 * size, upright, in sRGB and without metadata.
 */
export const thumbnail = defineOperation({
    name: 'image.thumbnail',
    version: 1,
    description:
        'Thumbnails at given sizes, fitted or cropped, from an image or the first page of a PDF.',
    accepts: { mimes: [...IMAGE_MIMES, 'application/pdf'] },
    capability: 'cpu',
    binaries: ['vips', 'magick', 'pdftoppm'],
    options: ThumbnailOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        for (const size of options.sizes) {
            if (size.width === undefined && size.height === undefined) {
                throw new OperationError('operation_failed', 'A size needs a width or a height.');
            }
            if (size.crop !== 'none' && (size.width === undefined || size.height === undefined)) {
                throw new OperationError(
                    'operation_failed',
                    'Cropping needs a width and a height.',
                );
            }
        }

        let source = context.input.path;
        let mime = context.input.mime;
        if (mime === 'application/pdf') {
            // The first page, large enough for the largest thumbnail, even cropped.
            const largest = Math.max(
                ...options.sizes.map(({ width, height }) => Math.max(width ?? 0, height ?? 0)),
            );
            const base = join(context.workdir, 'page');
            try {
                await context.exec('pdftoppm', [
                    '-q',
                    '-f',
                    '1',
                    '-l',
                    '1',
                    '-singlefile',
                    '-png',
                    '-scale-to',
                    String(Math.min(MAX_PAGE_SIZE, largest * 2)),
                    context.input.path,
                    base,
                ]);
            } catch (error) {
                throw new OperationError('input_unreadable', "The file can't be read as a PDF.", {
                    cause: error,
                });
            }
            source = `${base}.png`;
            mime = 'image/png';
        }

        const { extension, mime: outputMime } = FORMATS[options.format];
        const sizes = [];
        for (const [index, size] of options.sizes.entries()) {
            const name = `${index}.${extension}`;
            const path = join(context.workdir, name);
            await vipsThumbnail(
                context,
                source,
                mime,
                vipsTarget(path, options.format, options.quality),
                size,
            );
            context.output(name, path, { mime: outputMime, role: 'thumbnail' });
            sizes.push(await imageSize(context, path, options.format));
            context.progress((index + 1) / options.sizes.length);
        }
        return { metadata: { sizes } };
    },
});
