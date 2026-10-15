import { Type } from 'typebox';

import { defineOperation } from '@eclair-js/operation';

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

export function testRegistry(): OperationRegistry {
    return new OperationRegistry(testOperations);
}
