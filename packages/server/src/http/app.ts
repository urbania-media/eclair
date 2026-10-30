import type { ErrorObject } from 'ajv/dist/2020.js';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyServerOptions } from 'fastify';
import { STATUS_CODES } from 'node:http';

import { jsonSchema } from '@eclair-js/protocol';

import { ConflictError, NotFoundError, RateLimitedError } from '../errors.ts';
import type { HostRegistry } from '../hosts.ts';
import type { TaskQueues } from '../jobs/queues.ts';
import type { Metrics } from '../metrics.ts';
import type { Services } from '../services.ts';
import { InvalidValueError, createAjv, groupErrors } from '../validation.ts';
import { admin } from './admin/index.ts';
import { runChecks } from './checks.ts';
import type { ReadinessCheck } from './checks.ts';
import { type DashboardOptions, dashboardRoutes } from './dashboard.ts';
import { fileRoutes } from './files.ts';
import { HttpProblem, problems } from './problem.ts';
import { v1 } from './v1/index.ts';

export interface RouteSummary {
    method: string;
    url: string;
}

declare module 'fastify' {
    interface FastifyInstance {
        /** Every route of the app, in the order they were added. */
        eclairRoutes: RouteSummary[];
    }
}

export type { ReadinessCheck } from './checks.ts';

export interface AppOptions {
    version: string;
    /** Fastify's logger options, or `false` to log nothing (tests). */
    logger?: FastifyServerOptions['logger'];
    /** A pino logger to use instead, shared with the workers of the process. */
    loggerInstance?: FastifyServerOptions['loggerInstance'];
    checks?: ReadinessCheck[];
    /** How long a readiness check may take, in milliseconds. */
    checkTimeout?: number;
    /** The repositories. Without them, only `/health` and `/ready` exist (tests). */
    services?: Services;
    /** Served on `/metrics`, for Prometheus. */
    metrics?: Metrics;
    /** `ECLAIR_ADMIN_TOKEN`. Without it, there is no admin API. */
    adminToken?: string | undefined;
    /** The hosts of the install, for `GET /admin/v1/status`. */
    hosts?: HostRegistry | undefined;
    /** The task queues, for `GET /admin/v1/status`. */
    queues?: TaskQueues | undefined;
    /** The built dashboard, served at `/dashboard/` with the admin API (decision 0021). */
    dashboard?: DashboardOptions | undefined;
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

function sendProblem(reply: FastifyReply, problem: HttpProblem): FastifyReply {
    return reply
        .code(problem.status)
        .headers(problem.headers)
        .type(PROBLEM_CONTENT_TYPE)
        .send(problem.toJSON());
}

function toHttpProblem(error: FastifyError | Error): HttpProblem | undefined {
    if (error instanceof HttpProblem) {
        return error;
    }
    if (error instanceof NotFoundError) {
        return problems.notFound(error.message);
    }
    if (error instanceof ConflictError) {
        return problems.conflict(error.message);
    }
    if (error instanceof InvalidValueError) {
        return problems.invalid(error.errors, error.message);
    }
    if (error instanceof RateLimitedError) {
        return problems.tooManyRequests(error.retryAfter, error.message);
    }
    // Only Fastify's own errors become client errors: another library's statusCode could leak
    // its message.
    const code = (error as FastifyError).code;
    if (typeof code !== 'string' || !code.startsWith('FST_')) {
        return undefined;
    }
    if ('validation' in error && error.validation !== undefined) {
        const context = error.validationContext ?? 'body';
        return problems.invalid(
            groupErrors(error.validation as ErrorObject[]),
            context === 'body'
                ? 'The request body is invalid.'
                : `The request ${context} is invalid.`,
        );
    }
    const status = (error as FastifyError).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
        // Fastify's own client errors (bad JSON, unsupported content type, body too large) have
        // messages meant for the client.
        return new HttpProblem(status, STATUS_CODES[status], { detail: error.message });
    }
    return undefined;
}

/**
 * Builds the HTTP app: validation with the protocol's schemas, problem+json errors, `/health` and
 * `/ready`. The `/v1` and `/admin/v1` plugins are registered on it (decision 0013).
 */
export function buildApp(options: AppOptions): FastifyInstance {
    const ajv = createAjv();
    ajv.addSchema(jsonSchema);

    const app = Fastify({
        ...(options.loggerInstance === undefined
            ? { logger: options.logger ?? false }
            : { loggerInstance: options.loggerInstance }),
        // Ids in logs come from Fastify; clients can't choose them.
        requestIdHeader: false,
        // Download tokens are longer than the default of 100 characters.
        routerOptions: { maxParamLength: 4096 },
    });

    app.setValidatorCompiler(({ schema }) => ajv.compile(schema));

    // Every route, for the test that compares them with the OpenAPI document (decision 0013).
    const routes: RouteSummary[] = [];
    app.decorate('eclairRoutes', routes);
    app.addHook('onRoute', ({ method, url }) => {
        for (const verb of Array.isArray(method) ? method : [method]) {
            routes.push({ method: verb, url });
        }
    });

    app.setErrorHandler((error: FastifyError, request, reply) => {
        const problem = toHttpProblem(error);
        if (problem !== undefined) {
            return sendProblem(reply, problem);
        }
        request.log.error({ err: error }, 'Request failed');
        return sendProblem(reply, new HttpProblem(500));
    });

    app.setNotFoundHandler((request, reply) =>
        sendProblem(reply, problems.notFound(`No route for ${request.method} ${request.url}.`)),
    );

    app.get('/health', async () => ({ status: 'ok', version: options.version }));

    const { metrics } = options;
    if (metrics !== undefined) {
        app.get('/metrics', async (_request, reply) =>
            reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()),
        );
    }

    app.get('/ready', async (request, reply) => {
        const { ready, checks } = await runChecks(
            options.checks ?? [],
            options.checkTimeout ?? 5000,
            request.log,
        );
        return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unready', checks });
    });

    // The dashboard is useless without the admin API, and the admin token is its sign-in.
    if (options.dashboard !== undefined && options.adminToken !== undefined) {
        void app.register(dashboardRoutes, options.dashboard);
    }

    if (options.services !== undefined) {
        void app.register(v1, { prefix: '/v1', services: options.services });
        // Without an API key: the signed token is the authorization.
        void app.register(fileRoutes, { prefix: '/v1', links: options.services.links });
        if (options.adminToken !== undefined) {
            void app.register(admin, {
                prefix: '/admin/v1',
                services: options.services,
                adminToken: options.adminToken,
                version: options.version,
                checks: options.checks ?? [],
                checkTimeout: options.checkTimeout ?? 5000,
                hosts: options.hosts,
                queues: options.queues,
            });
        }
    }

    return app;
}
