import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors.ts';
import { BUILT_IN_PLUGINS, OperationRegistry } from '../operations/registry.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';
import { BUILT_IN_PRESETS } from './built-in.ts';

let services: Services;
let projectId: string;
let otherId: string;

const webVideo = {
    description: 'Video for the web',
    tasks: {
        probe: { op: 'probe' },
        h264: { op: 'video.transcode', options: { codec: 'h264' } },
    },
};

beforeAll(async () => {
    services = await createTestServices();
    projectId = (await services.projects.create({ slug: 'niche' })).project.id;
    otherId = (await services.projects.create({ slug: 'other' })).project.id;
});

afterAll(async () => {
    await services.database.close();
});

describe('Presets', () => {
    it('creates a global preset and counts its versions', async () => {
        const created = await services.presets.put(undefined, 'site-video', webVideo);
        expect(created).toMatchObject({ created: true, preset: { scope: 'global', version: 1 } });
        const updated = await services.presets.put(undefined, 'site-video', {
            tasks: { probe: { op: 'probe' } },
        });
        expect(updated.created).toBe(false);
        expect(updated.preset).toMatchObject({ version: 2, tasks: { probe: { op: 'probe' } } });
        expect(updated.preset.description).toBeUndefined();
    });

    it('lets a project override a global preset, for itself only', async () => {
        await services.presets.put(projectId, 'site-video', webVideo);
        await services.presets.put(projectId, 'site/video', webVideo);

        expect((await services.presets.get(projectId, 'site-video')).scope).toBe('project');
        expect((await services.presets.get(otherId, 'site-video')).scope).toBe('global');
        await expect(services.presets.get(otherId, 'site/video')).rejects.toThrow(NotFoundError);
        expect(
            (await services.presets.list(projectId))
                .filter(({ builtIn }) => !builtIn)
                .map(({ name, scope }) => [name, scope]),
        ).toEqual([
            ['site-video', 'project'],
            ['site/video', 'project'],
        ]);
    });

    it('validates presets against the protocol', async () => {
        await expect(services.presets.put(projectId, 'Bad Name', webVideo)).rejects.toThrow(
            InvalidValueError,
        );
        await expect(
            services.presets.put(projectId, 'bad', { tasks: { h264: { options: {} } } }),
        ).rejects.toMatchObject({ errors: { '/tasks/h264/op': expect.any(Array) } });
    });

    it('runs the task checker', async () => {
        services.presets.setTaskChecker((tasks, pointer) => {
            for (const [name, task] of Object.entries(tasks)) {
                if (task.op === 'video.nope') {
                    throw new InvalidValueError({ [`${pointer}/${name}/op`]: ['is unknown'] });
                }
            }
        });
        await expect(
            services.presets.put(projectId, 'nope', { tasks: { x: { op: 'video.nope' } } }),
        ).rejects.toMatchObject({ errors: { '/tasks/x/op': ['is unknown'] } });
    });

    it('deletes a preset of its own scope only', async () => {
        await services.presets.delete(projectId, 'site-video');
        expect((await services.presets.get(projectId, 'site-video')).scope).toBe('global');
        await expect(services.presets.delete(otherId, 'site-video')).rejects.toThrow(NotFoundError);
    });
});

describe('built-in presets', () => {
    it('only use built-in operations, with valid options', async () => {
        const registry = await OperationRegistry.load(BUILT_IN_PLUGINS);
        for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
            expect(() => registry.checkTasks(preset.tasks, `/${name}`, undefined)).not.toThrow();
        }
    });

    it('are seen by every project, below the global and project presets', async () => {
        const third = (await services.projects.create({ slug: 'third' })).project.id;
        expect((await services.presets.get(third, 'mediatheque/video')).builtIn).toBe(true);
        expect((await services.presets.list(third)).map(({ name }) => name)).toEqual([
            'mediatheque/audio',
            'mediatheque/document',
            'mediatheque/font',
            'mediatheque/video',
            'site-video',
            'web-audio',
            'web-image',
            'web-video',
        ]);
        const mediatheque = await services.presets.get(third, 'mediatheque/video');
        expect(Object.keys(mediatheque.tasks)).toEqual([
            'probe',
            'h264',
            'webm',
            'hevc',
            'thumbnails',
        ]);
        expect(mediatheque).toMatchObject({ scope: 'global', version: 1, id: undefined });

        await services.presets.put(undefined, 'web-audio', { tasks: { probe: { op: 'probe' } } });
        await services.presets.put(third, 'web-image', { tasks: { probe: { op: 'probe' } } });
        const presets = await services.presets.list(third);
        expect(presets.find(({ name }) => name === 'web-audio')).toMatchObject({
            scope: 'global',
            builtIn: false,
        });
        expect(presets.find(({ name }) => name === 'web-image')).toMatchObject({
            scope: 'project',
        });
        expect((await services.presets.get(otherId, 'web-audio')).builtIn).toBe(false);

        // Removing the global preset brings the built-in one back.
        await services.presets.delete(undefined, 'web-audio');
        expect((await services.presets.get(otherId, 'web-audio')).builtIn).toBe(true);
    });

    it("can't be removed", async () => {
        await expect(services.presets.delete(undefined, 'web-video')).rejects.toThrow(
            "is built in: it can't be removed",
        );
    });
});
