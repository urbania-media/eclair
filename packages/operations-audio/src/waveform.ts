import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';

import { AUDIO_INPUTS, readAudio } from './media.ts';

/** `rrggbb` or `rrggbbaa`, as audiowaveform takes them. */
const Color = (description: string, value?: string) =>
    Type.String({
        pattern: '^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$',
        description: `${description}, as rrggbb or rrggbbaa.`,
        ...(value === undefined ? {} : { default: value }),
    });

/** The defaults are those of laravel-mediatheque's audio `Thumbnails` job. */
const WaveformOptions = Type.Object(
    {
        image: Type.Boolean({ default: true, description: 'Writes the image, `waveform.png`.' }),
        data: Type.Boolean({
            default: true,
            description: "Writes the data, `waveform.json`, in audiowaveform's JSON format.",
        }),
        width: Type.Integer({
            minimum: 16,
            maximum: 8000,
            default: 1200,
            description: 'Width of the image, in pixels.',
        }),
        height: Type.Integer({
            minimum: 16,
            maximum: 2000,
            default: 400,
            description: 'Height of the image, in pixels.',
        }),
        zoom: Type.Union([Type.Literal('auto'), Type.Integer({ minimum: 1, maximum: 1_000_000 })], {
            default: 'auto',
            description:
                'Samples per pixel of the image. `auto` fits the whole file in the width; a number shows only the start of a long file.',
        }),
        color: Color('Color of the waveform', '000000'),
        backgroundColor: Color('Background color', 'FFFFFF00'),
        borderColor: Type.Optional(Color('Border color')),
        axisLabels: Type.Boolean({ default: false, description: 'Draws the time axis labels.' }),
        axisLabelColor: Type.Optional(Color('Color of the axis labels')),
        style: Type.Union([Type.Literal('normal'), Type.Literal('bars')], {
            default: 'normal',
            description: 'A continuous waveform, or bars.',
        }),
        pixelsPerSecond: Type.Integer({
            minimum: 1,
            maximum: 1000,
            default: 20,
            description: 'Points per second of the data.',
        }),
        bits: Type.Union([Type.Literal(8), Type.Literal(16)], {
            default: 8,
            description: 'Resolution of the data points.',
        }),
    },
    { additionalProperties: false },
);

/**
 * The waveform of an audio file or of a video's soundtrack: the image of laravel-mediatheque's
 * audio `Thumbnails` job, and the data for players. The input is decoded with ffmpeg first, so it
 * can be any format ffmpeg reads, not only those of audiowaveform.
 */
export const waveform = defineOperation({
    name: 'audio.waveform',
    version: 1,
    description:
        "Waveform image (PNG) and data (audiowaveform's JSON), from any audio file or the soundtrack of a video.",
    accepts: AUDIO_INPUTS,
    capability: 'cpu',
    binaries: ['ffprobe', 'ffmpeg', 'audiowaveform'],
    options: WaveformOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        if (!options.image && !options.data) {
            throw new OperationError('operation_failed', 'Ask for the image, the data or both.');
        }
        const audio = await readAudio(context);
        const decoded = join(context.workdir, 'decoded.flac');
        await context.exec(
            'ffmpeg',
            [
                '-hide_banner',
                '-nostdin',
                '-v',
                'error',
                '-y',
                ...ffmpegInput(context.input.path),
                '-map',
                '0:a:0',
                '-vn',
                '-sn',
                '-dn',
                '-map_metadata',
                '-1',
                '-ac',
                '1',
                '-c:a',
                'flac',
                '-sample_fmt',
                's16',
                '-progress',
                'pipe:1',
                '-nostats',
                decoded,
            ],
            { onStdout: ffmpegProgress(audio.duration, (ratio) => context.progress(ratio / 2)) },
        );
        const input = ['-q', '-i', decoded, '--input-format', 'flac'];

        if (options.image) {
            const path = join(context.workdir, 'waveform.png');
            await context.exec('audiowaveform', [
                ...input,
                '-o',
                path,
                '--zoom',
                String(options.zoom),
                '--width',
                String(options.width),
                '--height',
                String(options.height),
                '--background-color',
                options.backgroundColor,
                '--waveform-color',
                options.color,
                '--waveform-style',
                options.style,
                ...(options.borderColor === undefined
                    ? []
                    : ['--border-color', options.borderColor]),
                ...(options.axisLabelColor === undefined
                    ? []
                    : ['--axis-label-color', options.axisLabelColor]),
                options.axisLabels ? '--with-axis-labels' : '--no-axis-labels',
            ]);
            context.output('waveform.png', path, { mime: 'image/png', role: 'main' });
        }
        context.progress(0.75);
        if (options.data) {
            const path = join(context.workdir, 'waveform.json');
            await context.exec('audiowaveform', [
                ...input,
                '-o',
                path,
                '--pixels-per-second',
                String(options.pixelsPerSecond),
                '--bits',
                String(options.bits),
            ]);
            context.output('waveform.json', path, {
                mime: 'application/json',
                role: options.image ? 'data' : 'main',
            });
        }
        return {
            metadata: {
                ...(options.image ? { width: options.width, height: options.height } : {}),
                ...(audio.duration === undefined
                    ? {}
                    : { duration: Math.round(audio.duration * 1000) / 1000 }),
            },
        };
    },
});
