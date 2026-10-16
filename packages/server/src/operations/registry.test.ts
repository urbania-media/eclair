import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { defineOperation } from '@eclair-js/operation';

import { InvalidValueError } from '../validation.ts';
import { BUILT_IN_PLUGINS, OperationRegistry, PluginError } from './registry.ts';

function operation(name: string, version = 1) {
    return defineOperation({
        name,
        version,
        description: `${name} ${version}`,
        accepts: { kinds: ['image'] },
        capability: 'cpu',
        binaries: [],
        options: Type.Object(
            {
                count: Type.Integer({ minimum: 1, default: 5 }),
                format: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
        ),
        outputs: { files: false, metadata: true },
        run: async () => ({}),
    });
}

const palette1 = operation('image.palette', 1);
const palette2 = operation('image.palette', 2);
const blurhash = operation('image.blurhash');

describe('OperationRegistry.load', () => {
    it('loads the built-in operations', async () => {
        const registry = await OperationRegistry.load(BUILT_IN_PLUGINS);
        expect(registry.resolve('probe')?.key).toBe('probe@1');
        expect(registry.resolve('video.transcode')?.key).toBe('video.transcode@1');
        expect(registry.resolve('video.hls')?.capability).toBe('video');
        expect(registry.resolve('audio.waveform')?.key).toBe('audio.waveform@1');
        expect(registry.resolve('document.thumbnails')?.key).toBe('document.thumbnails@1');
        expect(registry.resolve('font.convert')?.key).toBe('font.convert@1');
        expect(registry.resolve('image.palette')?.key).toBe('image.palette@1');
    });

    it('accepts a list or { operations }, and refuses anything else', async () => {
        const modules: Record<string, unknown> = {
            list: { default: [palette1] },
            object: { default: { operations: [blurhash] } },
            broken: { default: { nope: true } },
            fake: { default: [{ name: 'image.fake', run: () => {} }] },
        };
        const importModule = async (name: string) => {
            if (!(name in modules)) {
                throw new Error(`Cannot find package '${name}'`);
            }
            return modules[name];
        };

        const registry = await OperationRegistry.load(['list', 'object'], importModule);
        expect(registry.list().map(({ key }) => key)).toEqual([
            'image.blurhash@1',
            'image.palette@1',
        ]);

        await expect(OperationRegistry.load(['broken'], importModule)).rejects.toThrow(PluginError);
        await expect(OperationRegistry.load(['fake'], importModule)).rejects.toThrow(
            /defineOperation/,
        );
        await expect(OperationRegistry.load(['missing'], importModule)).rejects.toThrow(
            "Plugin missing: can't be loaded. Is it installed?",
        );
        await expect(OperationRegistry.load(['list', 'list'], importModule)).resolves.toBeDefined();
    });

    it('refuses two plugins with the same operation', () => {
        expect(() => new OperationRegistry([palette1, palette1])).toThrow(
            'Two plugins provide image.palette@1.',
        );
    });
});

describe('OperationRegistry', () => {
    const registry = new OperationRegistry([palette1, palette2, blurhash]);

    it('resolves the latest version or an exact one', () => {
        expect(registry.resolve('image.palette')?.key).toBe('image.palette@2');
        expect(registry.resolve('image.palette@1')?.key).toBe('image.palette@1');
        expect(registry.resolve('image.palette@3')).toBeUndefined();
        expect(registry.resolve('video.hls')).toBeUndefined();
    });

    it('validates options and applies their defaults, without changing them', () => {
        const options = { format: 'hex' };
        expect(registry.validateOptions(palette1, options)).toEqual({ format: 'hex', count: 5 });
        expect(options).toEqual({ format: 'hex' });
        expect(registry.validateOptions(palette1, undefined)).toEqual({ count: 5 });
        expect(() =>
            registry.validateOptions(palette1, { count: 0, size: 3 }, '/tasks/palette/options'),
        ).toThrow(
            expect.objectContaining({
                errors: {
                    '/tasks/palette/options/count': ['must be >= 1'],
                    '/tasks/palette/options/size': ['must NOT have additional properties'],
                },
            }) as never,
        );
    });

    it('checks every task at once, with what the project may use', () => {
        let error: unknown;
        try {
            registry.checkTasks(
                {
                    palette: { op: 'image.palette', options: { count: 0 } },
                    hls: { op: 'video.hls' },
                    blur: { op: 'image.blurhash' },
                    ok: { op: 'image.palette@1' },
                },
                '/tasks',
                {
                    concurrency: 4,
                    maxDirectUpload: 1,
                    probesPerMinute: 1,
                    taskWebhooks: false,
                    operations: ['image.palette'],
                },
            );
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(InvalidValueError);
        expect((error as InvalidValueError).errors).toEqual({
            '/tasks/palette/options/count': ['must be >= 1'],
            '/tasks/hls/op': ['"video.hls" is not an operation of this server'],
            '/tasks/blur/op': ['the project may not use image.blurhash'],
        });
    });

    it('describes the operations a project may use, as the protocol says', () => {
        const all = registry.describe(undefined);
        expect(all.map(({ name, version }) => `${name}@${version}`)).toEqual([
            'image.blurhash@1',
            'image.palette@1',
            'image.palette@2',
        ]);
        expect(all[0]).toEqual({
            name: 'image.blurhash',
            version: 1,
            description: 'image.blurhash 1',
            accepts: { kinds: ['image'] },
            capability: 'cpu',
            outputs: { files: false, metadata: true },
            options: expect.objectContaining({ type: 'object', additionalProperties: false }),
        });
        expect(
            registry.describe({
                concurrency: 4,
                maxDirectUpload: 1,
                probesPerMinute: 1,
                taskWebhooks: false,
                operations: ['image.blurhash'],
            }),
        ).toHaveLength(1);
    });
});
