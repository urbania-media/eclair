import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';

import { fitSize, readVideo } from './media.ts';
import type { VideoInfo } from './media.ts';

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
    /** Whether `maxBitrate` has a default from the output's size, and a keyframe every 4 seconds. */
    web: boolean;
}

/**
 * Encoders and their defaults. H.264 is set for progressive MP4 on the web (decision 0019):
 * `medium` preset, High profile at the level the size needs, CRF 23, a keyframe every 4 seconds
 * and a maximum bitrate from the output's size. H.265 follows laravel-mediatheque's `HEVC` job
 * (`fast` preset, main profile, CRF 30), VP9 its `WebM` job (CRF 26, constant quality).
 */
const CODECS: Record<Codec, CodecSettings> = {
    h264: {
        format: 'mp4',
        formats: ['mp4'],
        quality: 23,
        maxQuality: 51,
        args: ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high'],
        web: true,
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
        web: false,
    },
    vp9: {
        format: 'webm',
        formats: ['webm', 'mp4'],
        quality: 26,
        maxQuality: 63,
        args: ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1'],
        web: false,
    },
    av1: {
        format: 'webm',
        formats: ['webm', 'mp4'],
        quality: 35,
        maxQuality: 63,
        args: ['-c:v', 'libsvtav1', '-preset', '8'],
        web: false,
    },
};

/**
 * The maximum video bitrate of H.264 on the web, in kbit/s, by the number of pixels of a frame,
 * at up to 30 frames per second: Apple's HLS ladder (720p at 3000, 1080p at 6000), as a ceiling
 * that only content hard to compress reaches at CRF 23. Above 30 fps, half again (YouTube's ratio).
 */
const WEB_BITRATES: [pixels: number, kbps: number][] = [
    [640 * 360, 1000],
    [960 * 540, 2000],
    [1280 * 720, 3000],
    [1920 * 1080, 6000],
    [2560 * 1440, 10_000],
];

export function webBitrate(width: number, height: number, frameRate: number | undefined): number {
    const pixels = width * height;
    const kbps = WEB_BITRATES.find(([max]) => pixels <= max)?.[1] ?? 16_000;
    return (frameRate ?? 30) > 31 ? Math.round(kbps * 1.5) : kbps;
}

/**
 * H.264 that every browser plays: 8-bit 4:2:0, a profile without the features browsers lack, and
 * at most the level of 1080p at 60 fps.
 */
const WEB_H264_PROFILES = ['Constrained Baseline', 'Main', 'High'];
const WEB_H264_MAX_LEVEL = 42;

/** Why the video stream of the input can't be copied into the output, or undefined if it can. */
export function passthroughRefusal(
    video: VideoInfo,
    options: { maxWidth?: number | undefined; maxHeight?: number | undefined },
    maxBitrate: number,
): string | undefined {
    const { stream } = video;
    if (stream.codec !== 'h264') {
        return `the video is ${stream.codec ?? 'unknown'}, not h264`;
    }
    if (stream.pixelFormat !== 'yuv420p' && stream.pixelFormat !== 'yuvj420p') {
        return `its pixel format is ${stream.pixelFormat ?? 'unknown'}, not yuv420p`;
    }
    if (!WEB_H264_PROFILES.includes(stream.profile ?? '')) {
        return `its profile is ${stream.profile ?? 'unknown'}`;
    }
    if (stream.level === undefined || stream.level > WEB_H264_MAX_LEVEL) {
        return `its level is ${stream.level === undefined ? 'unknown' : String(stream.level / 10)}`;
    }
    if (stream.rotation !== 0 || !stream.plain) {
        return 'it is rotated, interlaced or has non-square pixels';
    }
    const size = fitSize(video.width, video.height, options.maxWidth, options.maxHeight);
    if (size.width !== video.width || size.height !== video.height) {
        return 'it is larger than the maximum size, or its sides are odd';
    }
    if (stream.bitRate === undefined || stream.bitRate > maxBitrate * 1000) {
        return `its bitrate is above ${String(maxBitrate)} kbit/s, or unknown`;
    }
    return undefined;
}

/** Whether the audio of the input can be copied into an MP4 encoded at `audioBitrate` kbit/s. */
export function copiesAudio(audio: VideoInfo['audio'], audioBitrate: number): boolean {
    return (
        audio?.codec === 'aac' &&
        (audio.channels ?? 3) <= 2 &&
        (audio.bitRate ?? Infinity) <= audioBitrate * 2000
    );
}

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
                description:
                    'Maximum video bitrate, in kbit/s. For H.264, by default, from the size of the output: 3000 for 720p, 6000 for 1080p, half again above 30 fps.',
            }),
        ),
        passthrough: Type.Boolean({
            default: false,
            description:
                'Copies the video stream instead of encoding it when it already fits: H.264 in MP4 only, 8-bit 4:2:0, Constrained Baseline, Main or High profile up to level 4.2, upright, progressive, with square pixels, within maxWidth and maxHeight and at most maxBitrate. The audio is copied too when it is AAC, mono or stereo, at most twice audioBitrate. The `video` and `audio` metadata say what was copied.',
        }),
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
        'MP4 (H.264, H.265) or WebM (VP9, AV1), with a maximum size, quality and bitrate. 8-bit 4:2:0, with the audio in AAC or Opus. An H.264 video that already fits can be copied instead of encoded.',
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
        const maxBitrate =
            options.maxBitrate ??
            (codec.web ? webBitrate(size.width, size.height, video.frameRate) : undefined);
        const copiesVideo =
            options.passthrough &&
            options.codec === 'h264' &&
            format === 'mp4' &&
            maxBitrate !== undefined &&
            passthroughRefusal(video, options, maxBitrate) === undefined;
        const keepsAudio = options.audio && video.hasAudio;
        const copiedAudio =
            copiesVideo && keepsAudio && copiesAudio(video.audio, options.audioBitrate);

        const encoder = [
            '-vf',
            `scale=${size.width}:${size.height},setsar=1`,
            '-pix_fmt',
            'yuv420p',
            ...codec.args,
            '-crf',
            String(quality),
            // A keyframe every 4 seconds at most, so that a seek reads and decodes little.
            ...(codec.web ? ['-g', String(Math.round(4 * (video.frameRate ?? 25)))] : []),
            ...(maxBitrate === undefined
                ? // libvpx needs a bitrate of 0 for constant quality.
                  options.codec === 'vp9'
                    ? ['-b:v', '0']
                    : []
                : options.codec === 'vp9'
                  ? ['-b:v', `${maxBitrate}k`]
                  : ['-maxrate', `${maxBitrate}k`, '-bufsize', `${maxBitrate * 2}k`]),
        ];
        const audio = keepsAudio
            ? [
                  '-map',
                  '0:a:0',
                  ...(copiedAudio
                      ? ['-c:a', 'copy']
                      : [
                            ...CONTAINERS[format].audio,
                            '-b:a',
                            `${options.audioBitrate}k`,
                            '-ac',
                            '2',
                        ]),
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
                ...(copiesVideo ? ['-c:v', 'copy', '-tag:v', 'avc1'] : encoder),
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
                video: copiesVideo ? 'copied' : 'encoded',
                ...(keepsAudio ? { audio: copiedAudio ? 'copied' : 'encoded' } : {}),
            },
        };
    },
});
