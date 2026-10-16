import { join } from 'node:path';
import { Type } from 'typebox';

import { defineOperation } from '@eclair-js/operation';

import { FRAME_FORMATS, extractFrame, frameOptions, lastFrameTime, readVideo } from './media.ts';

/** How many seconds of the video are compared to pick the poster, at two frames a second. */
const WINDOW = 5;

const PosterOptions = Type.Object(
    {
        time: Type.Optional(
            Type.Number({
                minimum: 0,
                description:
                    'The frame at this time, in seconds. By default, the most representative frame of a few seconds near the start, which avoids black and blurry frames.',
            }),
        ),
        ...frameOptions,
    },
    { additionalProperties: false },
);

/**
 * Where the poster is looked for: 10% into the video, to skip fades and intros, while leaving a
 * whole window before the end.
 */
export function posterStart(duration: number): number {
    return Math.max(0, Math.min(duration * 0.1, duration - WINDOW));
}

/** One representative frame of a video, `poster.jpg`. */
export const poster = defineOperation({
    name: 'video.poster',
    version: 1,
    description: 'One representative frame, or the frame at a given time, as JPEG, PNG or WebP.',
    accepts: { kinds: ['video'] },
    capability: 'video',
    binaries: ['ffprobe', 'ffmpeg'],
    options: PosterOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const video = await readVideo(context);
        const time =
            options.time === undefined
                ? posterStart(video.duration ?? 0)
                : Math.min(options.time, lastFrameTime(video));
        const { extension, mime } = FRAME_FORMATS[options.format];
        const name = `poster.${extension}`;
        const path = join(context.workdir, name);
        const size = await extractFrame(context, video, time, path, {
            ...options,
            // The thumbnail filter picks the frame closest to the average of a batch.
            ...(options.time === undefined
                ? { filters: ['fps=2', `thumbnail=${WINDOW * 2}`] }
                : {}),
        });
        context.output(name, path, { mime, role: 'poster' });
        return { metadata: { width: size.width, height: size.height } };
    },
});
