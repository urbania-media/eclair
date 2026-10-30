import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';

import {
    defineOperation,
    ffmpegInput,
    ffmpegProgress,
    thumbhash,
    thumbhashOption,
} from '@eclair-js/operation';
import type { OperationContext } from '@eclair-js/operation';

import { FRAME_FORMATS, extractFrame, frameOptions, lastFrameTime, readVideo } from './media.ts';
import type { VideoInfo } from './media.ts';

/** The most frames one task writes. */
const MAX_FRAMES = 100;

/** The scene score above which a frame starts a new scene, from 0 to 1. */
const SCENE_THRESHOLD = 0.3;

const ThumbnailsOptions = Type.Object(
    {
        count: Type.Integer({
            minimum: 1,
            maximum: MAX_FRAMES,
            default: 5,
            description:
                'Number of frames, at even intervals. With `scenes`, the most frames to pick.',
        }),
        inMiddle: Type.Boolean({
            default: false,
            description:
                'Centers the frames: the duration is divided in `count + 1` parts, so there is no frame at the very start or end. Otherwise the first frame is at 0.',
        }),
        times: Type.Optional(
            Type.Array(Type.Number({ minimum: 0 }), {
                minItems: 1,
                maxItems: MAX_FRAMES,
                description: 'Frames at these times, in seconds, instead of `count`.',
            }),
        ),
        interval: Type.Optional(
            Type.Number({
                minimum: 0.1,
                description: `A frame every this many seconds from the start, instead of \`count\`, up to ${MAX_FRAMES} frames.`,
            }),
        ),
        scenes: Type.Boolean({
            default: false,
            description:
                'Frames at the `count` clearest scene changes, instead of even intervals. Reads the whole video.',
        }),
        ...frameOptions,
        ...thumbhashOption,
    },
    { additionalProperties: false },
);

/** Even intervals, as laravel-mediatheque's video `Thumbnails` job computes them. */
export function evenTimes(duration: number, count: number, inMiddle: boolean): number[] {
    const step = inMiddle ? duration / (count + 1) : duration / count;
    return Array.from({ length: count }, (_, index) => (inMiddle ? index + 1 : index) * step);
}

/** Times of the clearest scene changes, by ffmpeg's scene score. */
async function sceneTimes(
    context: OperationContext,
    video: VideoInfo,
    count: number,
): Promise<number[]> {
    const file = 'scenes.txt';
    await context.exec(
        'ffmpeg',
        [
            '-hide_banner',
            '-nostdin',
            '-v',
            'error',
            ...ffmpegInput(context.input.path),
            '-an',
            '-sn',
            '-dn',
            '-vf',
            `scale=256:-2,select='gt(scene\\,${SCENE_THRESHOLD})',metadata=print:file=${file}`,
            '-f',
            'null',
            '-progress',
            'pipe:1',
            '-nostats',
            '-',
        ],
        { onStdout: ffmpegProgress(video.duration, (ratio) => context.progress(ratio / 2)) },
    );
    const text = await readFile(join(context.workdir, file), 'utf8').catch(() => '');
    const scenes: { time: number; score: number }[] = [];
    let time: number | undefined;
    for (const line of text.split('\n')) {
        const frame = /pts_time:([0-9.]+)/.exec(line);
        if (frame?.[1] !== undefined) {
            time = Number(frame[1]);
        }
        const score = /lavfi\.scene_score=([0-9.]+)/.exec(line);
        if (score?.[1] !== undefined && time !== undefined) {
            scenes.push({ time, score: Number(score[1]) });
            time = undefined;
        }
    }
    return scenes
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map((scene) => scene.time)
        .sort((a, b) => a - b);
}

/**
 * Frames of a video: at even intervals (laravel-mediatheque's `Thumbnails` job, with `count` and
 * `inMiddle`), at given times, every few seconds, or at scene changes. Files are `0.jpg`, `1.jpg`…
 */
export const thumbnails = defineOperation({
    name: 'video.thumbnails',
    version: 1,
    description:
        'Frames at even intervals, at given times, every few seconds, or at scene changes, as JPEG, PNG or WebP.',
    accepts: { kinds: ['video'] },
    capability: 'video',
    binaries: ['ffprobe', 'ffmpeg', 'vips'],
    options: ThumbnailsOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const video = await readVideo(context);
        const duration = video.duration ?? 0;
        const last = lastFrameTime(video);

        let times: number[];
        if (options.times !== undefined) {
            times = options.times;
        } else if (options.interval !== undefined) {
            const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration / options.interval)));
            times = Array.from({ length: count }, (_, index) => index * (options.interval ?? 0));
        } else if (options.scenes) {
            times = await sceneTimes(context, video, options.count);
            // A video without scene changes still gets its frames.
            if (times.length === 0) {
                times = evenTimes(duration, options.count, options.inMiddle);
            }
        } else {
            times = evenTimes(duration, options.count, options.inMiddle);
        }
        times = times.map((time) => Math.min(time, last));

        const { extension, mime } = FRAME_FORMATS[options.format];
        const start = options.scenes ? 0.5 : 0;
        let size = { width: video.width, height: video.height };
        for (const [index, time] of times.entries()) {
            const name = `${index}.${extension}`;
            const path = join(context.workdir, name);
            size = await extractFrame(context, video, time, path, options);
            context.output(name, path, {
                mime,
                role: 'thumbnail',
                thumbhash: options.thumbhash ? await thumbhash(context, path) : undefined,
            });
            context.progress(start + ((1 - start) * (index + 1)) / times.length);
        }
        return {
            metadata: {
                width: size.width,
                height: size.height,
                times: times.map((time) => Math.round(time * 1000) / 1000),
            },
        };
    },
});
