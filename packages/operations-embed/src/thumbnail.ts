import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineEmbedOperation, detectType } from '@eclair-js/operation';

import { objectAt } from './common.ts';
import { readEmbed } from './probe.ts';

/** The image types a thumbnail is kept in: those `image.convert` reads. */
const THUMBNAIL_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** The largest thumbnail, in bytes: providers' are well under a megabyte. */
const MAX_SIZE = 20 * 1024 * 1024;

/**
 * Downloads an embed's thumbnail, as its provider gives it, for the other tasks of the job: an
 * `image.convert` task with `from` makes a poster of it. The thumbnail's URL comes from what
 * `embed.probe` reads, from the same cache, and is downloaded through the SSRF guard. It is not the
 * embed's file, so the project's `embedDownload` doesn't apply.
 */
export const embedThumbnail = defineEmbedOperation({
    name: 'embed.thumbnail',
    version: 1,
    description:
        'Download the thumbnail of a video or audio on a platform, as its provider gives it, for the other tasks of the job (image.convert makes a poster of it).',
    capability: 'network',
    binaries: [],
    options: Type.Object(
        {
            refresh: Type.Boolean({
                default: false,
                description:
                    'Ask the provider again instead of using an answer of the last hour: thumbnails of some providers expire.',
            }),
        },
        { additionalProperties: false },
    ),
    outputs: { files: true, metadata: false },

    async run(context, options) {
        const metadata = await readEmbed(context, { refresh: options.refresh, complete: false });
        const url = objectAt(metadata, 'embed')['thumbnailUrl'];
        if (typeof url !== 'string' || !url.startsWith('https://')) {
            throw new OperationError(
                'provider_unavailable',
                `${context.input.provider} gives no thumbnail for this embed.`,
            );
        }

        const download = join(context.workdir, 'download');
        await context.download(url, download, {
            maxSize: Math.min(MAX_SIZE, context.limits.maxSize),
        });
        // Never the announced type: the file's own.
        const { mime, extension } = await detectType(download);
        if (!THUMBNAIL_MIMES.has(mime) || extension === undefined) {
            await rm(download, { force: true });
            throw new OperationError(
                'provider_failed',
                `${context.input.provider}'s thumbnail is not an image (${mime}).`,
            );
        }
        const name = `thumbnail.${extension}`;
        const path = join(context.workdir, name);
        await rename(download, path);
        context.output(name, path, { mime, role: 'main' });
        context.progress(1);

        return {};
    },
});
