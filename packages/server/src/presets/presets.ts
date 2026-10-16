import type { Selectable } from 'kysely';

import { toProblemErrors, validate } from '@eclair-js/protocol';
import type { Preset, PresetRequest, TaskRequest } from '@eclair-js/protocol';

import type { Database } from '../database/connection.ts';
import { isUniqueViolation } from '../database/errors.ts';
import type { PresetsTable } from '../database/tables.ts';
import { readDate, readJson, toJson } from '../database/values.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { createId } from '../ids.ts';
import { InvalidValueError } from '../validation.ts';
import { BUILT_IN_PRESETS } from './built-in.ts';
import type { BuiltInPreset } from './built-in.ts';

/** The scope of the presets that every project can use. */
export const GLOBAL_SCOPE = 'global';

/**
 * Checks the tasks of a preset beyond the protocol's schema: operations, options, what the project
 * may use. `projectId` is `undefined` for a global preset. Throws an `InvalidValueError`.
 */
export type TaskChecker = (
    tasks: Record<string, TaskRequest>,
    pointer: string,
    projectId: string | undefined,
) => void | Promise<void>;

export interface StoredPreset extends Preset {
    /** `undefined` for a built-in preset. */
    id: string | undefined;
    projectId: string | undefined;
    updatedAt: Date;
    /** Whether it ships with Eclair rather than being stored in the database. */
    builtIn: boolean;
}

/** When the built-in presets of this version of Eclair were loaded. */
const LOADED_AT = new Date();

function toBuiltIn(name: string, preset: BuiltInPreset): StoredPreset {
    return {
        id: undefined,
        projectId: undefined,
        name,
        scope: 'global',
        version: preset.version,
        ...(preset.description === undefined ? {} : { description: preset.description }),
        tasks: structuredClone(preset.tasks),
        updatedAt: LOADED_AT,
        builtIn: true,
    };
}

/**
 * Tasks are stored as a list of `[name, task]` entries: MySQL sorts the keys of a JSON object, and
 * the order of a preset's tasks is the order of its job's tasks.
 */
function writeTasks(tasks: Record<string, TaskRequest>): string {
    return toJson(Object.entries(tasks));
}

function readTasks(value: unknown): Record<string, TaskRequest> {
    const stored = readJson<[string, TaskRequest][] | Record<string, TaskRequest>>(value);
    return Array.isArray(stored) ? Object.fromEntries(stored) : stored;
}

function toPreset(row: Selectable<PresetsTable>): StoredPreset {
    return {
        id: row.id,
        projectId: row.project_id ?? undefined,
        name: row.name,
        scope: row.scope === GLOBAL_SCOPE ? 'global' : 'project',
        version: row.version,
        ...(row.description === null ? {} : { description: row.description }),
        tasks: readTasks(row.tasks),
        updatedAt: readDate(row.updated_at),
        builtIn: false,
    };
}

/**
 * Presets: named pipelines, global or per project (decision 0004). Below the global presets of the
 * database come the built-in ones, which ship with Eclair: a global preset with the same name
 * replaces one.
 */
export class Presets {
    readonly #database: Database;
    #checkTasks: TaskChecker | undefined;
    readonly #builtIn: Record<string, BuiltInPreset>;

    constructor(
        database: Database,
        checkTasks?: TaskChecker,
        builtIn: Record<string, BuiltInPreset> = BUILT_IN_PRESETS,
    ) {
        this.#database = database;
        this.#checkTasks = checkTasks;
        this.#builtIn = builtIn;
    }

    #findBuiltIn(name: string): StoredPreset | undefined {
        const preset = Object.hasOwn(this.#builtIn, name) ? this.#builtIn[name] : undefined;
        return preset === undefined ? undefined : toBuiltIn(name, preset);
    }

    /** Sets the checker of operations and options, once the operations are loaded. */
    setTaskChecker(checkTasks: TaskChecker): void {
        this.#checkTasks = checkTasks;
    }

    /**
     * Creates or replaces a preset. `projectId` is `undefined` for a global preset. Each change
     * increases its version. Returns whether it was created.
     */
    async put(
        projectId: string | undefined,
        name: string,
        request: unknown,
    ): Promise<{ preset: StoredPreset; created: boolean }> {
        const nameResult = validate('PresetName', name);
        if (!nameResult.valid) {
            throw new InvalidValueError(
                { '': ['the preset name must be lowercase words separated by - and /'] },
                `"${name}" is not a valid preset name.`,
            );
        }
        const result = validate('PresetRequest', request);
        if (!result.valid) {
            throw new InvalidValueError(toProblemErrors(result.errors), 'The preset is invalid.');
        }
        const { description, tasks } = result.value as PresetRequest;
        await this.#checkTasks?.(tasks, '/tasks', projectId);

        const scope = projectId ?? GLOBAL_SCOPE;
        const now = new Date();
        const existing = await this.#database.kysely
            .selectFrom('presets')
            .select(['id', 'version'])
            .where('scope', '=', scope)
            .where('name', '=', name)
            .executeTakeFirst();

        if (existing === undefined) {
            try {
                await this.#database.kysely
                    .insertInto('presets')
                    .values({
                        id: createId('preset'),
                        scope,
                        project_id: projectId ?? null,
                        name,
                        description: description ?? null,
                        version: 1,
                        tasks: writeTasks(tasks),
                        created_at: now,
                        updated_at: now,
                    })
                    .execute();
            } catch (error) {
                if (isUniqueViolation(error)) {
                    throw new ConflictError(`The preset "${name}" was created at the same time.`);
                }
                throw error;
            }
        } else {
            await this.#database.kysely
                .updateTable('presets')
                .set({
                    description: description ?? null,
                    version: existing.version + 1,
                    tasks: writeTasks(tasks),
                    updated_at: now,
                })
                .where('id', '=', existing.id)
                .execute();
        }
        const preset = await this.#find(scope, name);
        if (preset === undefined) {
            throw new Error(`The preset "${name}" disappeared while it was saved.`);
        }
        return { preset, created: existing === undefined };
    }

    async #find(scope: string, name: string): Promise<StoredPreset | undefined> {
        const row = await this.#database.kysely
            .selectFrom('presets')
            .selectAll()
            .where('scope', '=', scope)
            .where('name', '=', name)
            .executeTakeFirst();
        return row === undefined ? undefined : toPreset(row);
    }

    /** The preset a project sees under a name: its own, or else the global one, or a built-in one. */
    async find(projectId: string | undefined, name: string): Promise<StoredPreset | undefined> {
        if (projectId !== undefined) {
            const own = await this.#find(projectId, name);
            if (own !== undefined) {
                return own;
            }
        }
        return (await this.#find(GLOBAL_SCOPE, name)) ?? this.#findBuiltIn(name);
    }

    async get(projectId: string | undefined, name: string): Promise<StoredPreset> {
        const preset = await this.find(projectId, name);
        if (preset === undefined) {
            throw new NotFoundError(`There is no preset "${name}".`);
        }
        return preset;
    }

    /** The presets a project sees: its own, and the global and built-in ones it doesn't override. */
    async list(projectId: string | undefined): Promise<StoredPreset[]> {
        const scopes = projectId === undefined ? [GLOBAL_SCOPE] : [projectId, GLOBAL_SCOPE];
        const rows = await this.#database.kysely
            .selectFrom('presets')
            .selectAll()
            .where('scope', 'in', scopes)
            .orderBy('name')
            .execute();
        // A project's preset replaces a global one, which replaces a built-in one.
        const rank = (preset: StoredPreset) =>
            preset.scope === 'project' ? 2 : preset.builtIn ? 0 : 1;
        const presets = new Map<string, StoredPreset>();
        const builtIn = Object.entries(this.#builtIn).map(([name, preset]) =>
            toBuiltIn(name, preset),
        );
        for (const preset of [...builtIn, ...rows.map(toPreset)]) {
            const current = presets.get(preset.name);
            if (current === undefined || rank(preset) > rank(current)) {
                presets.set(preset.name, preset);
            }
        }
        return [...presets.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    }

    /** Deletes a preset of a project, or a global preset when `projectId` is `undefined`. */
    async delete(projectId: string | undefined, name: string): Promise<void> {
        const result = await this.#database.kysely
            .deleteFrom('presets')
            .where('scope', '=', projectId ?? GLOBAL_SCOPE)
            .where('name', '=', name)
            .executeTakeFirst();
        if (result.numDeletedRows === 0n) {
            throw new NotFoundError(
                projectId === undefined && this.#findBuiltIn(name) !== undefined
                    ? `"${name}" is built in: it can't be removed, only replaced by a global preset.`
                    : `There is no preset "${name}".`,
            );
        }
    }
}
