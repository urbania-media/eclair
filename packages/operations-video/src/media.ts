import { stat } from 'node:fs/promises';
import { Type } from 'typebox';

import { OperationError, ffmpegInput } from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

/** What the video operations need to know about their input. */
export interface VideoInfo {
    /** Size as displayed, once the rotation is applied, as ffmpeg's filters see it. */
    width: number;
    height: number;
    /** Seconds, when the container says. */
    duration: number | undefined;
    frameRate: number | undefined;
    hasAudio: boolean;
    /** What a stream copy needs to know: see `transcode`'s `passthrough`. */
    stream: {
        codec: string | undefined;
        profile: string | undefined;
        /** `40` for 4.0, as ffprobe reports H.264 levels. */
        level: number | undefined;
        pixelFormat: string | undefined;
        /** Average, in bit/s: the stream's, or the whole file's when the container doesn't say. */
        bitRate: number | undefined;
        /** Degrees, 0 when the frame is upright. */
        rotation: number;
        /** Whether pixels are square (or the ratio unknown) and frames progressive (or unknown). */
        plain: boolean;
    };
    /** The first audio stream. */
    audio:
        | { codec: string | undefined; channels: number | undefined; bitRate: number | undefined }
        | undefined;
}

interface FfprobeStream {
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    level?: number;
    pix_fmt?: string;
    bit_rate?: string;
    channels?: number;
    sample_aspect_ratio?: string;
    field_order?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string };
}

function toNumber(value: unknown): number | undefined {
    const number = Number(value);
    return value === undefined || value === null || value === '' || !Number.isFinite(number)
        ? undefined
        : number;
}

function parseRate(value: string | undefined): number | undefined {
    const [numerator, denominator] = (value ?? '').split('/').map(Number);
    return numerator === undefined || denominator === undefined || !numerator || !denominator
        ? undefined
        : numerator / denominator;
}

/** Reads the video stream of the input with ffprobe. Fails when there is none. */
export async function readVideo(context: OperationContext): Promise<VideoInfo> {
    let output: { streams?: FfprobeStream[]; format?: { duration?: string; bit_rate?: string } };
    try {
        const { stdout } = await context.exec('ffprobe', [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            ...ffmpegInput(context.input.path),
        ]);
        output = JSON.parse(stdout) as typeof output;
    } catch (error) {
        throw new OperationError('input_unreadable', "The file can't be read as a video.", {
            cause: error,
        });
    }
    const streams = output.streams ?? [];
    const video = streams.find(
        (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
    );
    if (video?.width === undefined || video.height === undefined) {
        throw new OperationError('unsupported_input', 'The file has no video stream.');
    }
    const rotation =
        video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ??
        toNumber(video.tags?.rotate) ??
        0;
    const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const sampleAspectRatio = video.sample_aspect_ratio ?? '1:1';
    return {
        width: quarterTurn ? video.height : video.width,
        height: quarterTurn ? video.width : video.height,
        duration: toNumber(output.format?.duration) ?? toNumber(video.duration),
        frameRate: parseRate(video.avg_frame_rate),
        hasAudio: audio !== undefined,
        stream: {
            codec: video.codec_name,
            profile: video.profile,
            level: video.level,
            pixelFormat: video.pix_fmt,
            bitRate: toNumber(video.bit_rate) ?? toNumber(output.format?.bit_rate),
            rotation: Math.round(rotation) % 360,
            plain:
                ['1:1', '0:1', 'N/A'].includes(sampleAspectRatio) &&
                ['progressive', 'unknown', undefined].includes(video.field_order),
        },
        audio:
            audio === undefined
                ? undefined
                : {
                      codec: audio.codec_name,
                      channels: audio.channels,
                      bitRate: toNumber(audio.bit_rate),
                  },
    };
}

/** The largest even number at most `value`, and at least 2. */
function even(value: number): number {
    return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * The size that fits a video in a box, keeping its aspect ratio, never larger than the video.
 * Both sides are even, as H.264 and H.265 in 4:2:0 require.
 */
export function fitSize(
    width: number,
    height: number,
    maxWidth: number | undefined,
    maxHeight: number | undefined,
): { width: number; height: number } {
    const scale = Math.min(
        1,
        maxWidth === undefined ? 1 : maxWidth / width,
        maxHeight === undefined ? 1 : maxHeight / height,
    );
    return { width: even(width * scale), height: even(height * scale) };
}

/**
 * The size of a rendition whose short side is `size` (1080 for 1080p), keeping the aspect ratio,
 * like the renditions of laravel-mediatheque's HLS job.
 */
export function sizeForShortSide(
    width: number,
    height: number,
    size: number,
): { width: number; height: number } {
    return width >= height
        ? { width: even((size * width) / height), height: even(size) }
        : { width: even(size), height: even((size * height) / width) };
}

/** The image formats of frames. */
export const FrameFormat = Type.Union(
    [Type.Literal('jpeg'), Type.Literal('png'), Type.Literal('webp')],
    { default: 'jpeg', description: 'Image format of the frames.' },
);

export type FrameFormatName = 'jpeg' | 'png' | 'webp';

export const FRAME_FORMATS: Record<FrameFormatName, { extension: string; mime: string }> = {
    jpeg: { extension: 'jpg', mime: 'image/jpeg' },
    png: { extension: 'png', mime: 'image/png' },
    webp: { extension: 'webp', mime: 'image/webp' },
};

/** Options shared by the operations that write frames. */
export const frameOptions = {
    maxWidth: Type.Optional(
        Type.Integer({ minimum: 2, maximum: 7680, description: 'Maximum width, in pixels.' }),
    ),
    maxHeight: Type.Optional(
        Type.Integer({ minimum: 2, maximum: 7680, description: 'Maximum height, in pixels.' }),
    ),
    format: FrameFormat,
    quality: Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 85,
        description: 'Quality of JPEG and WebP frames, from 1 to 100.',
    }),
};

/** The encoder arguments of a frame in a format, at a quality from 1 to 100. */
export function frameEncoderArgs(format: FrameFormatName, quality: number): string[] {
    switch (format) {
        case 'jpeg':
            // mjpeg's scale goes from 2 (best) to 31.
            return ['-c:v', 'mjpeg', '-q:v', String(Math.round(2 + ((100 - quality) * 29) / 99))];
        case 'png':
            return ['-c:v', 'png'];
        case 'webp':
            return ['-c:v', 'libwebp', '-quality', String(quality)];
    }
}

/**
 * Extracts one frame at `time` seconds, scaled to fit `maxWidth` and `maxHeight`, into `path`.
 * `filters` come before the scaling.
 */
export async function extractFrame(
    context: OperationContext,
    video: VideoInfo,
    time: number,
    path: string,
    options: {
        maxWidth?: number | undefined;
        maxHeight?: number | undefined;
        format: FrameFormatName;
        quality: number;
        filters?: string[];
    },
): Promise<{ width: number; height: number }> {
    const size = fitSize(video.width, video.height, options.maxWidth, options.maxHeight);
    const filters = [...(options.filters ?? [])];
    if (size.width !== video.width || size.height !== video.height) {
        filters.push(`scale=${size.width}:${size.height}`);
    }
    await context.exec('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-ss',
        time.toFixed(3),
        ...ffmpegInput(context.input.path),
        '-an',
        '-sn',
        '-dn',
        ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
        '-frames:v',
        '1',
        '-update',
        '1',
        ...frameEncoderArgs(options.format, options.quality),
        path,
    ]);
    // ffmpeg succeeds without writing anything when there is no frame after `time`.
    const written = await stat(path).catch(() => undefined);
    if (written === undefined || written.size === 0) {
        throw new OperationError('operation_failed', `There is no frame at ${time.toFixed(3)} s.`);
    }
    return size;
}

/**
 * The latest time a frame can be read at: seeking to the very end of a file gives no frame, so it
 * stays one frame before.
 */
export function lastFrameTime(video: VideoInfo): number {
    const frame = 1 / (video.frameRate ?? 25);
    return Math.max(0, (video.duration ?? 0) - frame);
}
