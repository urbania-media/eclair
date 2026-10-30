import type { FastifyInstance, FastifyRequest } from 'fastify';

import { JSON_SCHEMA_ID } from '@eclair-js/protocol';
import type {
    Job,
    JobEvent,
    JobFileList,
    JobList,
    JobRequest,
    JobStatus,
} from '@eclair-js/protocol';

import { JSON_KEY_PATTERN } from '../../database/json.ts';
import { isId } from '../../ids.ts';
import type { JobEvents } from '../../jobs/events.ts';
import type { JobFilters, Jobs } from '../../jobs/jobs.ts';
import { authOf } from '../auth.ts';
import { problems } from '../problem.ts';

const ENDED: readonly string[] = ['completed', 'failed', 'canceled'];
/** Milliseconds between the comments that keep an event stream open through proxies. */
const PING_INTERVAL = 15_000;

const JOB_STATUSES: readonly JobStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'canceled',
];

function idOf(request: FastifyRequest): string {
    return (request.params as { id: string }).id;
}

/** `limit` and `cursor` of a list, checked. */
function page(
    query: Record<string, unknown>,
    kind: 'job' | 'output',
): { limit: number; cursor?: string } {
    const errors: Record<string, string[]> = {};
    const limit = query['limit'] === undefined ? 25 : Number(query['limit']);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        errors['?limit'] = ['must be an integer from 1 to 100'];
    }
    const cursor = query['cursor'];
    if (cursor !== undefined && !isId(kind, cursor)) {
        errors['?cursor'] = ['must be the nextCursor of the previous page'];
    }
    if (Object.keys(errors).length > 0) {
        throw problems.invalid(errors, 'The query is invalid.');
    }
    return { limit, ...(typeof cursor === 'string' ? { cursor } : {}) };
}

/**
 * The filters of a list of jobs, checked: those of `GET /v1/jobs`, and with `admin`, the
 * `createdBefore` and `operation` of `GET /admin/v1/jobs`.
 */
export function jobFilters(
    query: Record<string, unknown>,
    options: { admin?: boolean } = {},
): JobFilters {
    const errors: Record<string, string[]> = {};

    const status =
        typeof query['status'] === 'string'
            ? query['status'].split(',').filter((value) => value !== '')
            : [];
    if (status.some((value) => !JOB_STATUSES.includes(value as JobStatus))) {
        errors['?status'] = [`must be some of ${JOB_STATUSES.join(', ')}`];
    }

    const date = (name: string): Date | undefined => {
        if (query[name] === undefined) {
            return undefined;
        }
        const value = new Date(String(query[name]));
        if (Number.isNaN(value.getTime())) {
            errors[`?${name}`] = ['must be a date-time'];
        }
        return value;
    };
    const createdAfter = date('createdAfter');
    const createdBefore = options.admin === true ? date('createdBefore') : undefined;

    let operation: string | undefined;
    if (options.admin === true && query['operation'] !== undefined) {
        if (typeof query['operation'] !== 'string' || query['operation'] === '') {
            errors['?operation'] = ['must be the name of an operation'];
        } else {
            operation = query['operation'];
        }
    }

    const metadata: Record<string, string> = {};
    for (const [name, value] of Object.entries(query)) {
        const key = /^metadata\[(.*)\]$/.exec(name)?.[1];
        if (key === undefined) {
            continue;
        }
        if (!JSON_KEY_PATTERN.test(key) || typeof value !== 'string') {
            errors[`?${name}`] = ['must be one value, for a key of letters, digits, - and _'];
        } else {
            metadata[key] = value;
        }
    }

    if (Object.keys(errors).length > 0) {
        throw problems.invalid(errors, 'The query is invalid.');
    }

    return {
        ...page(query, 'job'),
        ...(status.length === 0 ? {} : { status: status as JobStatus[] }),
        ...(createdAfter === undefined ? {} : { createdAfter }),
        ...(createdBefore === undefined ? {} : { createdBefore }),
        ...(operation === undefined ? {} : { operation }),
        metadata,
    };
}

/** `/v1/jobs` (decision 0004). */
export function jobRoutes(app: FastifyInstance, jobs: Jobs, events: JobEvents): void {
    app.post(
        '/jobs',
        {
            config: { scope: 'jobs:write' },
            schema: { body: { $ref: `${JSON_SCHEMA_ID}#/$defs/JobRequest` } },
        },
        async (request, reply): Promise<Job> => {
            const { project } = authOf(request);
            const key = request.headers['idempotency-key'];
            if (
                key !== undefined &&
                (typeof key !== 'string' || key.length === 0 || key.length > 255)
            ) {
                throw problems.invalid({ '': ['Idempotency-Key must be 1 to 255 characters'] });
            }
            const { job } = await jobs.create(project, request.body as JobRequest, key);
            return reply.code(202).header('location', `/v1/jobs/${job.id}`).send(job);
        },
    );

    app.get('/jobs', { config: { scope: 'jobs:read' } }, async (request): Promise<JobList> =>
        jobs.list(authOf(request).project.id, jobFilters(request.query as Record<string, unknown>)),
    );

    app.get('/jobs/:id', { config: { scope: 'jobs:read' } }, async (request): Promise<Job> =>
        jobs.get(authOf(request).project.id, idOf(request)),
    );

    app.get(
        '/jobs/:id/files',
        { config: { scope: 'jobs:read' } },
        async (request): Promise<JobFileList> => {
            const query = request.query as Record<string, unknown>;
            const task = typeof query['task'] === 'string' ? query['task'] : undefined;
            return jobs.files(authOf(request).project.id, idOf(request), {
                ...page(query, 'output'),
                ...(task === undefined ? {} : { task }),
            });
        },
    );

    // Server-sent events: the current statuses, then every change, until the job ends.
    app.get('/jobs/:id/events', { config: { scope: 'jobs:read' } }, async (request, reply) => {
        const { project } = authOf(request);
        const id = idOf(request);
        await jobs.get(project.id, id);

        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            // nginx would buffer the stream otherwise.
            'x-accel-buffering': 'no',
        });
        const send = (event: JobEvent) => {
            raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        };

        let closed = false;
        // Set once subscribed; `close` can run before.
        const subscription: { unsubscribe?: () => Promise<void> } = {};
        const ping = setInterval(() => raw.write(': ping\n\n'), PING_INTERVAL);
        const close = async () => {
            if (closed) {
                return;
            }
            closed = true;
            clearInterval(ping);
            await subscription.unsubscribe?.();
            raw.end();
        };
        request.raw.on('close', () => void close());

        // Subscribe first, then send the current statuses: no change falls in between.
        subscription.unsubscribe = await events.subscribe(id, (event) => {
            if (closed) {
                return;
            }
            send(event);
            if (event.type === 'job.status' && ENDED.includes(event.status ?? '')) {
                void close();
            }
        });
        const job = await jobs.get(project.id, id);
        send({ type: 'job.status', job: id, status: job.status });
        for (const [name, task] of Object.entries(job.tasks)) {
            send({ type: 'task.status', job: id, task: name, status: task.status });
        }
        if (ENDED.includes(job.status)) {
            await close();
        }
    });

    app.post(
        '/jobs/:id/cancel',
        { config: { scope: 'jobs:write' } },
        async (request): Promise<Job> => jobs.cancel(authOf(request).project.id, idOf(request)),
    );

    app.post(
        '/jobs/:id/retry',
        { config: { scope: 'jobs:write' } },
        async (request, reply): Promise<Job> => {
            const job = await jobs.retry(authOf(request).project.id, idOf(request));
            return reply.code(202).send(job);
        },
    );
}
