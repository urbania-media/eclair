import type { Database } from './database/connection.ts';
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
}

export function createServices(database: Database, secretKey: Buffer): Services {
    const projects = new Projects(database, secretKey);
    return {
        database,
        projects,
        apiKeys: new ApiKeys(database, projects),
        storages: new Storages(database, projects, secretKey),
        presets: new Presets(database),
    };
}
