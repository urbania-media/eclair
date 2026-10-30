import type { FastifyInstance, FastifyRequest } from 'fastify';

import type * as protocol from '@eclair-js/protocol';

import type { Jobs } from '../../jobs/jobs.ts';
import type { Services } from '../../services.ts';
import { listDeliveries } from '../../webhooks/deliveries.ts';
import { jobFilters } from '../v1/jobs.ts';

function idOf(request: FastifyRequest): string {
    return (request.params as { id: string }).id;
}

/** `/admin/v1/jobs`: the jobs of every project, as `/v1` shows them, with their project. */
export function adminJobRoutes(app: FastifyInstance, services: Services, jobs: Jobs): void {
    const { projects, database } = services;

    /** The slugs of the projects, by id. */
    async function slugs(): Promise<Map<string, string>> {
        return new Map((await projects.list()).map(({ id, slug }) => [id, slug]));
    }

    async function withProject(projectId: string, job: protocol.Job): Promise<protocol.AdminJob> {
        return { ...job, project: (await projects.get(projectId)).slug };
    }

    app.get('/jobs', async (request): Promise<protocol.AdminJobList> => {
        const query = request.query as Record<string, unknown>;
        const filters = jobFilters(query, { admin: true });
        const project =
            typeof query['project'] === 'string' ? await projects.get(query['project']) : undefined;
        const [{ data, nextCursor }, bySlug] = await Promise.all([
            jobs.listAll({ ...filters, projectId: project?.id }),
            slugs(),
        ]);
        return {
            data: data.map(({ projectId, job }) => ({
                ...job,
                project: bySlug.get(projectId) ?? projectId,
            })),
            nextCursor,
        };
    });

    app.get('/jobs/:id', async (request): Promise<protocol.AdminJob> => {
        const projectId = await jobs.projectOf(idOf(request));
        return withProject(projectId, await jobs.get(projectId, idOf(request)));
    });

    app.post('/jobs/:id/cancel', async (request): Promise<protocol.AdminJob> => {
        const projectId = await jobs.projectOf(idOf(request));
        return withProject(projectId, await jobs.cancel(projectId, idOf(request)));
    });

    app.post('/jobs/:id/retry', async (request): Promise<protocol.AdminJob> => {
        const projectId = await jobs.projectOf(idOf(request));
        return withProject(projectId, await jobs.retry(projectId, idOf(request)));
    });

    app.get('/jobs/:id/deliveries', async (request): Promise<protocol.WebhookDeliveryList> => {
        await jobs.projectOf(idOf(request));
        return { data: await listDeliveries(database, idOf(request)) };
    });
}
