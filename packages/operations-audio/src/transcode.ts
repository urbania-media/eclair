import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

import { AUDIO_INPUTS, readAudio } from './media.ts';

type Codec = 'mp3' | 'aac' | 'opus';

/**
 * Encoders, files and default bitrates. MP3 follows laravel-mediatheque's `Mp3` job, whose 196
 * kbit/s LAME writes as 192, the nearest MP3 bitrate.
 */
const CODECS: Record<Codec, { args: string[]; file: string; mime: string; bitrate: number }> = {
    mp3: { args: ['-c:a', 'libmp3lame'], file: 'audio.mp3', mime: 'audio/mpeg', bitrate: 192 },
    aac: {
        args: ['-c:a', 'aac', '-movflags', '+faststart'],
        file: 'audio.m4a',
        mime: 'audio/mp4',
        bitrate: 160,
    },
    opus: { args: ['-c:a', 'libopus'], file: 'audio.opus', mime: 'audio/ogg', bitrate: 96 },
};

const TranscodeOptions = Type.Object(
    {
        codec: Type.Union([Type.Literal('mp3'), Type.Literal('aac'), Type.Literal('opus')], {
            default: 'mp3',
            description: 'Codec: MP3, AAC in an M4A file, or Opus in an Ogg file.',
        }),
        bitrate: Type.Optional(
            Type.Integer({
                minimum: 8,
                maximum: 512,
                description:
                    'Bitrate, in kbit/s: 192 by default for MP3, 160 for AAC, 96 for Opus.',
            }),
        ),
        channels: Type.Optional(
            Type.Union([Type.Literal(1), Type.Literal(2)], {
                description: 'Mono or stereo. By default, the channels of the input, up to 2.',
            }),
        ),
        sampleRate: Type.Optional(
            Type.Union(
                [
                    Type.Literal(16000),
                    Type.Literal(22050),
                    Type.Literal(24000),
                    Type.Literal(32000),
                    Type.Literal(44100),
                    Type.Literal(48000),
                ],
                { description: 'Sample rate, in Hz. By default, the one of the input.' },
            ),
        ),
        normalize: Type.Boolean({
            default: false,
            description: 'Normalizes the loudness to `loudness`, in two passes (EBU R128).',
        }),
        loudness: Type.Number({
            minimum: -70,
            maximum: -5,
            default: -16,
            description: 'Target integrated loudness of `normalize`, in LUFS.',
        }),
    },
    { additionalProperties: false },
);

interface Measured {
    input_i: string;
    input_tp: string;
    input_lra: string;
    input_thresh: string;
    target_offset: string;
}

/** The first pass of `loudnorm`: what it measured, from the JSON it writes on stderr. */
async function measureLoudness(
    context: OperationContext,
    filter: string,
    duration: number | undefined,
): Promise<Measured> {
    const { stderr } = await context.exec(
        'ffmpeg',
        [
            '-hide_banner',
            '-nostdin',
            '-v',
            'info',
            ...ffmpegInput(context.input.path),
            '-map',
            '0:a:0',
            '-af',
            `${filter}:print_format=json`,
            '-f',
            'null',
            '-progress',
            'pipe:1',
            '-nostats',
            '-',
        ],
        { onStdout: ffmpegProgress(duration, (ratio) => context.progress(ratio / 2)) },
    );
    const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)?.[0];
    if (json === undefined) {
        throw new OperationError('operation_failed', "The loudness couldn't be measured.");
    }
    return JSON.parse(json) as Measured;
}

/** Transcodes audio, or the soundtrack of a video, to MP3, AAC or Opus. */
export const transcode = defineOperation({
    name: 'audio.transcode',
    version: 1,
    description:
        'MP3, AAC (M4A) or Opus, with the bitrate, channels and sample rate, and optional loudness normalization.',
    accepts: AUDIO_INPUTS,
    capability: 'cpu',
    binaries: ['ffprobe', 'ffmpeg'],
    options: TranscodeOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const audio = await readAudio(context);
        const codec = CODECS[options.codec];
        const bitrate = options.bitrate ?? codec.bitrate;
        const channels = options.channels ?? Math.min(2, audio.channels ?? 2);

        const filters: string[] = [];
        let start = 0;
        if (options.normalize) {
            const loudnorm = `loudnorm=I=${options.loudness}:TP=-1.5:LRA=11`;
            const measured = await measureLoudness(context, loudnorm, audio.duration);
            filters.push(
                `${loudnorm}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
                    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
                    `:offset=${measured.target_offset}:linear=true`,
            );
            start = 0.5;
        }
        if (
            options.codec === 'opus' &&
            options.sampleRate !== undefined &&
            ![16000, 24000, 48000].includes(options.sampleRate)
        ) {
            throw new OperationError('operation_failed', 'Opus is 16, 24 or 48 kHz.');
        }
        // loudnorm upsamples to 192 kHz: come back to the rate of the input. Opus is always 48 kHz
        // unless asked otherwise.
        const sampleRate =
            options.sampleRate ??
            (options.codec === 'opus' ? 48000 : options.normalize ? audio.sampleRate : undefined);

        const output = join(context.workdir, codec.file);
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
                ...(filters.length > 0 ? ['-af', filters.join(',')] : []),
                ...codec.args,
                '-b:a',
                `${bitrate}k`,
                '-ac',
                String(channels),
                ...(sampleRate === undefined ? [] : ['-ar', String(sampleRate)]),
                '-progress',
                'pipe:1',
                '-nostats',
                output,
            ],
            {
                onStdout: ffmpegProgress(audio.duration, (ratio) =>
                    context.progress(start + (1 - start) * ratio),
                ),
            },
        );

        context.output(codec.file, output, { mime: codec.mime, role: 'main' });
        return {
            metadata: {
                codec: options.codec,
                bitrate,
                channels,
                ...(audio.duration === undefined
                    ? {}
                    : { duration: Math.round(audio.duration * 1000) / 1000 }),
            },
        };
    },
});
