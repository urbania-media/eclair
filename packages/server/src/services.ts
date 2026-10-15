import type { Redis } from 'ioredis';

import type { Database } from './database/connection.ts';
import { FileLinks } from './files/links.ts';
import { JobEvents } from './jobs/events.ts';
import { Jobs } from './jobs/jobs.ts';
import type { TaskQueues } from './jobs/queues.ts';
import { Scheduler } from './jobs/scheduler.ts';
import type { GuardOptions } from './net/ssrf.ts';
import type { OperationRegistry } from './operations/registry.ts';
import { Presets } from './presets/presets.ts';
import { Probes } from './probes/probes.ts';
import { ApiKeys } from './projects/api-keys.ts';
import { Projects } from './projects/projects.ts';
import { StorageResolver } from './storages/resolver.ts';
import { Storages } from './storages/storages.ts';
import type { TemporaryStorage } from './storages/temporary.ts';
import { Uploads } from './uploads/uploads.ts';
import type { UploadLimits } from './uploads/uploads.ts';
import { Webhooks } from './webhooks/webhooks.ts';
import type { RunnerLogger } from './workers/runner.ts';

/** Server-wide limits that the repositories apply, from the configuration. */
export interface ServerLimits extends UploadLimits {
    /** Largest input, in bytes, when the project doesn't set one. */
    maxInputSize: number;
    /** Directory for files received by the API before they are stored. */
    tmpDir: string;
}

/** The repositories of the server, sharing one database connection. */
export interface Services {
    database: Database;
    projects: Projects;
    apiKeys: ApiKeys;
    storages: Storages;
    presets: Presets;
    uploads: Uploads;
    resolver: StorageResolver;
    links: FileLinks;
    limits: ServerLimits;
    operations: OperationRegistry | undefined;
    /** With the operations, the queues and Redis: the API and the workers. */
    scheduler: Scheduler | undefined;
    jobs: Jobs | undefined;
    events: JobEvents | undefined;
    webhooks: Webhooks | undefined;
    probes: Probes | undefined;
}

export interface ServicesOptions {
    database: Database;
    secretKey: Buffer;
    temporary: TemporaryStorage;
    limits: ServerLimits;
    /** `ECLAIR_PUBLIC_URL`, for the download links of a local temporary storage. */
    publicUrl?: string | undefined;
    /**
     * With the operations, presets check their operations and options; without them (CLI commands
     * that don't need them), presets only check the protocol's schema.
     */
    operations?: OperationRegistry | undefined;
    /** The task queues. With Redis and the operations, there are jobs; without (CLI), there aren't. */
    queues?: TaskQueues | undefined;
    redis?: Redis | undefined;
    logger?: RunnerLogger | undefined;
    /** Only for tests, to send webhooks to a local receiver. */
    guard?: Pick<GuardOptions, 'allowHttp' | 'allowPrivateAddresses'>;
    /** Only for tests: the backoff between webhook attempts. */
    webhookBackoff?: (attemptsMade: number) => number;
}

const SILENT: RunnerLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export function createServices(options: ServicesOptions): Services {
    const { database, secretKey, temporary, limits, operations, queues, redis } = options;
    const projects = new Projects(database, secretKey);
    const storages = new Storages(database, projects, secretKey);
    const presets = new Presets(database);
    if (operations !== undefined) {
        presets.setTaskChecker(async (tasks, pointer, projectId) => {
            const settings =
                projectId === undefined ? undefined : (await projects.get(projectId)).settings;
            operations.checkTasks(tasks, pointer, settings);
        });
    }
    const uploads = new Uploads(database, temporary, limits);
    const links = new FileLinks(temporary, secretKey, options.publicUrl);
    const services: Services = {
        database,
        projects,
        apiKeys: new ApiKeys(database, projects),
        storages,
        presets,
        uploads,
        resolver: new StorageResolver(storages, projects, temporary),
        links,
        limits,
        operations,
        scheduler: undefined,
        jobs: undefined,
        events: undefined,
        webhooks: undefined,
        probes: undefined,
    };
    if (queues === undefined || redis === undefined || operations === undefined) {
        return services;
    }

    const scheduler = new Scheduler(database, queues, projects);
    const events = new JobEvents(redis);
    scheduler.setEvents(events);
    const jobs = new Jobs({ database, presets, storages, uploads, operations, scheduler, links });
    const webhooks = new Webhooks({
        database,
        projects,
        connection: redis,
        logger: options.logger ?? SILENT,
        ...(options.guard === undefined ? {} : { guard: options.guard }),
        ...(options.webhookBackoff === undefined ? {} : { backoff: options.webhookBackoff }),
    });
    webhooks.setJobs(jobs);
    scheduler.onJobEnded((job) => webhooks.send(job, `job.${job.status}` as 'job.completed'));
    return {
        ...services,
        scheduler,
        jobs,
        events,
        webhooks,
        probes: new Probes(jobs, events, redis),
    };
}
