import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation, thumbhash, thumbhashOption } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

/** The most pages one task renders. */
const MAX_PAGES = 1000;

/** The defaults are those of laravel-mediatheque's document `Thumbnails` job. */
const ThumbnailsOptions = Type.Object(
    {
        count: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: MAX_PAGES,
                description: 'Renders the first pages only. Every page by default.',
            }),
        ),
        pages: Type.Optional(
            Type.Array(Type.Integer({ minimum: 1 }), {
                minItems: 1,
                maxItems: MAX_PAGES,
                uniqueItems: true,
                description:
                    'Renders these pages, numbered from 1, instead of `count`. Pages after the last one are left out.',
            }),
        ),
        resolution: Type.Integer({
            minimum: 18,
            maximum: 600,
            default: 150,
            description: 'Resolution, in dots per inch.',
        }),
        maxWidth: Type.Optional(
            Type.Integer({
                minimum: 16,
                maximum: 10_000,
                description: 'Maximum width, in pixels: the resolution is lowered to fit.',
            }),
        ),
        maxHeight: Type.Optional(
            Type.Integer({
                minimum: 16,
                maximum: 10_000,
                description: 'Maximum height, in pixels: the resolution is lowered to fit.',
            }),
        ),
        format: Type.Union([Type.Literal('jpeg'), Type.Literal('png')], {
            default: 'jpeg',
            description: 'Image format of the pages, on a white background.',
        }),
        quality: Type.Integer({
            minimum: 1,
            maximum: 100,
            default: 100,
            description: 'JPEG quality, from 1 to 100.',
        }),
        ...thumbhashOption,
    },
    { additionalProperties: false },
);

interface Page {
    number: number;
    /** Size in points, as displayed: the rotation is applied. */
    width: number;
    height: number;
}

/** The number of pages of a PDF, and the size of the pages up to `last`, from pdfinfo. */
async function readPages(
    context: OperationContext,
    last: number,
): Promise<{ count: number; pages: Page[] }> {
    let stdout: string;
    try {
        ({ stdout } = await context.exec('pdfinfo', [
            '-f',
            '1',
            '-l',
            String(last),
            context.input.path,
        ]));
    } catch (error) {
        throw new OperationError('input_unreadable', "The file can't be read as a PDF.", {
            cause: error,
        });
    }
    const pages = new Map<number, Page>();
    for (const match of stdout.matchAll(/^Page\s+(\d+) size:\s+([0-9.]+) x ([0-9.]+) pts/gm)) {
        const number = Number(match[1]);
        pages.set(number, { number, width: Number(match[2]), height: Number(match[3]) });
    }
    for (const match of stdout.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)) {
        const page = pages.get(Number(match[1]));
        if (page !== undefined && (Number(match[2]) / 90) % 2 === 1) {
            pages.set(page.number, { ...page, width: page.height, height: page.width });
        }
    }
    const count = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    return { count, pages: [...pages.values()].filter(({ number }) => number <= count) };
}

/** The resolution that renders a page within `maxWidth` and `maxHeight`. */
export function fitResolution(
    page: { width: number; height: number },
    resolution: number,
    maxWidth: number | undefined,
    maxHeight: number | undefined,
): number {
    const width = (page.width / 72) * resolution;
    const height = (page.height / 72) * resolution;
    const scale = Math.min(
        1,
        maxWidth === undefined ? 1 : maxWidth / width,
        maxHeight === undefined ? 1 : maxHeight / height,
    );
    return Math.round(resolution * scale * 1000) / 1000;
}

/**
 * One image per page of a PDF, like laravel-mediatheque's document `Thumbnails` job: `0.jpg` for
 * the first page rendered, `1.jpg`… Rendered by poppler, not by ImageMagick and Ghostscript.
 */
export const thumbnails = defineOperation({
    name: 'document.thumbnails',
    version: 1,
    description:
        'One JPEG or PNG image per page of a PDF, or for some pages, at a resolution or within a size.',
    accepts: { mimes: ['application/pdf'] },
    capability: 'cpu',
    binaries: ['pdfinfo', 'pdftoppm', 'vips'],
    options: ThumbnailsOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const wanted = options.pages ?? [];
        const last =
            options.pages === undefined ? (options.count ?? MAX_PAGES) : Math.max(...wanted);
        const document = await readPages(context, last);
        if (
            options.pages === undefined &&
            options.count === undefined &&
            document.count > MAX_PAGES
        ) {
            throw new OperationError(
                'limit_exceeded',
                `The document has ${document.count} pages: render up to ${MAX_PAGES} with count or pages.`,
            );
        }
        const pages =
            options.pages === undefined
                ? document.pages
                : wanted.flatMap((number) =>
                      document.pages.filter((page) => page.number === number),
                  );
        if (pages.length === 0) {
            throw new OperationError('unsupported_input', 'The document has none of these pages.');
        }

        const extension = options.format === 'jpeg' ? 'jpg' : 'png';
        const mime = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const format =
            options.format === 'jpeg'
                ? ['-jpeg', '-jpegopt', `quality=${options.quality}`]
                : ['-png'];
        for (const [index, page] of pages.entries()) {
            const resolution = fitResolution(
                page,
                options.resolution,
                options.maxWidth,
                options.maxHeight,
            );
            await context.exec('pdftoppm', [
                '-q',
                '-f',
                String(page.number),
                '-l',
                String(page.number),
                '-singlefile',
                '-r',
                String(resolution),
                ...format,
                context.input.path,
                join(context.workdir, String(index)),
            ]);
            const name = `${index}.${extension}`;
            const path = join(context.workdir, name);
            context.output(name, path, {
                mime,
                role: 'thumbnail',
                thumbhash: options.thumbhash ? await thumbhash(context, path) : undefined,
            });
            context.progress((index + 1) / pages.length);
        }
        return {
            metadata: { pageCount: document.count, pages: pages.map(({ number }) => number) },
        };
    },
});
