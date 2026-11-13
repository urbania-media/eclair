import { Type } from 'typebox';

import { OperationError, defineEmbedOperation } from '@eclair-js/operation';

import { removeUndefined } from './common.ts';
import { PROVIDERS } from './providers/index.ts';

/**
 * Downloads the file of an embed, for the other tasks of the job (decision 0022): only from the
 * providers of the project's `embedDownload`, within its size and duration limits. It runs on the
 * `network` queue, so it holds no CPU slot while it waits on the network.
 */
export const embedDownload = defineEmbedOperation({
    name: 'embed.download',
    version: 1,
    description:
        'Download the file of a video on a platform, when the platform gives it to its owner (Vimeo), for the other tasks of the job.',
    capability: 'network',
    binaries: [],
    downloads: true,
    options: Type.Object(
        {
            quality: Type.Union(
                [Type.Literal('best'), Type.Integer({ minimum: 144, maximum: 4320 })],
                {
                    default: 'best',
                    description:
                        '`best` (the original when there is one), or the largest height to download.',
                },
            ),
            audioOnly: Type.Boolean({
                default: false,
                description: 'Only the soundtrack, where the provider gives it apart.',
            }),
        },
        { additionalProperties: false },
    ),
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const module = PROVIDERS.get(context.input.provider);
        if (module?.download === undefined) {
            throw new OperationError(
                'unsupported_input',
                `embed.download can't download from ${context.input.provider} yet.`,
            );
        }
        const metadata = await module.download(context, {
            quality: options.quality,
            audioOnly: options.audioOnly,
        });
        context.progress(1);
        return { metadata: removeUndefined(metadata) };
    },
});
