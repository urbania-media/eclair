import type { ResourceHandler } from '../adapter/adapter.ts';
import { keys } from './keys.ts';
import { presets } from './presets.ts';
import { projects } from './projects.ts';
import { storages } from './storages.ts';

/** The resources of the definition, on the admin API. */
export const resources: Record<string, ResourceHandler> = { projects, keys, storages, presets };
