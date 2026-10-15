import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors.ts';
import type { Services } from '../services.ts';
import { createTestServices } from '../testing.ts';
import { InvalidValueError } from '../validation.ts';

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
        const created = await services.presets.put(undefined, 'web-video', webVideo);
        expect(created).toMatchObject({ created: true, preset: { scope: 'global', version: 1 } });
        const updated = await services.presets.put(undefined, 'web-video', {
            tasks: { probe: { op: 'probe' } },
        });
        expect(updated.created).toBe(false);
        expect(updated.preset).toMatchObject({ version: 2, tasks: { probe: { op: 'probe' } } });
        expect(updated.preset.description).toBeUndefined();
    });

    it('lets a project override a global preset, for itself only', async () => {
        await services.presets.put(projectId, 'web-video', webVideo);
        await services.presets.put(projectId, 'mediatheque/video', webVideo);

        expect((await services.presets.get(projectId, 'web-video')).scope).toBe('project');
        expect((await services.presets.get(otherId, 'web-video')).scope).toBe('global');
        await expect(services.presets.get(otherId, 'mediatheque/video')).rejects.toThrow(
            NotFoundError,
        );
        expect(
            (await services.presets.list(projectId)).map(({ name, scope }) => [name, scope]),
        ).toEqual([
            ['mediatheque/video', 'project'],
            ['web-video', 'project'],
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
        await services.presets.delete(projectId, 'web-video');
        expect((await services.presets.get(projectId, 'web-video')).scope).toBe('global');
        await expect(services.presets.delete(otherId, 'web-video')).rejects.toThrow(NotFoundError);
    });
});
