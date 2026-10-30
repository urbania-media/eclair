import type { FastifyInstance, FastifyRequest } from 'fastify';

import { JSON_SCHEMA_ID } from '@eclair-js/protocol';
import type * as protocol from '@eclair-js/protocol';

import { safeEqual } from '../../crypto.ts';
import type { ApiKey } from '../../projects/api-keys.ts';
import type { Project, ProjectPatch, WebhookSecrets } from '../../projects/projects.ts';
import type { Services } from '../../services.ts';
import { MAX_PERIOD, computeStats } from '../../stats/stats.ts';
import type { StatsInterval } from '../../stats/stats.ts';
import { checkStorage } from '../../storages/check.ts';
import type { StorageSummary } from '../../storages/storages.ts';
import { usageReport } from '../../usage/usage.ts';
import { problems } from '../problem.ts';
import { adminJobRoutes } from './jobs.ts';
import { statusRoute } from './status.ts';
import type { StatusOptions } from './status.ts';

const schema = (name: string) => ({ $ref: `${JSON_SCHEMA_ID}#/$defs/${name}` });

function toProject(project: Project): protocol.AdminProject {
    return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        priority: project.priority,
        webhookUrl: project.webhookUrl ?? null,
        settings: project.settings,
        disabled: project.disabledAt !== undefined,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
    };
}

function toWebhookSecret(secrets: WebhookSecrets): protocol.WebhookSecret {
    return {
        webhookSecret: secrets.webhookSecret,
        ...(secrets.previousSecretExpiresAt === undefined
            ? {}
            : { previousSecretExpiresAt: secrets.previousSecretExpiresAt.toISOString() }),
    };
}

function toApiKey(key: ApiKey): protocol.ApiKey {
    return {
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revoked: key.revokedAt !== undefined,
    };
}

function toStorage(storage: StorageSummary): protocol.Storage {
    return {
        name: storage.name,
        kind: storage.kind,
        location: storage.location,
        createdAt: storage.createdAt.toISOString(),
        updatedAt: storage.updatedAt.toISOString(),
    };
}

function param(request: FastifyRequest, name: string): string {
    return (request.params as Record<string, string>)[name] ?? '';
}

/**
 * `/admin/v1`: what the CLI does, over HTTP, with the server's admin token (see the protocol). Without
 * `ECLAIR_ADMIN_TOKEN`, the admin API isn't there at all.
 */
export async function admin(
    app: FastifyInstance,
    options: { services: Services; adminToken: string } & StatusOptions,
): Promise<void> {
    const { services } = options;
    const { projects, apiKeys, storages, presets, database } = services;

    app.addHook('onRequest', async (request) => {
        const header = request.headers.authorization;
        const token = header === undefined ? undefined : /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
        if (token === undefined || !safeEqual(token, options.adminToken)) {
            const problem = problems.unauthorized(
                'Send the admin token: Authorization: Bearer <ECLAIR_ADMIN_TOKEN>.',
            );
            problem.headers['www-authenticate'] = 'Bearer realm="eclair-admin"';
            throw problem;
        }
    });

    app.get('/projects', async (): Promise<protocol.AdminProjectList> => ({
        data: (await projects.list()).map(toProject),
    }));

    app.post(
        '/projects',
        { schema: { body: schema('ProjectRequest') } },
        async (request, reply) => {
            const { project, webhookSecret } = await projects.create(
                request.body as protocol.ProjectRequest,
            );
            return reply.code(201).send({
                project: toProject(project),
                webhookSecret,
            } satisfies protocol.ProjectCreated);
        },
    );

    app.get('/projects/:project', async (request): Promise<protocol.AdminProject> =>
        toProject(await projects.get(param(request, 'project'))),
    );

    app.patch(
        '/projects/:project',
        { schema: { body: schema('ProjectPatch') } },
        async (request): Promise<protocol.AdminProject> =>
            toProject(
                await projects.update(param(request, 'project'), request.body as ProjectPatch),
            ),
    );

    app.delete('/projects/:project', async (request, reply) => {
        await projects.delete(param(request, 'project'));
        return reply.code(204).send();
    });

    app.get(
        '/projects/:project/webhook-secret',
        async (request): Promise<protocol.WebhookSecret> => {
            const project = await projects.get(param(request, 'project'));
            return toWebhookSecret(await projects.webhookSecrets(project.id));
        },
    );

    app.post(
        '/projects/:project/webhook-secret',
        {
            schema: { body: schema('WebhookSecretRotation') },
            // The body is optional: without one, the previous secret gets the default grace period.
            preValidation: async (request) => {
                request.body ??= {};
            },
        },
        async (request): Promise<protocol.WebhookSecret> => {
            const { grace } = request.body as protocol.WebhookSecretRotation;
            return toWebhookSecret(
                await projects.rotateWebhookSecret(
                    param(request, 'project'),
                    grace === undefined ? {} : { grace: grace * 1000 },
                ),
            );
        },
    );

    app.get('/projects/:project/keys', async (request): Promise<protocol.ApiKeyList> => ({
        data: (await apiKeys.list(param(request, 'project'))).map(toApiKey),
    }));

    app.post(
        '/projects/:project/keys',
        { schema: { body: schema('ApiKeyRequest') } },
        async (request, reply) => {
            const body = request.body as protocol.ApiKeyRequest;
            const { key, token } = await apiKeys.create(param(request, 'project'), body);
            return reply
                .code(201)
                .send({ key: toApiKey(key), token } satisfies protocol.ApiKeyCreated);
        },
    );

    app.post('/keys/:key/revoke', async (request): Promise<protocol.ApiKey> =>
        toApiKey(await apiKeys.revoke(param(request, 'key'))),
    );

    app.get('/projects/:project/storages', async (request): Promise<protocol.StorageList> => ({
        data: (await storages.list(param(request, 'project'))).map(toStorage),
    }));

    app.put(
        '/projects/:project/storages/:storage',
        { schema: { body: schema('StorageRequest') } },
        async (request): Promise<protocol.Storage> => {
            const { kind, config } = request.body as protocol.StorageRequest;
            return toStorage(
                await storages.set(
                    param(request, 'project'),
                    param(request, 'storage'),
                    kind,
                    config,
                ),
            );
        },
    );

    app.delete('/projects/:project/storages/:storage', async (request, reply) => {
        await storages.remove(param(request, 'project'), param(request, 'storage'));
        return reply.code(204).send();
    });

    app.get('/presets', async (): Promise<protocol.PresetList> => ({
        data: (await presets.list(undefined)).map(
            ({ name, scope, version, description, tasks }) => ({
                name,
                scope,
                version,
                ...(description === undefined ? {} : { description }),
                tasks,
            }),
        ),
    }));

    app.put('/presets/*', { schema: { body: schema('PresetRequest') } }, async (request, reply) => {
        const name = decodeURIComponent(param(request, '*'));
        const { preset, created } = await presets.put(undefined, name, request.body);
        const { scope, version, description, tasks } = preset;
        return reply.code(created ? 201 : 200).send({
            name,
            scope,
            version,
            ...(description === undefined ? {} : { description }),
            tasks,
        } satisfies protocol.Preset);
    });

    app.delete('/presets/*', async (request, reply) => {
        await presets.delete(undefined, decodeURIComponent(param(request, '*')));
        return reply.code(204).send();
    });

    app.get('/usage', async (request): Promise<protocol.UsageReport> => {
        const query = request.query as Record<string, unknown>;
        const days = query['days'] === undefined ? 30 : Number(query['days']);
        if (!Number.isInteger(days) || days < 1 || days > 3660) {
            throw problems.invalid(
                { '?days': ['must be an integer from 1 to 3660'] },
                'The query is invalid.',
            );
        }
        const project =
            typeof query['project'] === 'string' ? await projects.get(query['project']) : undefined;
        const lines = await usageReport(database, {
            since: new Date(Date.now() - days * 24 * 3_600_000),
            projectId: project?.id,
        });
        return { data: lines };
    });
    app.post(
        '/projects/:project/storages/:storage/check',
        async (request): Promise<protocol.StorageCheck> =>
            checkStorage(
                {
                    projects,
                    storages,
                    resolver: services.resolver,
                    tmpDir: services.limits.tmpDir,
                },
                param(request, 'project'),
                param(request, 'storage'),
            ),
    );

    if (services.jobs !== undefined) {
        adminJobRoutes(app, services, services.jobs);
    }

    statusRoute(app, services, options);

    app.get('/stats', async (request): Promise<protocol.Stats> => {
        const query = request.query as Record<string, unknown>;
        const errors: Record<string, string[]> = {};
        const date = (name: string, fallback: Date): Date => {
            if (query[name] === undefined) {
                return fallback;
            }
            const value = new Date(String(query[name]));
            if (Number.isNaN(value.getTime())) {
                errors[`?${name}`] = ['must be a date-time'];
                return fallback;
            }
            return value;
        };
        const interval = (query['interval'] ?? 'hour') as StatsInterval;
        if (interval !== 'hour' && interval !== 'day') {
            errors['?interval'] = ['must be hour or day'];
        }
        const until = date('until', new Date());
        const since = date('since', new Date(until.getTime() - 24 * 3_600_000));
        if (Object.keys(errors).length === 0) {
            if (since >= until) {
                errors['?since'] = ['must be before until'];
            } else if (until.getTime() - since.getTime() > MAX_PERIOD[interval]) {
                errors['?since'] = [
                    interval === 'hour'
                        ? 'must be at most 31 days before until, by hour'
                        : 'must be at most 366 days before until',
                ];
            }
        }
        if (Object.keys(errors).length > 0) {
            throw problems.invalid(errors, 'The query is invalid.');
        }
        const project =
            typeof query['project'] === 'string' ? await projects.get(query['project']) : undefined;
        return computeStats(database, { since, until, interval, projectId: project?.id });
    });
}
