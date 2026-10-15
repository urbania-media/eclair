import type { FastifyInstance, FastifyRequest } from 'fastify';

import { JSON_SCHEMA_ID } from '@eclair-js/protocol';
import type { Job, JobFileList, JobList, JobRequest, JobStatus } from '@eclair-js/protocol';

import { JSON_KEY_PATTERN } from '../../database/json.ts';
import { isId } from '../../ids.ts';
import type { Jobs } from '../../jobs/jobs.ts';
import { authOf } from '../auth.ts';
import { problems } from '../problem.ts';

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

/** `/v1/jobs` (decision 0004). */
export function jobRoutes(app: FastifyInstance, jobs: Jobs): void {
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

    app.get('/jobs', { config: { scope: 'jobs:read' } }, async (request): Promise<JobList> => {
        const { project } = authOf(request);
        const query = request.query as Record<string, unknown>;
        const errors: Record<string, string[]> = {};

        const status =
            typeof query['status'] === 'string'
                ? query['status'].split(',').filter((value) => value !== '')
                : [];
        if (status.some((value) => !JOB_STATUSES.includes(value as JobStatus))) {
            errors['?status'] = [`must be some of ${JOB_STATUSES.join(', ')}`];
        }

        let createdAfter: Date | undefined;
        if (query['createdAfter'] !== undefined) {
            createdAfter = new Date(String(query['createdAfter']));
            if (Number.isNaN(createdAfter.getTime())) {
                errors['?createdAfter'] = ['must be a date-time'];
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

        return jobs.list(project.id, {
            ...page(query, 'job'),
            ...(status.length === 0 ? {} : { status: status as JobStatus[] }),
            ...(createdAfter === undefined ? {} : { createdAfter }),
            metadata,
        });
    });

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
