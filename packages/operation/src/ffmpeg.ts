/**
 * The demuxers ffmpeg and ffprobe may use on an input: audio and video containers. Playlists and
 * other formats that open more files (`hls`, `concat`, `image2`…) are left out, so a crafted input
 * can't make ffmpeg read another file of the worker. The list also applies to the demuxers ffmpeg
 * opens inside a file.
 */
export const FFMPEG_DEMUXERS = [
    'aac',
    'aiff',
    'amr',
    'ape',
    'asf',
    'au',
    'avi',
    'caf',
    'dv',
    'flac',
    'flv',
    'gif',
    'h264',
    'hevc',
    'ivf',
    'm4v',
    'matroska',
    'mov',
    'mp3',
    'mpeg',
    'mpegts',
    'mpegvideo',
    'mxf',
    'obu',
    'ogg',
    'w64',
    'wav',
    'wv',
] as const;

/**
 * The arguments that open an input in ffmpeg or ffprobe: local files only, with the demuxers of
 * `FFMPEG_DEMUXERS`. Put them where `-i <path>` would go.
 */
export function ffmpegInput(path: string): string[] {
    return [
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        FFMPEG_DEMUXERS.join(','),
        '-i',
        path,
    ];
}

/**
 * Reads the progress ffmpeg writes with `-progress pipe:1`, for `exec()`'s `onStdout`. Calls
 * `report` with the ratio of `duration` (seconds) done so far.
 */
export function ffmpegProgress(
    duration: number | undefined,
    report: (ratio: number) => void,
): (chunk: string) => void {
    let pending = '';
    return (chunk) => {
        if (duration === undefined || duration <= 0) {
            return;
        }
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
            // `out_time_us` is in microseconds; older versions call it `out_time_ms`, also in µs.
            const match = /^out_time_[mu]s=(\d+)$/.exec(line.trim());
            if (match?.[1] !== undefined) {
                report(Math.min(1, Number(match[1]) / 1e6 / duration));
            }
        }
    };
}
