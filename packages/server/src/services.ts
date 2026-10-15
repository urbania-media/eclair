import type { Database } from './database/connection.ts';
import { Jobs } from './jobs/jobs.ts';
import type { TaskQueues } from './jobs/queues.ts';
import { Scheduler } from './jobs/scheduler.ts';
import type { OperationRegistry } from './operations/registry.ts';
import { Presets } from './presets/presets.ts';
import { ApiKeys } from './projects/api-keys.ts';
import { Projects } from './projects/projects.ts';
import { StorageResolver } from './storages/resolver.ts';
import { Storages } from './storages/storages.ts';
import type { TemporaryStorage } from './storages/temporary.ts';
import { Uploads } from './uploads/uploads.ts';
import type { UploadLimits } from './uploads/uploads.ts';

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
    limits: ServerLimits;
    operations: OperationRegistry | undefined;
    /** With the operations and the queues: the API and the workers. */
    scheduler: Scheduler | undefined;
    jobs: Jobs | undefined;
}

export interface ServicesOptions {
    database: Database;
    secretKey: Buffer;
    temporary: TemporaryStorage;
    limits: ServerLimits;
    /**
     * With the operations, presets check their operations and options; without them (CLI commands
     * that don't need them), presets only check the protocol's schema.
     */
    operations?: OperationRegistry | undefined;
    /** The task queues in Redis. Without them, there are no jobs (CLI commands). */
    queues?: TaskQueues | undefined;
}

export function createServices(options: ServicesOptions): Services {
    const { database, secretKey, temporary, limits, operations, queues } = options;
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
    const scheduler = queues === undefined ? undefined : new Scheduler(database, queues, projects);
    return {
        database,
        projects,
        apiKeys: new ApiKeys(database, projects),
        storages,
        presets,
        uploads,
        resolver: new StorageResolver(storages, projects, temporary),
        limits,
        operations,
        scheduler,
        jobs:
            scheduler === undefined || operations === undefined
                ? undefined
                : new Jobs({ database, presets, storages, uploads, operations, scheduler }),
    };
}
