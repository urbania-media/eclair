import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import type { VideoInfo } from './media.ts';
import { fixture, probeFile, runOn } from './test-helpers.ts';
import { copiesAudio, passthroughRefusal, transcode, webBitrate } from './transcode.ts';

/** The settings x264 wrote in the stream: `keyint=100`, `crf=23.0`… */
function x264Settings(path: string): Record<string, string> {
    const match = /x264 - core .*? - options: (.*?)\0/.exec(readFileSync(path).toString('latin1'));
    return Object.fromEntries((match?.[1] ?? '').split(' ').map((pair) => pair.split('=')));
}

/** Whether an MP4 has its index (`moov`) before its data (`mdat`). */
function startsFast(path: string): boolean {
    const content = readFileSync(path).subarray(0, 4096).toString('latin1');
    const moov = content.indexOf('moov');
    return moov !== -1 && (content.indexOf('mdat') === -1 || moov < content.indexOf('mdat'));
}

const WEB_READY: VideoInfo = {
    width: 1920,
    height: 1080,
    duration: 60,
    frameRate: 24,
    hasAudio: true,
    stream: {
        codec: 'h264',
        profile: 'High',
        level: 40,
        pixelFormat: 'yuv420p',
        bitRate: 2_000_000,
        rotation: 0,
        plain: true,
    },
    audio: { codec: 'aac', channels: 2, bitRate: 128_000 },
};

function withStream(stream: Partial<VideoInfo['stream']>): VideoInfo {
    return { ...WEB_READY, stream: { ...WEB_READY.stream, ...stream } };
}

describe('webBitrate', () => {
    it('follows the size of the output, and the frame rate', () => {
        expect(webBitrate(1280, 720, 30)).toBe(3000);
        expect(webBitrate(720, 1280, 25)).toBe(3000);
        expect(webBitrate(1920, 1080, 24)).toBe(6000);
        expect(webBitrate(1920, 1080, 60)).toBe(9000);
        expect(webBitrate(1920, 800, undefined)).toBe(6000);
        expect(webBitrate(3840, 2160, 30)).toBe(16_000);
    });
});

describe('passthroughRefusal', () => {
    it('accepts web-ready H.264', () => {
        expect(passthroughRefusal(WEB_READY, { maxWidth: 1920, maxHeight: 1920 }, 6000)).toBe(
            undefined,
        );
        expect(passthroughRefusal(WEB_READY, {}, 2000)).toBe(undefined);
    });

    it.each([
        ['another codec', withStream({ codec: 'hevc' }), /hevc/],
        ['10 bits', withStream({ pixelFormat: 'yuv420p10le', profile: 'High 10' }), /yuv420p10le/],
        ['4:2:2', withStream({ pixelFormat: 'yuv422p' }), /yuv422p/],
        ['a profile browsers lack', withStream({ profile: 'Baseline' }), /profile/],
        ['a level above 4.2', withStream({ level: 51 }), /level is 5\.1/],
        ['a rotation', withStream({ rotation: 90 }), /rotated/],
        ['non-square pixels', withStream({ plain: false }), /rotated/],
        ['an unknown bitrate', withStream({ bitRate: undefined }), /bitrate/],
    ])('refuses %s', (_, video, reason) => {
        expect(passthroughRefusal(video, {}, 6000)).toMatch(reason);
    });

    it('refuses a video larger than the maximum size, or above the maximum bitrate', () => {
        expect(passthroughRefusal(WEB_READY, { maxWidth: 1280, maxHeight: 1280 }, 6000)).toMatch(
            /larger/,
        );
        expect(passthroughRefusal(WEB_READY, {}, 1500)).toMatch(/above 1500 kbit\/s/);
    });
});

describe('copiesAudio', () => {
    it('copies AAC in mono or stereo, up to twice the audio bitrate', () => {
        expect(copiesAudio({ codec: 'aac', channels: 2, bitRate: 128_000 }, 128)).toBe(true);
        expect(copiesAudio({ codec: 'aac', channels: 1, bitRate: 256_000 }, 128)).toBe(true);
        expect(copiesAudio({ codec: 'aac', channels: 2, bitRate: 320_000 }, 128)).toBe(false);
        expect(copiesAudio({ codec: 'aac', channels: 6, bitRate: 128_000 }, 128)).toBe(false);
        expect(copiesAudio({ codec: 'mp3', channels: 2, bitRate: 128_000 }, 128)).toBe(false);
        expect(copiesAudio(undefined, 128)).toBe(false);
    });
});

describe.skipIf(skipWithoutBinaries(transcode.binaries))('video.transcode', () => {
    it('has its binaries', () => {
        expect(missingBinaries(transcode.binaries)).toEqual([]);
    });

    it('writes an H.264 MP4 with AAC audio by default', async () => {
        const result = await runOn(transcode, 'video.mp4');
        try {
            expect(result.files).toEqual([
                {
                    name: 'video.mp4',
                    path: expect.stringMatching(/video\.mp4$/),
                    mime: 'video/mp4',
                    role: 'main',
                },
            ]);
            expect(result.metadata).toEqual({
                width: 320,
                height: 180,
                duration: expect.closeTo(4, 1),
                codec: 'h264',
                format: 'mp4',
                video: 'encoded',
                audio: 'encoded',
            });
            const { streams, format } = probeFile(result.files[0]?.path ?? '');
            expect(format.format_name).toContain('mp4');
            expect(streams).toEqual([
                expect.objectContaining({
                    codec_type: 'video',
                    codec_name: 'h264',
                    width: 320,
                    height: 180,
                }),
                expect.objectContaining({ codec_type: 'audio', codec_name: 'aac' }),
            ]);
            expect(result.progress.length).toBeGreaterThan(0);
            expect(startsFast(result.files[0]?.path ?? '')).toBe(true);
        } finally {
            await result.cleanup();
        }
    });

    it('writes the High profile at CRF 23, with a keyframe every 4 seconds and a maximum bitrate', async () => {
        const result = await runOn(transcode, 'video.mp4');
        try {
            const path = result.files[0]?.path ?? '';
            expect(probeFile(path).streams[0]).toMatchObject({ profile: 'High' });
            // The fixture has 25 frames per second; 320 × 180 is capped at 1000 kbit/s.
            expect(x264Settings(path)).toMatchObject({
                crf: '23.0',
                keyint: '100',
                vbv_maxrate: '1000',
                vbv_bufsize: '2000',
                ref: '3',
                subme: '7',
            });
        } finally {
            await result.cleanup();
        }
    });

    it('copies a video that already fits, with its AAC audio', async () => {
        const result = await runOn(transcode, 'video.mp4', {
            passthrough: true,
            maxWidth: 1920,
            maxHeight: 1920,
        });
        try {
            expect(result.metadata).toMatchObject({
                width: 320,
                height: 180,
                video: 'copied',
                audio: 'copied',
            });
            const path = result.files[0]?.path ?? '';
            const source = probeFile(fixture('video.mp4'));
            expect(probeFile(path).streams).toEqual([
                expect.objectContaining({
                    codec_name: 'h264',
                    bit_rate: source.streams[0]?.bit_rate,
                }),
                expect.objectContaining({
                    codec_name: 'aac',
                    bit_rate: source.streams[1]?.bit_rate,
                }),
            ]);
            expect(startsFast(path)).toBe(true);
        } finally {
            await result.cleanup();
        }
    });

    it('copies the video and encodes audio that is not AAC', async () => {
        const result = await runOn(transcode, 'mp3-audio.mkv', { passthrough: true });
        try {
            expect(result.metadata).toMatchObject({ video: 'copied', audio: 'encoded' });
            expect(probeFile(result.files[0]?.path ?? '').streams.map((s) => s.codec_name)).toEqual(
                ['h264', 'aac'],
            );
        } finally {
            await result.cleanup();
        }
    });

    it.each([
        ['larger than the maximum size', 'video.mp4', { maxWidth: 160 }],
        ['above the maximum bitrate', 'noisy.mp4', { maxBitrate: 100 }],
        ['rotated', 'rotated.mp4', {}],
    ])('encodes a video %s, even with passthrough', async (_, name, options) => {
        const result = await runOn(transcode, name, { passthrough: true, ...options });
        try {
            expect(result.metadata).toMatchObject({ video: 'encoded' });
        } finally {
            await result.cleanup();
        }
    });

    it('scales down to the maximum size, never up', async () => {
        const result = await runOn(transcode, 'video.mp4', { maxWidth: 160, maxHeight: 1080 });
        try {
            expect(result.metadata).toMatchObject({ width: 160, height: 90 });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                width: 160,
                height: 90,
            });
        } finally {
            await result.cleanup();
        }
    });

    it('applies the rotation', async () => {
        const result = await runOn(transcode, 'rotated.mp4');
        try {
            expect(result.metadata).toMatchObject({ width: 180, height: 320 });
            expect(probeFile(result.files[0]?.path ?? '').streams[0]).toMatchObject({
                width: 180,
                height: 320,
            });
        } finally {
            await result.cleanup();
        }
    });

    it('writes H.265 for Apple players', async () => {
        const result = await runOn(transcode, 'silent-portrait.mp4', { codec: 'h265' });
        try {
            const { streams } = probeFile(result.files[0]?.path ?? '');
            expect(streams).toEqual([
                expect.objectContaining({
                    codec_name: 'hevc',
                    codec_tag_string: 'hvc1',
                    width: 180,
                    height: 320,
                }),
            ]);
        } finally {
            await result.cleanup();
        }
    });

    it('writes a VP9 WebM with Opus audio', async () => {
        const result = await runOn(transcode, 'video.mp4', { codec: 'vp9', maxBitrate: 500 });
        try {
            expect(result.files[0]).toMatchObject({ name: 'video.webm', mime: 'video/webm' });
            const { streams, format } = probeFile(result.files[0]?.path ?? '');
            expect(format.format_name).toContain('webm');
            expect(streams.map((stream) => stream.codec_name)).toEqual(['vp9', 'opus']);
        } finally {
            await result.cleanup();
        }
    });

    it('writes AV1, and leaves the audio out when asked', async () => {
        const result = await runOn(transcode, 'video.mp4', {
            codec: 'av1',
            format: 'mp4',
            audio: false,
        });
        try {
            expect(result.files[0]).toMatchObject({ name: 'video.mp4' });
            expect(probeFile(result.files[0]?.path ?? '').streams.map((s) => s.codec_name)).toEqual(
                ['av1'],
            );
        } finally {
            await result.cleanup();
        }
    });

    it('refuses H.264 in WebM', async () => {
        await expect(
            runOn(transcode, 'video.mp4', { codec: 'h264', format: 'webm' }),
        ).rejects.toMatchObject({ code: 'operation_failed' });
    });

    it('fails on a file without video', async () => {
        await expect(runOn(transcode, 'audio-only.mp4')).rejects.toMatchObject({
            code: 'unsupported_input',
        });
    });
});
