import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { memoryCache, runEmbedOperation } from '@eclair-js/operation/testing';
import type {
    RunEmbedOperationOptions,
    RunEmbedOperationResult,
} from '@eclair-js/operation/testing';

import plugin from './index.ts';
import { embedThumbnail } from './thumbnail.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const json = (name: string): unknown =>
    JSON.parse(fixture(`${name}.json`).toString('utf8')) as unknown;

const url = 'https://youtu.be/aqz-KE-bpKQ';
const oembed = 'https://www.youtube.com/oembed';
const thumbnail = 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg';
const image = new Uint8Array(fixture('image.png'));

const runs: RunEmbedOperationResult[] = [];
afterEach(async () => {
    await Promise.all(runs.splice(0).map((run) => run.cleanup()));
});

async function run(rest: Partial<RunEmbedOperationOptions> = {}) {
    const result = await runEmbedOperation(embedThumbnail, {
        url,
        providers: plugin.embedProviders,
        responses: {
            [oembed]: { body: json('youtube-oembed') },
            // A type it announces, never trusted.
            [thumbnail]: { body: image, headers: { 'content-type': 'image/jpeg' } },
        },
        ...rest,
    });
    runs.push(result);
    return result;
}

describe('embed.thumbnail', () => {
    it('runs on the network queue, without downloading the embed', () => {
        expect(embedThumbnail).toMatchObject({
            capability: 'network',
            accepts: { embeds: true },
            outputs: { files: true, metadata: false },
        });
        expect(embedThumbnail).not.toHaveProperty('downloads', true);
        expect(plugin.operations).toContain(embedThumbnail);
    });

    it("downloads the provider's thumbnail, typed by its content", async () => {
        const { files, requests, metadata } = await run();

        expect(requests.map(({ url: request }) => request.split('?')[0])).toEqual([
            oembed,
            thumbnail,
        ]);
        expect(files).toEqual([
            {
                name: 'thumbnail.png',
                path: expect.stringMatching(/thumbnail\.png$/) as string,
                mime: 'image/png',
                role: 'main',
            },
        ]);
        expect(await readFile(files[0]?.path ?? '')).toEqual(Buffer.from(image));
        expect(metadata).toBeUndefined();
    });

    it("reads the provider's answer from embed.probe's cache, unless refreshed", async () => {
        const cache = memoryCache();
        await run({ cache });

        const cached = await run({ cache });
        expect(cached.requests.map(({ url: request }) => request)).toEqual([thumbnail]);

        const refreshed = await run({ cache, options: { refresh: true } });
        expect(refreshed.requests.map(({ url: request }) => request.split('?')[0])).toEqual([
            oembed,
            thumbnail,
        ]);
    });

    it('fails when the provider gives no thumbnail', async () => {
        const body = { ...(json('youtube-oembed') as Record<string, unknown>) };
        delete body['thumbnail_url'];

        await expect(run({ responses: { [oembed]: { body } } })).rejects.toMatchObject({
            code: 'provider_unavailable',
        });
    });

    it('refuses a thumbnail that is not an image', async () => {
        await expect(
            run({
                responses: {
                    [oembed]: { body: json('youtube-oembed') },
                    [thumbnail]: { body: '<html>Not found</html>' },
                },
            }),
        ).rejects.toMatchObject({ code: 'provider_failed' });
    });

    it('keeps within its size limit', async () => {
        await expect(run({ limits: { maxSize: 10 } })).rejects.toMatchObject({
            code: 'limit_exceeded',
        });
    });
});
