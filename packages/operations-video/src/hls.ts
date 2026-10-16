import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';

import { defineOperation, ffmpegInput, ffmpegProgress } from '@eclair-js/operation';

import { readVideo, sizeForShortSide } from './media.ts';

const Rendition = Type.Object(
    {
        size: Type.Integer({
            minimum: 144,
            maximum: 4320,
            description: 'Short side, in pixels: 1080 for 1080p, whatever the orientation.',
        }),
        bitrate: Type.Integer({
            minimum: 100,
            maximum: 100_000,
            description: 'Video bitrate, in kbit/s.',
        }),
        audioBitrate: Type.Optional(
            Type.Integer({ minimum: 32, maximum: 512, description: 'Audio bitrate, in kbit/s.' }),
        ),
    },
    { additionalProperties: false },
);

/** The renditions of laravel-mediatheque's HLS job. */
const DEFAULT_RENDITIONS = [
    { size: 360, bitrate: 800 },
    { size: 720, bitrate: 2000 },
    { size: 1080, bitrate: 4000 },
];

const HlsOptions = Type.Object(
    {
        renditions: Type.Array(Rendition, {
            minItems: 1,
            maxItems: 8,
            default: DEFAULT_RENDITIONS,
            description:
                'Renditions, by short side. Those larger than the video are left out; when all of them are, the smallest one is made at the size of the video.',
        }),
        segmentDuration: Type.Number({
            minimum: 1,
            maximum: 30,
            default: 5,
            description: 'Target duration of a segment, in seconds.',
        }),
        audioBitrate: Type.Integer({
            minimum: 32,
            maximum: 512,
            default: 128,
            description: 'Audio bitrate of the renditions that set none, in kbit/s.',
        }),
    },
    { additionalProperties: false },
);

interface PlannedRendition {
    name: string;
    width: number;
    height: number;
    bitrate: number;
    audioBitrate: number;
}

/** The renditions made for a video: never larger than it, at least one, no two of the same size. */
export function planRenditions(
    width: number,
    height: number,
    renditions: { size: number; bitrate: number; audioBitrate?: number | undefined }[],
    audioBitrate: number,
): PlannedRendition[] {
    const shortSide = Math.min(width, height);
    const sorted = [...renditions].sort((a, b) => a.size - b.size);
    let kept = sorted.filter((rendition) => rendition.size <= shortSide);
    if (kept.length === 0 && sorted[0] !== undefined) {
        kept = [{ ...sorted[0], size: shortSide }];
    }
    const planned = new Map<number, PlannedRendition>();
    for (const rendition of kept) {
        const size = sizeForShortSide(width, height, rendition.size);
        planned.set(rendition.size, {
            name: `${rendition.size}p`,
            ...size,
            bitrate: rendition.bitrate,
            audioBitrate: rendition.audioBitrate ?? audioBitrate,
        });
    }
    return [...planned.values()];
}

/**
 * HLS with several H.264 renditions, like laravel-mediatheque's HLS job: `master.m3u8`, a playlist
 * per rendition (`720p.m3u8`) and its MPEG-TS segments (`720p_000.ts`).
 */
export const hls = defineOperation({
    name: 'video.hls',
    version: 1,
    description:
        'HLS with several H.264 and AAC renditions: master.m3u8, a playlist per rendition and its segments.',
    accepts: { kinds: ['video'] },
    capability: 'video',
    binaries: ['ffprobe', 'ffmpeg'],
    options: HlsOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const video = await readVideo(context);
        const renditions = planRenditions(
            video.width,
            video.height,
            options.renditions,
            options.audioBitrate,
        );
        const split = renditions.map((_, index) => `[s${index}]`).join('');
        const filters = [
            `[0:v]split=${renditions.length}${split}`,
            ...renditions.map(
                (rendition, index) =>
                    `[s${index}]scale=${rendition.width}:${rendition.height},setsar=1[v${index}]`,
            ),
        ].join(';');
        const streams = renditions.flatMap((rendition, index) => [
            '-map',
            `[v${index}]`,
            `-b:v:${index}`,
            `${rendition.bitrate}k`,
            `-maxrate:v:${index}`,
            `${Math.round(rendition.bitrate * 1.07)}k`,
            `-bufsize:v:${index}`,
            `${Math.round(rendition.bitrate * 1.5)}k`,
            ...(video.hasAudio
                ? ['-map', '0:a:0', `-b:a:${index}`, `${rendition.audioBitrate}k`]
                : []),
        ]);
        const streamMap = renditions
            .map(
                (rendition, index) =>
                    `v:${index}${video.hasAudio ? `,a:${index}` : ''},name:${rendition.name}`,
            )
            .join(' ');
        const segment = options.segmentDuration;

        await context.exec(
            'ffmpeg',
            [
                '-hide_banner',
                '-nostdin',
                '-v',
                'error',
                '-y',
                ...ffmpegInput(context.input.path),
                '-filter_complex',
                filters,
                ...streams,
                '-sn',
                '-dn',
                '-map_metadata',
                '-1',
                '-c:v',
                'libx264',
                '-preset',
                'fast',
                '-profile:v',
                'main',
                '-pix_fmt',
                'yuv420p',
                // A key frame at the start of every segment, at the same time in every rendition.
                '-force_key_frames',
                `expr:gte(t,n_forced*${segment})`,
                '-sc_threshold',
                '0',
                ...(video.hasAudio ? ['-c:a', 'aac', '-ac', '2'] : []),
                '-f',
                'hls',
                '-hls_time',
                String(segment),
                '-hls_playlist_type',
                'vod',
                '-hls_flags',
                'independent_segments',
                '-hls_segment_type',
                'mpegts',
                '-hls_segment_filename',
                join(context.workdir, '%v_%03d.ts'),
                '-master_pl_name',
                'master.m3u8',
                '-var_stream_map',
                streamMap,
                '-progress',
                'pipe:1',
                '-nostats',
                join(context.workdir, '%v.m3u8'),
            ],
            { onStdout: ffmpegProgress(video.duration, (ratio) => context.progress(ratio)) },
        );

        const playlist = 'application/vnd.apple.mpegurl';
        context.output('master.m3u8', join(context.workdir, 'master.m3u8'), {
            mime: playlist,
            role: 'main',
        });
        const files = (await readdir(context.workdir)).sort();
        for (const rendition of renditions) {
            const name = `${rendition.name}.m3u8`;
            context.output(name, join(context.workdir, name), { mime: playlist, role: 'playlist' });
            for (const file of files) {
                if (file.startsWith(`${rendition.name}_`) && file.endsWith('.ts')) {
                    context.output(file, join(context.workdir, file), {
                        mime: 'video/mp2t',
                        role: 'segment',
                    });
                }
            }
        }
        return {
            metadata: {
                renditions: renditions.map(({ name, width, height, bitrate }) => ({
                    name,
                    width,
                    height,
                    bitrate,
                })),
            },
        };
    },
});
