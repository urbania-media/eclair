import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { acceptsInput, defineOperation } from './operation.ts';

const definition = {
    name: 'image.palette',
    version: 1,
    description: 'Dominant colors',
    accepts: { kinds: ['image' as const, 'video' as const], mimes: ['image/*', 'video/mp4'] },
    capability: 'cpu' as const,
    binaries: ['magick'],
    options: Type.Object({ count: Type.Integer({ default: 5 }) }, { additionalProperties: false }),
    outputs: { files: false, metadata: true },
    run: async (_context: unknown, options: { count: number }) => ({
        metadata: { count: options.count },
    }),
};

describe('defineOperation', () => {
    it('adds a key with the name and version', () => {
        const operation = defineOperation(definition);
        expect(operation.key).toBe('image.palette@1');
        expect(Object.isFrozen(operation)).toBe(true);
    });

    it('refuses bad names and versions', () => {
        expect(() => defineOperation({ ...definition, name: 'Palette' })).toThrow(
            /not an operation name/,
        );
        expect(() => defineOperation({ ...definition, name: 'image' })).toThrow(
            /not an operation name/,
        );
        expect(() => defineOperation({ ...definition, version: 0 })).toThrow(/version/);
    });
});

describe('acceptsInput', () => {
    const operation = defineOperation(definition);

    it('checks the kind and the mime type', () => {
        expect(acceptsInput(operation, { kind: 'image', mime: 'image/png' })).toBe(true);
        expect(acceptsInput(operation, { kind: 'video', mime: 'video/mp4' })).toBe(true);
        expect(acceptsInput(operation, { kind: 'video', mime: 'video/webm' })).toBe(false);
        expect(acceptsInput(operation, { kind: 'audio', mime: 'audio/mpeg' })).toBe(false);
    });

    it('accepts everything when it says nothing', () => {
        expect(acceptsInput({ accepts: {} }, { kind: 'other', mime: 'application/zip' })).toBe(
            true,
        );
    });
});
