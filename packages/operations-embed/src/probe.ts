import { Type } from 'typebox';

import { OperationError, defineEmbedOperation } from '@eclair-js/operation';

import { PROVIDERS } from './providers/index.ts';

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
    options: Type.Object(
        {
            refresh: Type.Boolean({
                default: false,
                description: 'Ask the provider again instead of using an answer of the last hour.',
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
        const key = `${context.input.provider}:${context.input.id}:${context.credentials === undefined ? 'public' : 'credentials'}`;
        if (!options.refresh) {
            const cached = await context.cache.get(key);
            if (typeof cached === 'object' && cached !== null) {
                return { metadata: cached as Record<string, unknown> };
            }
        }
        const metadata = await module.probe(context);
        await context.cache.set(key, metadata, CACHE_TTL);
        context.progress(1);
        return { metadata: metadata as Record<string, unknown> };
    },
});
