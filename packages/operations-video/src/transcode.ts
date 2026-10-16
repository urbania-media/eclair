import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';

import { fitSize, readVideo } from './media.ts';

type Codec = 'h264' | 'h265' | 'vp9' | 'av1';
type Container = 'mp4' | 'webm';

interface CodecSettings {
    /** The default container. */
    format: Container;
    formats: Container[];
    /** Quality (CRF) by default. */
    quality: number;
    maxQuality: number;
    args: string[];
}

/**
 * Encoders and their defaults. H.264 and H.265 follow laravel-mediatheque's `H264` and `HEVC` jobs
 * (`fast` preset, main profile, CRF 26 and 30), VP9 its `WebM` job (CRF 26, constant quality).
 */
const CODECS: Record<Codec, CodecSettings> = {
    h264: {
        format: 'mp4',
        formats: ['mp4'],
        quality: 26,
        maxQuality: 51,
        args: ['-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'main'],
    },
    h265: {
        format: 'mp4',
        formats: ['mp4'],
        quality: 30,
        maxQuality: 51,
        // `hvc1` is the tag Apple's players need.
        args: [
            '-c:v',
            'libx265',
            '-preset',
            'fast',
            '-profile:v',
            'main',
            '-tag:v',
            'hvc1',
            '-x265-params',
            'log-level=error',
        ],
    },
    vp9: {
        format: 'webm',
        formats: ['webm', 'mp4'],
        quality: 26,
        maxQuality: 63,
        args: ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1'],
    },
    av1: {
        format: 'webm',
        formats: ['webm', 'mp4'],
        quality: 35,
        maxQuality: 63,
        args: ['-c:v', 'libsvtav1', '-preset', '8'],
    },
};

const CONTAINERS: Record<Container, { mime: string; audio: string[] }> = {
    mp4: { mime: 'video/mp4', audio: ['-c:a', 'aac'] },
    webm: { mime: 'video/webm', audio: ['-c:a', 'libopus'] },
};

const TranscodeOptions = Type.Object(
    {
        codec: Type.Union(
            [Type.Literal('h264'), Type.Literal('h265'), Type.Literal('vp9'), Type.Literal('av1')],
            { default: 'h264', description: 'Video codec.' },
        ),
        format: Type.Optional(
            Type.Union([Type.Literal('mp4'), Type.Literal('webm')], {
                description:
                    'Container: MP4 by default for H.264 and H.265, WebM for VP9 and AV1. H.264 and H.265 are only written to MP4.',
            }),
        ),
        maxWidth: Type.Optional(
            Type.Integer({
                minimum: 2,
                maximum: 7680,
                description: 'Maximum width, in pixels. Videos are never enlarged.',
            }),
        ),
        maxHeight: Type.Optional(
            Type.Integer({
                minimum: 2,
                maximum: 7680,
                description: 'Maximum height, in pixels. Videos are never enlarged.',
            }),
        ),
        quality: Type.Optional(
            Type.Integer({
                minimum: 0,
                maximum: 63,
                description:
                    'Constant rate factor: lower is better. 26 by default for H.264 and VP9, 30 for H.265, 35 for AV1. Up to 51 for H.264 and H.265.',
            }),
        ),
        maxBitrate: Type.Optional(
            Type.Integer({
                minimum: 100,
                maximum: 200_000,
                description: 'Maximum video bitrate, in kbit/s.',
            }),
        ),
        audio: Type.Boolean({ default: true, description: 'Keeps the audio, when there is.' }),
        audioBitrate: Type.Integer({
            minimum: 32,
            maximum: 512,
            default: 128,
            description: 'Audio bitrate, in kbit/s: AAC in MP4, Opus in WebM.',
        }),
    },
    { additionalProperties: false },
);

/** Transcodes a video to MP4 or WebM, like laravel-mediatheque's `H264`, `HEVC` and `WebM` jobs. */
export const transcode = defineOperation({
    name: 'video.transcode',
    version: 1,
    description:
        'MP4 (H.264, H.265) or WebM (VP9, AV1), with a maximum size, quality and bitrate. 8-bit 4:2:0, with the audio in AAC or Opus.',
    accepts: { mimes: ['video/*', 'image/gif'] },
    capability: 'video',
    binaries: ['ffprobe', 'ffmpeg'],
    options: TranscodeOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const codec = CODECS[options.codec];
        const format = options.format ?? codec.format;
        if (!codec.formats.includes(format)) {
            throw new OperationError(
                'operation_failed',
                `${options.codec} can't be written to ${format}: use ${codec.formats.join(' or ')}.`,
            );
        }
        if (options.quality !== undefined && options.quality > codec.maxQuality) {
            throw new OperationError(
                'operation_failed',
                `The quality of ${options.codec} goes up to ${codec.maxQuality}.`,
            );
        }

        const video = await readVideo(context);
        const size = fitSize(video.width, video.height, options.maxWidth, options.maxHeight);
        const quality = options.quality ?? codec.quality;
        const rate =
            options.maxBitrate === undefined
                ? // libvpx needs a bitrate of 0 for constant quality.
                  options.codec === 'vp9'
                    ? ['-b:v', '0']
                    : []
                : options.codec === 'vp9'
                  ? ['-b:v', `${options.maxBitrate}k`]
                  : [
                        '-maxrate',
                        `${options.maxBitrate}k`,
                        '-bufsize',
                        `${options.maxBitrate * 2}k`,
                    ];
        const audio =
            options.audio && video.hasAudio
                ? [
                      '-map',
                      '0:a:0',
                      ...CONTAINERS[format].audio,
                      '-b:a',
                      `${options.audioBitrate}k`,
                      '-ac',
                      '2',
                  ]
                : [];
        const output = join(context.workdir, `video.${format}`);

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
                '0:v:0',
                ...audio,
                '-sn',
                '-dn',
                '-map_metadata',
                '-1',
                '-vf',
                `scale=${size.width}:${size.height},setsar=1`,
                '-pix_fmt',
                'yuv420p',
                ...codec.args,
                '-crf',
                String(quality),
                ...rate,
                ...(format === 'mp4' ? ['-movflags', '+faststart'] : []),
                '-progress',
                'pipe:1',
                '-nostats',
                output,
            ],
            { onStdout: ffmpegProgress(video.duration, (ratio) => context.progress(ratio)) },
        );

        context.output(`video.${format}`, output, { mime: CONTAINERS[format].mime, role: 'main' });
        return {
            metadata: {
                width: size.width,
                height: size.height,
                ...(video.duration === undefined
                    ? {}
                    : { duration: Math.round(video.duration * 1000) / 1000 }),
                codec: options.codec,
                format,
            },
        };
    },
});
