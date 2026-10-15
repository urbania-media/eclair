import type { Projects } from '../projects/projects.ts';
import { HttpDriver } from './drivers/http.ts';
import { S3Driver } from './drivers/s3.ts';
import type { StorageDriver } from './drivers/types.ts';
import { TEMPORARY_STORAGE } from './storages.ts';
import type { Storages } from './storages.ts';
import type { TemporaryStorage } from './temporary.ts';

/** Gives the driver of a project's storage by name, `eclair` being the temporary storage. */
export class StorageResolver {
    readonly #storages: Storages;
    readonly #projects: Projects;
    readonly #temporary: TemporaryStorage;
    /** S3 drivers by storage id and version, so a client is reused until the storage changes. */
    readonly #drivers = new Map<string, StorageDriver>();

    constructor(storages: Storages, projects: Projects, temporary: TemporaryStorage) {
        this.#storages = storages;
        this.#projects = projects;
        this.#temporary = temporary;
    }

    get temporary(): TemporaryStorage {
        return this.#temporary;
    }

    async driverFor(projectId: string, name: string): Promise<StorageDriver> {
        if (name === TEMPORARY_STORAGE) {
            return this.#temporary.forProject(projectId);
        }
        const storage = await this.#storages.get(projectId, name);
        if (storage.kind === 'http') {
            // Not cached: it signs with the project's secret, which can be rotated.
            return new HttpDriver(storage.config, await this.#projects.webhookSecret(projectId));
        }
        const key = `${storage.id}@${storage.updatedAt.getTime()}`;
        let driver = this.#drivers.get(key);
        if (driver === undefined) {
            driver = new S3Driver(storage.config);
            this.#drivers.set(key, driver);
        }
        return driver;
    }
}
