import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ApiKeys, Authentication, Scope } from '../projects/api-keys.ts';
import { problems } from './problem.ts';

declare module 'fastify' {
    interface FastifyRequest {
        /** The project and key of the request, set by the `/v1` authentication hook. */
        auth: Authentication | null;
    }

    interface FastifyContextConfig {
        /** Scope the API key needs for this route. */
        scope?: Scope;
    }
}

function unauthorized(detail: string) {
    const problem = problems.unauthorized(detail);
    problem.headers['www-authenticate'] = 'Bearer realm="eclair"';
    return problem;
}

/**
 * Authenticates the requests of a plugin with the project API keys (`Authorization: Bearer ek_…`),
 * and checks the scope that each route sets in `config.scope`.
 */
export function authenticateWithApiKeys(app: FastifyInstance, apiKeys: ApiKeys): void {
    app.decorateRequest('auth', null);

    app.addHook('onRequest', async (request: FastifyRequest) => {
        const header = request.headers.authorization;
        const match = header === undefined ? null : /^Bearer\s+(\S+)\s*$/i.exec(header);
        if (match?.[1] === undefined) {
            throw unauthorized('Send an API key: Authorization: Bearer <key>.');
        }
        const auth = await apiKeys.authenticate(match[1]);
        if (auth === undefined) {
            throw unauthorized('The API key is unknown or revoked.');
        }
        request.auth = auth;
        request.log = request.log.child({ project: auth.project.slug });
    });

    app.addHook('preHandler', async (request: FastifyRequest) => {
        const scope = request.routeOptions.config.scope;
        if (scope !== undefined && !request.auth?.key.scopes.includes(scope)) {
            throw problems.forbidden(`The API key doesn't have the ${scope} scope.`);
        }
    });
}

/** The authentication of a request, in a route that requires one. */
export function authOf(request: FastifyRequest): Authentication {
    if (request.auth === null) {
        throw unauthorized('Send an API key: Authorization: Bearer <key>.');
    }
    return request.auth;
}
