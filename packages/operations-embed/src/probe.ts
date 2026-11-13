import { Type } from 'typebox';

import { OperationError, defineEmbedOperation } from '@eclair-js/operation';

import { PROVIDERS } from './providers/index.ts';
import { YTDLP, canUseYtdlp, completeWithInfo, ytdlpInfo } from './ytdlp.ts';

/** How long a provider's answer is kept, in seconds: an hour. */
const CACHE_TTL = 60 * 60;

/**
 * Reads what a provider says about an embed: its kind, duration and dimensions when the provider
 * gives them, and the `embed` object of the probe's metadata (decision 0022). It calls the
 * provider's API or oEmbed endpoint, never the page itself, and caches the answer for an hour.
 */
export const embedProbe = defineEmbedOperation({
    name: 'embed.probe',
    version: 1,
    description:
        'Read the metadata of a video or audio on a platform (YouTube, Vimeo, Dailymotion, SoundCloud, Spotify, TikTok, Instagram), from its API or oEmbed.',
    capability: 'probe',
    binaries: [],
    optionalBinaries: [YTDLP],
    options: Type.Object(
        {
            refresh: Type.Boolean({
                default: false,
                description: 'Ask the provider again instead of using an answer of the last hour.',
            }),
            complete: Type.Boolean({
                default: false,
                description:
                    "Fill what the API and oEmbed don't give, such as the duration of SoundCloud, TikTok and Instagram embeds, with yt-dlp, when the server has it. It asks the platform's page, so it is slower.",
            }),
        },
        { additionalProperties: false },
    ),
    outputs: { files: false, metadata: true },

    async run(context, options) {
        const module = PROVIDERS.get(context.input.provider);
        if (module === undefined) {
            throw new OperationError(
                'unsupported_input',
                `embed.probe doesn't read embeds from ${context.input.provider}.`,
            );
        }
        // The answer depends on the credentials: a key gives more than oEmbed.
        const key = `${context.input.provider}:${context.input.id}:${context.credentials === undefined ? 'public' : 'credentials'}${options.complete ? ':complete' : ''}`;
        if (!options.refresh) {
            const cached = await context.cache.get(key);
            if (typeof cached === 'object' && cached !== null) {
                return { metadata: cached as Record<string, unknown> };
            }
        }
        let metadata = await module.probe(context);
        if (options.complete && metadata.duration === undefined && (await canUseYtdlp(context))) {
            try {
                metadata = completeWithInfo(metadata, await ytdlpInfo(context));
            } catch (error) {
                // What the provider gave stands: yt-dlp only adds to it.
                context.log.warn('yt-dlp could not complete the probe', {
                    error: (error as Error).message,
                });
            }
        }
        await context.cache.set(key, metadata, CACHE_TTL);
        context.progress(1);
        return { metadata: metadata as Record<string, unknown> };
    },
});
