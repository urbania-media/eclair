import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { runEmbedOperation } from '@eclair-js/operation/testing';
import type {
    RunEmbedOperationOptions,
    RunEmbedOperationResult,
} from '@eclair-js/operation/testing';

import { embedDownload } from './download.ts';
import plugin from './index.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const json = (name: string): unknown =>
    JSON.parse(fixture(`${name}.json`).toString('utf8')) as unknown;

const url = 'https://vimeo.com/76979871';
const api = 'https://api.vimeo.com/videos/76979871';
const credentials = { token: 'a-token' };
const video = { body: new Uint8Array(fixture('video.mp4')) };

const runs: RunEmbedOperationResult[] = [];
afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.cleanup()));
});

async function download(rest: Partial<RunEmbedOperationOptions> = {}) {
    const result = await runEmbedOperation(embedDownload, {
        url,
        providers: plugin.embedProviders,
        credentials,
        responses: {
            [api]: { body: json('vimeo-api-download') },
            'https://player.vimeo.com/play/1111/source.mp4': video,
            'https://player.vimeo.com/play/3333/720p.mp4': video,
            'https://player.vimeo.com/play/4444/360p.mp4': video,
        },
        ...rest,
    });
    runs.push(result);
    return result;
}

describe('embed.download', () => {
    it('runs on the network queue, and downloads', () => {
        expect(embedDownload).toMatchObject({
            capability: 'network',
            downloads: true,
            accepts: { embeds: true },
            outputs: { files: true, metadata: true },
        });
    });

    it("downloads a Vimeo video's original with the owner's token", async () => {
        const { metadata, files, requests } = await download();
        expect(requests[0]).toMatchObject({ headers: { authorization: 'bearer a-token' } });
        expect(requests.map(({ url: request }) => request.split('?')[0])).toEqual([
            api,
            'https://player.vimeo.com/play/1111/source.mp4',
        ]);
        expect(files).toEqual([
            {
                name: 'video.mp4',
                path: expect.stringMatching(/download$/),
                mime: 'video/mp4',
                role: 'main',
            },
        ]);
        expect((await stat(files[0]?.path ?? '')).size).toBe(fixture('video.mp4').length);
        expect(metadata).toEqual({
            provider: 'vimeo',
            id: '76979871',
            quality: 'source',
            rendition: 'source',
            mime: 'video/mp4',
            size: fixture('video.mp4').length,
            width: 1920,
            height: 1080,
            duration: 62,
        });
    });

    it('takes the largest file within a height, or else the smallest', async () => {
        expect((await download({ options: { quality: 720 } })).metadata).toMatchObject({
            rendition: '720p',
            height: 720,
        });
        expect((await download({ options: { quality: 240 } })).metadata).toMatchObject({
            rendition: '360p',
        });
    });

    it('refuses what it may not or cannot download', async () => {
        await expect(download({ credentials: undefined })).rejects.toMatchObject({
            code: 'provider_failed',
        });
        await expect(download({ options: { audioOnly: true } })).rejects.toMatchObject({
            code: 'unsupported_input',
        });
        await expect(download({ limits: { maxDuration: 60 } })).rejects.toMatchObject({
            code: 'limit_exceeded',
        });
        // The original is 160 MB.
        await expect(download({ limits: { maxSize: 100_000_000 } })).rejects.toMatchObject({
            code: 'limit_exceeded',
        });
        await expect(
            download({ responses: { [api]: { body: { type: 'live', duration: 0 } } } }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
        await expect(
            download({ responses: { [api]: { body: { type: 'video', duration: 62 } } } }),
        ).rejects.toMatchObject({ code: 'provider_unavailable' });
        await expect(
            download({
                responses: {
                    [api]: { body: json('vimeo-api-download') },
                    'https://player.vimeo.com/play/1111/source.mp4': {
                        body: new Uint8Array(fixture('image.png')),
                    },
                },
            }),
        ).rejects.toMatchObject({ code: 'input_unreadable' });
    });

    it("can't download from the other providers yet", async () => {
        await expect(
            download({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', responses: {} }),
        ).rejects.toMatchObject({ code: 'unsupported_input' });
    });
});
