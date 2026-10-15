import type { ErrorObject } from 'ajv/dist/2020.js';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyServerOptions } from 'fastify';
import { STATUS_CODES } from 'node:http';

import { jsonSchema } from '@eclair-js/protocol';

import { createAjv } from '../validation.ts';
import { HttpProblem, problems } from './problem.ts';

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
    checks?: ReadinessCheck[];
    /** How long a readiness check may take, in milliseconds. */
    checkTimeout?: number;
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

function escapePointerToken(token: string): string {
    return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Groups Ajv errors by JSON pointer, pointing at a missing or unexpected property itself. */
function toProblemErrors(validation: ErrorObject[]): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    for (const error of validation) {
        const params = error.params as Record<string, unknown>;
        const property = params['missingProperty'] ?? params['additionalProperty'];
        const pointer =
            typeof property === 'string'
                ? `${error.instancePath}/${escapePointerToken(property)}`
                : error.instancePath;
        const messages = (errors[pointer] ??= []);
        const message = error.message ?? 'is invalid';
        if (!messages.includes(message)) {
            messages.push(message);
        }
    }
    return errors;
}

function sendProblem(reply: FastifyReply, problem: HttpProblem): FastifyReply {
    return reply
        .code(problem.status)
        .headers(problem.headers)
        .type(PROBLEM_CONTENT_TYPE)
        .send(problem.toJSON());
}

function toHttpProblem(error: FastifyError): HttpProblem | undefined {
    if (error instanceof HttpProblem) {
        return error;
    }
    if (error.validation !== undefined) {
        const context = error.validationContext ?? 'body';
        return problems.invalid(
            toProblemErrors(error.validation as ErrorObject[]),
            context === 'body'
                ? 'The request body is invalid.'
                : `The request ${context} is invalid.`,
        );
    }
    const status = error.statusCode;
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
        logger: options.logger ?? false,
        // Ids in logs come from Fastify; clients can't choose them.
        requestIdHeader: false,
    });

    app.setValidatorCompiler(({ schema }) => ajv.compile(schema));

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

    return app;
}
