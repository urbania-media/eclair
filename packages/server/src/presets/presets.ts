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
    id: string;
    projectId: string | undefined;
    updatedAt: Date;
}

function toPreset(row: Selectable<PresetsTable>): StoredPreset {
    return {
        id: row.id,
        projectId: row.project_id ?? undefined,
        name: row.name,
        scope: row.scope === GLOBAL_SCOPE ? 'global' : 'project',
        version: row.version,
        ...(row.description === null ? {} : { description: row.description }),
        tasks: readJson<Record<string, TaskRequest>>(row.tasks),
        updatedAt: readDate(row.updated_at),
    };
}

/** Presets: named pipelines, global or per project (decision 0004). */
export class Presets {
    readonly #database: Database;
    #checkTasks: TaskChecker | undefined;

    constructor(database: Database, checkTasks?: TaskChecker) {
        this.#database = database;
        this.#checkTasks = checkTasks;
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
                        tasks: toJson(tasks),
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
                    tasks: toJson(tasks),
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

    /** The preset a project sees under a name: its own, or else the global one. */
    async find(projectId: string | undefined, name: string): Promise<StoredPreset | undefined> {
        if (projectId !== undefined) {
            const own = await this.#find(projectId, name);
            if (own !== undefined) {
                return own;
            }
        }
        return this.#find(GLOBAL_SCOPE, name);
    }

    async get(projectId: string | undefined, name: string): Promise<StoredPreset> {
        const preset = await this.find(projectId, name);
        if (preset === undefined) {
            throw new NotFoundError(`There is no preset "${name}".`);
        }
        return preset;
    }

    /** The presets a project sees: its own, and the global ones it doesn't override. */
    async list(projectId: string | undefined): Promise<StoredPreset[]> {
        const scopes = projectId === undefined ? [GLOBAL_SCOPE] : [projectId, GLOBAL_SCOPE];
        const rows = await this.#database.kysely
            .selectFrom('presets')
            .selectAll()
            .where('scope', 'in', scopes)
            .orderBy('name')
            .execute();
        const presets = new Map<string, StoredPreset>();
        for (const preset of rows.map(toPreset)) {
            const current = presets.get(preset.name);
            if (current === undefined || preset.scope === 'project') {
                presets.set(preset.name, preset);
            }
        }
        return [...presets.values()];
    }

    /** Deletes a preset of a project, or a global preset when `projectId` is `undefined`. */
    async delete(projectId: string | undefined, name: string): Promise<void> {
        const result = await this.#database.kysely
            .deleteFrom('presets')
            .where('scope', '=', projectId ?? GLOBAL_SCOPE)
            .where('name', '=', name)
            .executeTakeFirst();
        if (result.numDeletedRows === 0n) {
            throw new NotFoundError(`There is no preset "${name}".`);
        }
    }
}
