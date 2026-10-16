import type { PresetRequest } from '@eclair-js/protocol';

export interface BuiltInPreset extends PresetRequest {
    /** Increases when the preset changes in a release of Eclair. */
    version: number;
}

/**
 * The presets that ship with Eclair (docs/operations.md). Every project sees them, below the
 * global presets of the database: a global preset with the same name replaces one. They only use
 * built-in operations, and their tests check them against those operations.
 *
 * The `mediatheque/*` presets are the default pipelines of laravel-mediatheque 1.x: same task
 * names, which are the mediatheque's handles, and the same outputs, for its Eclair driver.
 */
export const BUILT_IN_PRESETS: Record<string, BuiltInPreset> = {
    'web-video': {
        version: 1,
        description:
            'Video for the web: an H.264 MP4 up to 1080p, HLS in 1080p, 720p and 360p, a poster and 5 thumbnails.',
        tasks: {
            probe: { op: 'probe' },
            h264: {
                op: 'video.transcode',
                options: { codec: 'h264', maxWidth: 1920, maxHeight: 1920 },
            },
            hls: { op: 'video.hls' },
            poster: { op: 'video.poster' },
            thumbnails: { op: 'video.thumbnails', options: { count: 5, inMiddle: true } },
        },
    },
    'web-audio': {
        version: 1,
        description: 'Audio for the web: an MP3 and the waveform, as an image and as data.',
        tasks: {
            probe: { op: 'probe' },
            mp3: { op: 'audio.transcode', options: { codec: 'mp3' } },
            waveform: { op: 'audio.waveform' },
        },
    },
    'web-image': {
        version: 1,
        description: 'Images for the web: the palette, and a WebP up to 2560 pixels.',
        tasks: {
            probe: { op: 'probe' },
            palette: { op: 'image.palette' },
            webp: {
                op: 'image.convert',
                options: { format: 'webp', maxWidth: 2560, maxHeight: 2560 },
            },
        },
    },
    'mediatheque/video': {
        version: 1,
        description:
            "laravel-mediatheque's video pipeline: H.264, WebM and HEVC at the size of the video, and 5 centered thumbnails.",
        tasks: {
            probe: { op: 'probe' },
            h264: { op: 'video.transcode', options: { codec: 'h264' } },
            webm: { op: 'video.transcode', options: { codec: 'vp9' } },
            hevc: { op: 'video.transcode', options: { codec: 'h265' } },
            thumbnails: { op: 'video.thumbnails', options: { count: 5, inMiddle: true } },
        },
    },
    'mediatheque/audio': {
        version: 1,
        description: "laravel-mediatheque's audio pipeline: the waveform image.",
        tasks: {
            probe: { op: 'probe' },
            thumbnails: { op: 'audio.waveform', options: { data: false } },
        },
    },
    'mediatheque/document': {
        version: 1,
        description: "laravel-mediatheque's document pipeline: every page, at 150 dpi in JPEG.",
        tasks: {
            probe: { op: 'probe' },
            thumbnails: { op: 'document.thumbnails' },
        },
    },
    'mediatheque/font': {
        version: 1,
        description: "laravel-mediatheque's font pipeline: WOFF2 and WOFF.",
        tasks: {
            probe: { op: 'probe' },
            webfonts: { op: 'font.convert' },
        },
    },
};
