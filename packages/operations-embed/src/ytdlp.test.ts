import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OperationError } from '@eclair-js/operation';
import type { ExecOptions, ExecResult } from '@eclair-js/operation';
import { runEmbedOperation } from '@eclair-js/operation/testing';
import type {
    RunEmbedOperationOptions,
    RunEmbedOperationResult,
} from '@eclair-js/operation/testing';

import { embedDownload } from './download.ts';
import plugin from './index.ts';
import { embedProbe } from './probe.ts';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const tiktok = 'https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=fr';
const canonical = 'https://www.tiktok.com/@scout2015/video/6718335390845095173';

interface Call {
    binary: string;
    args: readonly string[];
}

/** A fake yt-dlp: writes `file` as download.<ext> and prints what the real one prints. */
function fakeYtdlp(calls: Call[], file: string | undefined, info: Record<string, unknown> = {}) {
    return async (
        binary: string,
        args: readonly string[],
        options: ExecOptions,
    ): Promise<ExecResult> => {
        calls.push({ binary, args });
        if (args.includes('--dump-single-json')) {
            return { stdout: JSON.stringify(info), stderr: '' };
        }
        if (file !== undefined) {
            const ext = file.split('.').pop() ?? 'bin';
            const path = join(options.cwd ?? '', `download.${ext}`);
            await copyFile(fixture(file), path);
            options.onStdout?.('eclair-progress 50 100\neclair-progress 100 100\n');
            options.onStdout?.(
                `${JSON.stringify({ filepath: path, id: '6718335390845095173', format_id: 'h264_720p', ext, duration: 15.2, width: 576, height: 1024 })}\n`,
            );
        }
        return { stdout: '', stderr: '' };
    };
}

/** yt-dlp failing with this line on stderr, as `execBinary` reports it. */
function failingYtdlp(line: string) {
    return () =>
        Promise.reject(
            new OperationError('operation_failed', 'yt-dlp exited with 1.', {
                cause: new Error(`ERROR: ${line}`),
            }),
        );
}

const runs: RunEmbedOperationResult[] = [];
afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.cleanup()));
});

async function download(rest: Partial<RunEmbedOperationOptions>) {
    const result = await runEmbedOperation(embedDownload, {
        url: tiktok,
        providers: plugin.embedProviders,
        available: { 'yt-dlp': true },
        limits: { maxDuration: 600, maxSize: 50_000_000 },
        ...rest,
    });
    runs.push(result);
    return result;
}

describe('embed.download with yt-dlp', () => {
    it('downloads from the canonical URL, with a locked-down yt-dlp', async () => {
        const calls: Call[] = [];
        const { metadata, files, progress } = await download({
            exec: fakeYtdlp(calls, 'video.mp4'),
        });
        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call?.binary).toBe('yt-dlp');
        expect(call?.args.at(-1)).toBe(canonical);
        expect(call?.args).toEqual(
            expect.arrayContaining([
                '--ignore-config',
                '--no-cache-dir',
                '--no-playlist',
                '--js-runtimes',
                'node',
                '!is_live & duration <=? 600',
                '50000000',
            ]),
        );
        const joined = call?.args.join(' ') ?? '';
        expect(joined).toContain('--use-extractors tiktok');
        expect(joined).not.toMatch(/cookies|--exec|--netrc|--username|--password|--update/);
        expect(files).toEqual([
            expect.objectContaining({ name: 'video.mp4', mime: 'video/mp4', role: 'main' }),
        ]);
        expect(progress).toContain(0.5);
        expect(metadata).toMatchObject({
            provider: 'tiktok',
            id: '6718335390845095173',
            backend: 'yt-dlp',
            format: 'h264_720p',
            mime: 'video/mp4',
            width: 576,
            height: 1024,
            duration: 15.2,
        });
    });

    it('asks for the formats of a height, or the audio', async () => {
        const calls: Call[] = [];
        await download({ exec: fakeYtdlp(calls, 'video.mp4'), options: { quality: 720 } });
        expect(calls[0]?.args).toContain('bv*[height<=720]+ba/b[height<=720]/wv*+ba/w');
        const sound = await download({
            url: 'https://soundcloud.com/forss/flickermood',
            exec: fakeYtdlp(calls, 'audio.mp3'),
            options: { audioOnly: true },
        });
        expect(calls[1]?.args).toContain('ba/b');
        expect(sound.files).toEqual([expect.objectContaining({ name: 'audio.mp3' })]);
    });

    it('tells a refusal of the server from an embed that is gone, or filtered out', async () => {
        await expect(
            download({ exec: failingYtdlp('[TikTok] 1: Sign in to confirm you’re not a bot') }),
        ).rejects.toMatchObject({ code: 'provider_refused' });
        await expect(
            download({ exec: failingYtdlp('[TikTok] 1: Video unavailable') }),
        ).rejects.toMatchObject({ code: 'provider_unavailable' });
        await expect(download({ exec: failingYtdlp('something broke') })).rejects.toMatchObject({
            code: 'provider_failed',
            message: 'yt-dlp: something broke',
        });
        // A filter (live, too long, too large) leaves no file.
        await expect(download({ exec: fakeYtdlp([], undefined) })).rejects.toMatchObject({
            code: 'limit_exceeded',
        });
        await expect(download({ exec: fakeYtdlp([], 'image.png') })).rejects.toMatchObject({
            code: 'input_unreadable',
        });
    });

    it('needs yt-dlp on the worker, and never reads Spotify or Vimeo with it', async () => {
        const calls: Call[] = [];
        await expect(
            download({ available: { 'yt-dlp': false }, exec: fakeYtdlp(calls, 'video.mp4') }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
        await expect(
            download({
                url: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
                exec: fakeYtdlp(calls, 'audio.mp3'),
            }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
        await expect(
            download({ url: 'https://vimeo.com/76979871', exec: fakeYtdlp(calls, 'video.mp4') }),
        ).rejects.toMatchObject({ code: 'provider_failed' });
        expect(calls).toEqual([]);
    });
});

describe('embed.probe with complete', () => {
    const oembed = {
        'https://www.tiktok.com/oembed': {
            body: {
                version: '1.0',
                type: 'video',
                html: '<iframe src="https://www.tiktok.com/player/v1/6718335390845095173"></iframe>',
            },
        },
    };
    const info = {
        duration: 15.2,
        width: 576,
        height: 1024,
        title: 'Scramble up ur name & I’ll try to guess it',
        uploader: 'Scout',
        uploader_id: 'scout2015',
        channel_id: 'MS4wLjABAAAA',
        uploader_url: 'https://www.tiktok.com/@scout2015',
        thumbnail: 'https://p16-sign.tiktokcdn-us.com/thumb.jpeg',
        timestamp: 1564012800,
        availability: 'public',
    };

    async function probe(rest: Partial<RunEmbedOperationOptions>) {
        const result = await runEmbedOperation(embedProbe, {
            url: tiktok,
            providers: plugin.embedProviders,
            responses: oembed,
            available: { 'yt-dlp': true },
            ...rest,
        });
        runs.push(result);
        return result;
    }

    it('fills what oEmbed gave not with yt-dlp, when asked', async () => {
        const calls: Call[] = [];
        const { metadata } = await probe({
            exec: fakeYtdlp(calls, undefined, info),
            options: { complete: true },
        });
        expect(calls[0]?.args).toEqual(
            expect.arrayContaining(['--dump-single-json', '--skip-download', canonical]),
        );
        expect(metadata).toMatchObject({
            kind: 'video',
            mime: 'text/html',
            duration: 15.2,
            width: 576,
            height: 1024,
            embed: {
                provider: 'tiktok',
                embedUrl: 'https://www.tiktok.com/player/v1/6718335390845095173',
                title: info.title,
                author: {
                    id: 'MS4wLjABAAAA',
                    name: 'Scout',
                    url: 'https://www.tiktok.com/@scout2015',
                },
                thumbnailUrl: info.thumbnail,
                publishedAt: '2019-07-25T00:00:00Z',
                privacy: 'public',
            },
        });
    });

    it('runs no yt-dlp unless asked, and keeps what the provider gave when yt-dlp fails', async () => {
        const calls: Call[] = [];
        expect(
            (await probe({ exec: fakeYtdlp(calls, undefined, info) })).metadata,
        ).not.toHaveProperty('duration');
        expect(calls).toEqual([]);
        const failed = await probe({
            exec: failingYtdlp('Video unavailable'),
            options: { complete: true },
        });
        expect(failed.metadata).toMatchObject({ kind: 'video', embed: { provider: 'tiktok' } });
        expect(failed.metadata).not.toHaveProperty('duration');
    });
});
