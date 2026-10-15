import type { Database } from './database/connection.ts';
import type { OperationRegistry } from './operations/registry.ts';
import { Presets } from './presets/presets.ts';
import { ApiKeys } from './projects/api-keys.ts';
import { Projects } from './projects/projects.ts';
import { Storages } from './storages/storages.ts';

/** The repositories of the server, sharing one database connection. */
export interface Services {
    database: Database;
    projects: Projects;
    apiKeys: ApiKeys;
    storages: Storages;
    presets: Presets;
    operations: OperationRegistry | undefined;
}

/**
 * Creates the repositories. With the operations, presets check their operations and options;
 * without them (tests, CLI commands that don't need them), presets only check the protocol's schema.
 */
export function createServices(
    database: Database,
    secretKey: Buffer,
    operations?: OperationRegistry,
): Services {
    const projects = new Projects(database, secretKey);
    const presets = new Presets(database);
    if (operations !== undefined) {
        presets.setTaskChecker(async (tasks, pointer, projectId) => {
            const settings =
                projectId === undefined ? undefined : (await projects.get(projectId)).settings;
            operations.checkTasks(tasks, pointer, settings);
        });
    }
    return {
        database,
        projects,
        apiKeys: new ApiKeys(database, projects),
        storages: new Storages(database, projects, secretKey),
        presets,
        operations,
    };
}
