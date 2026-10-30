import type { ResourceHandler } from '../adapter/adapter.ts';
import { createJobs } from './jobs.ts';
import { keys } from './keys.ts';
import { presets } from './presets.ts';
import { projects } from './projects.ts';
import { storages } from './storages.ts';

/** The resources of the definition, on the admin API. Each adapter has its own: jobs keep cursors. */
export function createResources(): Record<string, ResourceHandler> {
    return { projects, keys, storages, presets, jobs: createJobs() };
}
