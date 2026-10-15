import type { FastifyInstance } from 'fastify';

import type { OperationList } from '@eclair-js/protocol';

import type { OperationRegistry } from '../../operations/registry.ts';
import { authOf } from '../auth.ts';

export function operationRoutes(app: FastifyInstance, operations: OperationRegistry): void {
    app.get(
        '/operations',
        { config: { scope: 'jobs:read' } },
        async (request): Promise<OperationList> => ({
            data: operations.describe(authOf(request).project.settings),
        }),
    );
}
