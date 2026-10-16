import { describe, expect, it } from 'vitest';

import { missingBinaries, skipWithoutBinaries } from '@eclair-js/operation/testing';

import { probeFile, runOn } from './test-helpers.ts';
import { transcode } from './transcode.ts';

describe.skipIf(skipWithoutBinaries(transcode.binaries))('audio.transcode', () => {
    it('has its binaries', () => {
        expect(missingBinaries(transcode.binaries)).toEqual([]);
    });

    it('writes an MP3 at 192 kbit/s by default, like the mediatheque', async () => {
        const result = await runOn(transcode, 'audio.m4a');
        try {
            expect(result.files).toEqual([
                {
                    name: 'audio.mp3',
                    path: expect.stringMatching(/audio\.mp3$/),
                    mime: 'audio/mpeg',
                    role: 'main',
                },
            ]);
            expect(result.metadata).toEqual({
                codec: 'mp3',
                bitrate: 192,
                channels: 1,
                duration: expect.closeTo(2, 1),
            });
            const { streams } = probeFile(result.files[0]?.path ?? '');
            expect(streams).toEqual([
                expect.objectContaining({ codec_name: 'mp3', channels: 1, bit_rate: '192000' }),
            ]);
        } finally {
            await result.cleanup();
        }
    });

    it('writes AAC in M4A, from the soundtrack of a video', async () => {
        const result = await runOn(transcode, 'video.mp4', { codec: 'aac', bitrate: 96 });
        try {
            expect(result.files[0]).toMatchObject({ name: 'audio.m4a', mime: 'audio/mp4' });
            const { streams, format } = probeFile(result.files[0]?.path ?? '');
            expect(format.format_name).toContain('mp4');
            expect(streams).toEqual([
                expect.objectContaining({ codec_type: 'audio', codec_name: 'aac', channels: 2 }),
            ]);
        } finally {
            await result.cleanup();
        }
    });

    it('writes Opus, in mono', async () => {
        const result = await runOn(transcode, 'audio.mp3', { codec: 'opus', channels: 1 });
        try {
            expect(result.files[0]).toMatchObject({ name: 'audio.opus', mime: 'audio/ogg' });
            expect(probeFile(result.files[0]?.path ?? '').streams).toEqual([
                expect.objectContaining({ codec_name: 'opus', channels: 1 }),
            ]);
        } finally {
            await result.cleanup();
        }
    });

    it('normalizes the loudness, at the sample rate of the input', async () => {
        const result = await runOn(transcode, 'audio.mp3', { normalize: true, loudness: -14 });
        try {
            const path = result.files[0]?.path ?? '';
            expect(probeFile(path).streams[0]).toMatchObject({ sample_rate: '44100' });
            expect(result.progress.at(-1)).toBeGreaterThan(0.5);
        } finally {
            await result.cleanup();
        }
    });

    it('fails on a video without audio', async () => {
        await expect(runOn(transcode, 'silent-portrait.mp4')).rejects.toMatchObject({
            code: 'unsupported_input',
        });
    });
});
