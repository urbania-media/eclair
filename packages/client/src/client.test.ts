import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validate } from '@eclair-js/protocol';
import { RUNS_WITH_REDIS, startTestServer } from '@eclair-js/server/testing';

import { EclairClient } from './client.ts';
import { EclairError } from './errors.ts';

let server: Awaited<ReturnType<typeof startTestServer>>;
let client: EclairClient;

describe.skipIf(!RUNS_WITH_REDIS)('EclairClient against a server', () => {
    beforeAll(async () => {
        server = await startTestServer();
        client = new EclairClient({ url: server.url, key: server.token });
    });

    afterAll(async () => {
        await server?.close();
    });

    it('probes a file and gets its metadata', async () => {
        const result = await client.probe(new TextEncoder().encode('some text'), {
            checksum: true,
        });
        expect(result).toEqual({
            status: 'completed',
            metadata: expect.objectContaining({
                kind: 'other',
                size: 9,
                checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
        });
    });

    it('uploads a file, runs a job on it, and follows its events', async () => {
        const upload = await client.uploads.create(new Blob(['hello']), { probe: true });
        expect(upload).toMatchObject({ size: 5, complete: true, metadata: { kind: 'other' } });

        const job = await client.jobs.create(
            {
                input: { upload: upload.id },
                tasks: { probe: { op: 'probe' } },
                metadata: { mediaId: 42 },
            },
            { idempotencyKey: 'client-test' },
        );
        expect(validate('Job', job).valid).toBe(true);
        const replay = await client.jobs.create(
            {
                input: { upload: upload.id },
                tasks: { probe: { op: 'probe' } },
                metadata: { mediaId: 42 },
            },
            { idempotencyKey: 'client-test' },
        );
        expect(replay.id).toBe(job.id);

        const done = await client.jobs.wait(job.id);
        expect(done).toMatchObject({
            status: 'completed',
            tasks: { probe: { outputs: { metadata: { size: 5 } } } },
        });

        const listed = await client.jobs.list({ metadata: { mediaId: 42 }, status: ['completed'] });
        expect(listed.data.map(({ id }) => id)).toContain(job.id);
        const all = [];
        for await (const item of client.jobs.all({ limit: 1 })) {
            all.push(item.id);
        }
        expect(all).toContain(job.id);
        expect(await client.jobs.files(job.id)).toEqual({ data: [], nextCursor: null });
    });

    it('sends a large file in parts with tus', async () => {
        const file = new Uint8Array(2500).fill(7);
        const sent: number[] = [];
        const upload = await client.uploads.createResumable(file, {
            chunkSize: 1000,
            onProgress: (bytes) => sent.push(bytes),
        });
        expect(sent).toEqual([1000, 2000, 2500]);
        expect(upload).toMatchObject({ size: 2500, complete: true });
        await client.uploads.delete(upload.id);
        await expect(client.uploads.get(upload.id)).rejects.toMatchObject({ status: 404 });
    });

    it('manages presets, with names that contain a slash', async () => {
        const preset = await client.presets.put('mediatheque/test', {
            tasks: { probe: { op: 'probe' } },
        });
        expect(preset).toMatchObject({ name: 'mediatheque/test', scope: 'project', version: 1 });
        expect((await client.presets.get('mediatheque/test')).version).toBe(1);
        expect((await client.presets.list()).data.map(({ name }) => name)).toContain(
            'mediatheque/test',
        );
        await client.presets.delete('mediatheque/test');
        expect((await client.operations()).data.map(({ name }) => name)).toContain('probe');
    });

    it('throws an EclairError with the problem details', async () => {
        const error = await client.jobs
            .create({
                input: { url: 'https://cdn.example.com/a.mp4' },
                tasks: { h264: { op: 'video.nope' } },
            })
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(EclairError);
        expect(error).toMatchObject({
            status: 422,
            problem: {
                errors: { '/tasks/h264/op': ['"video.nope" is not an operation of this server'] },
            },
        });

        const unauthorized = new EclairClient({ url: server.url, key: 'ek_wrong' });
        await expect(unauthorized.operations()).rejects.toMatchObject({ status: 401 });
    });
});

describe('EclairClient without a server', () => {
    it('sends the key, and reads Retry-After', async () => {
        const requests: Request[] = [];
        const client = new EclairClient({
            url: 'https://eclair.test/',
            key: 'ek_test',
            fetch: async (input, init) => {
                requests.push(new Request(input, init));
                return new Response(JSON.stringify({ title: 'Too Many Requests', status: 429 }), {
                    status: 429,
                    headers: { 'retry-after': '12', 'content-type': 'application/problem+json' },
                });
            },
        });
        await expect(client.jobs.list({ status: ['failed'], limit: 5 })).rejects.toMatchObject({
            status: 429,
            retryAfter: 12,
        });
        expect(requests[0]?.url).toBe('https://eclair.test/v1/jobs?status=failed&limit=5');
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer ek_test');
    });

    it('survives an error without problem details', async () => {
        const client = new EclairClient({
            url: 'https://eclair.test',
            key: 'ek_test',
            fetch: async () =>
                new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }),
        });
        await expect(client.operations()).rejects.toMatchObject({
            status: 502,
            message: 'Bad Gateway',
        });
    });
});
