import type { FastifyInstance } from 'fastify';

import type { Services } from '../../services.ts';
import { authenticateWithApiKeys } from '../auth.ts';
import { presetRoutes } from './presets.ts';

/** The `/v1` API of the protocol, for projects. */
export async function v1(app: FastifyInstance, options: { services: Services }): Promise<void> {
    const { services } = options;
    authenticateWithApiKeys(app, services.apiKeys);
    presetRoutes(app, services.presets);
}
