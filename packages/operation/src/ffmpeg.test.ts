import { describe, expect, it } from 'vitest';

import { ffmpegInput, ffmpegProgress } from './ffmpeg.ts';

describe('ffmpegInput', () => {
    it('opens local files with a list of demuxers, without playlists', () => {
        const args = ffmpegInput('/work/input');
        expect(args.slice(0, 2)).toEqual(['-protocol_whitelist', 'file']);
        expect(args[3]).toContain('mov');
        expect(args[3]?.split(',')).not.toContain('hls');
        expect(args[3]?.split(',')).not.toContain('concat');
        expect(args.slice(-2)).toEqual(['-i', '/work/input']);
    });
});

describe('ffmpegProgress', () => {
    it('reports the ratio of the duration done, across chunks', () => {
        const ratios: number[] = [];
        const onStdout = ffmpegProgress(10, (ratio) => ratios.push(ratio));
        onStdout('frame=10\nout_time_us=2500');
        onStdout('000\nprogress=continue\nout_time_us=5000000\n');
        onStdout('out_time_us=12000000\nprogress=end\n');
        expect(ratios).toEqual([0.25, 0.5, 1]);
    });

    it('reports nothing without a duration', () => {
        const ratios: number[] = [];
        ffmpegProgress(undefined, (ratio) => ratios.push(ratio))('out_time_us=1000000\n');
        expect(ratios).toEqual([]);
    });
});
