import type { FastifyInstance } from 'fastify';

import { JSON_SCHEMA_ID } from '@eclair-js/protocol';
import type { Preset, PresetList } from '@eclair-js/protocol';

import type { Presets, StoredPreset } from '../../presets/presets.ts';
import { authOf } from '../auth.ts';

function toResponse(preset: StoredPreset): Preset {
    const { name, scope, version, description, tasks } = preset;
    return { name, scope, version, ...(description === undefined ? {} : { description }), tasks };
}

/** Preset names contain `/` (`mediatheque/video`), so routes take the rest of the path. */
function nameOf(params: unknown): string {
    return decodeURIComponent((params as { '*': string })['*']);
}

export function presetRoutes(app: FastifyInstance, presets: Presets): void {
    app.get(
        '/presets',
        { config: { scope: 'jobs:read' } },
        async (request): Promise<PresetList> => {
            const { project } = authOf(request);
            return { data: (await presets.list(project.id)).map(toResponse) };
        },
    );

    app.get('/presets/*', { config: { scope: 'jobs:read' } }, async (request): Promise<Preset> => {
        const { project } = authOf(request);
        return toResponse(await presets.get(project.id, nameOf(request.params)));
    });

    app.put(
        '/presets/*',
        {
            config: { scope: 'presets:write' },
            schema: { body: { $ref: `${JSON_SCHEMA_ID}#/$defs/PresetRequest` } },
        },
        async (request, reply) => {
            const { project } = authOf(request);
            const { preset, created } = await presets.put(
                project.id,
                nameOf(request.params),
                request.body,
            );
            return reply.code(created ? 201 : 200).send(toResponse(preset));
        },
    );

    app.delete('/presets/*', { config: { scope: 'presets:write' } }, async (request, reply) => {
        const { project } = authOf(request);
        await presets.delete(project.id, nameOf(request.params));
        return reply.code(204).send();
    });
}
