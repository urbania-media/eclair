import type { ErrorObject } from 'ajv/dist/2020.js';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyServerOptions } from 'fastify';
import { STATUS_CODES } from 'node:http';

import { jsonSchema } from '@eclair-js/protocol';

import { ConflictError, NotFoundError } from '../errors.ts';
import type { Services } from '../services.ts';
import { InvalidValueError, createAjv, groupErrors } from '../validation.ts';
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

/** A dependency that `/ready` checks: the database, Redis, the binaries… */
export interface ReadinessCheck {
    name: string;
    /** Resolves when the dependency works, rejects with a message that says what's wrong. */
    check(): Promise<void>;
}

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

function withTimeout(promise: Promise<void>, milliseconds: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`no answer after ${milliseconds} ms`)),
            milliseconds,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

    app.get('/ready', async (request, reply) => {
        const checks = options.checks ?? [];
        const results = await Promise.all(
            checks.map(async ({ name, check }) => {
                try {
                    await withTimeout(check(), options.checkTimeout ?? 5000);
                    return [name, 'ok'] as const;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    // The reason goes to the logs only: it can name hosts or paths.
                    request.log.warn({ check: name, error: message }, 'Readiness check failed');
                    return [name, 'failed'] as const;
                }
            }),
        );
        const ready = results.every(([, result]) => result === 'ok');
        return reply
            .code(ready ? 200 : 503)
            .send({ status: ready ? 'ready' : 'unready', checks: Object.fromEntries(results) });
    });

    if (options.services !== undefined) {
        void app.register(v1, { prefix: '/v1', services: options.services });
    }

    return app;
}
