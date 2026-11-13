import { Type } from 'typebox';

import { defineEmbedOperation, defineEmbedProvider, defineOperation } from '@eclair-js/operation';

import { OperationRegistry } from '../operations/registry.ts';

/** Operations for the tests of jobs: they never run here, only their definitions matter. */
export const testOperations = [
    defineOperation({
        name: 'probe',
        version: 1,
        description: 'Reads metadata',
        accepts: {},
        capability: 'probe',
        binaries: [],
        options: Type.Object(
            { checksum: Type.Boolean({ default: false }) },
            { additionalProperties: false },
        ),
        outputs: { files: false, metadata: true },
        run: async () => ({ metadata: {} }),
    }),
    defineOperation({
        name: 'video.transcode',
        version: 1,
        description: 'Writes a file',
        accepts: { kinds: ['video'] },
        capability: 'video',
        binaries: [],
        options: Type.Object(
            { codec: Type.Union([Type.Literal('h264'), Type.Literal('vp9')], { default: 'h264' }) },
            { additionalProperties: false },
        ),
        outputs: { files: true, metadata: false },
        run: async () => ({}),
    }),
    defineOperation({
        name: 'video.hls',
        version: 1,
        description: 'Writes files from a file',
        accepts: { kinds: ['video'] },
        capability: 'video',
        binaries: [],
        options: Type.Object({}, { additionalProperties: false }),
        outputs: { files: true, metadata: false },
        run: async () => ({}),
    }),
];

/** An embed provider for the tests: `https://video.example.com/<id>`. */
export const testEmbedProvider = defineEmbedProvider({
    name: 'example',
    title: 'Example',
    match(url) {
        const id = /^\/([a-z0-9]+)$/.exec(url.pathname)?.[1];
        return url.hostname === 'video.example.com' && id !== undefined
            ? { id, url: `https://video.example.com/${id}` }
            : undefined;
    },
    credentials: Type.Object(
        { token: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
    ),
});

/** An embed operation for the tests of jobs. */
export const testEmbedProbe = defineEmbedOperation({
    name: 'embed.probe',
    version: 1,
    description: 'Reads an embed',
    capability: 'probe',
    binaries: [],
    options: Type.Object({}, { additionalProperties: false }),
    outputs: { files: false, metadata: true },
    run: async () => ({ metadata: {} }),
});

/** An embed operation that downloads, for the tests of jobs. */
export const testEmbedDownload = defineEmbedOperation({
    name: 'embed.download',
    version: 1,
    description: 'Downloads an embed',
    capability: 'network',
    binaries: [],
    downloads: true,
    options: Type.Object({}, { additionalProperties: false }),
    outputs: { files: true, metadata: true },
    run: async () => ({}),
});

export function testRegistry(): OperationRegistry {
    return new OperationRegistry(
        [...testOperations, testEmbedProbe, testEmbedDownload],
        [testEmbedProvider],
    );
}
