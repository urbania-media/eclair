import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { probeFile, runOn } from './test-helpers.ts';
import { transcode } from './transcode.ts';

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
