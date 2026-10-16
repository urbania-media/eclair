import type { ValidateFunction } from 'ajv/dist/2020.js';

import { isCapability } from '@eclair-js/operation';
import type { Operation, OperationPlugin } from '@eclair-js/operation';
import type { Operation as OperationResponse, TaskRequest } from '@eclair-js/protocol';

import type { ProjectSettings } from '../projects/settings.ts';
import { InvalidValueError, createAjv, groupErrors } from '../validation.ts';

/** The packages of built-in operations. The server loads them by name, like any plugin (rule 4). */
export const BUILT_IN_PLUGINS = [
    '@eclair-js/operations-core',
    '@eclair-js/operations-video',
    '@eclair-js/operations-audio',
    '@eclair-js/operations-document',
] as const;

/** A plugin can't be loaded, or exports an invalid operation. */
export class PluginError extends Error {
    constructor(plugin: string, message: string, options?: { cause?: unknown }) {
        super(`Plugin ${plugin}: ${message}`, options);
        this.name = 'PluginError';
    }
}

function operationsOf(plugin: string, module: unknown): readonly unknown[] {
    const exported = (module as { default?: unknown }).default ?? module;
    if (Array.isArray(exported)) {
        return exported;
    }
    const { operations } = exported as Partial<Extract<OperationPlugin, { operations: unknown }>>;
    if (Array.isArray(operations)) {
        return operations;
    }
    throw new PluginError(
        plugin,
        'its default export must be a list of operations, or { operations }.',
    );
}

function isOperation(value: unknown): value is Operation {
    const candidate = value as Partial<Operation> | null;
    return (
        typeof candidate === 'object' &&
        candidate !== null &&
        typeof candidate.key === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.run === 'function'
    );
}

/** Splits `video.hls@2` into a name and a version. */
function parseOperationName(value: string): { name: string; version: number | undefined } {
    const [name = '', version] = value.split('@');
    return { name, version: version === undefined ? undefined : Number(version) };
}

/**
 * The operations this server provides: the built-in packages and `ECLAIR_PLUGINS`. Validates
 * options with Ajv and their schema's defaults (decision 0015).
 */
export class OperationRegistry {
    readonly #operations = new Map<string, Operation>();
    readonly #latest = new Map<string, Operation>();
    readonly #validators = new Map<string, ValidateFunction>();

    constructor(operations: readonly Operation[]) {
        const ajv = createAjv();
        for (const operation of operations) {
            if (this.#operations.has(operation.key)) {
                throw new Error(`Two plugins provide ${operation.key}.`);
            }
            if (!isCapability(operation.capability)) {
                throw new Error(
                    `${operation.key}: "${String(operation.capability)}" is not a capability.`,
                );
            }
            try {
                this.#validators.set(operation.key, ajv.compile(operation.options));
            } catch (error) {
                throw new Error(`${operation.key}: its options schema is invalid.`, {
                    cause: error,
                });
            }
            this.#operations.set(operation.key, operation);
            const latest = this.#latest.get(operation.name);
            if (latest === undefined || latest.version < operation.version) {
                this.#latest.set(operation.name, operation);
            }
        }
    }

    /**
     * Loads the operations of plugin packages, by package name. `importModule` is `import()`,
     * replaceable in tests.
     */
    static async load(
        plugins: readonly string[],
        importModule: (name: string) => Promise<unknown> = (name) => import(name),
    ): Promise<OperationRegistry> {
        const operations: Operation[] = [];
        for (const plugin of new Set(plugins)) {
            let module: unknown;
            try {
                module = await importModule(plugin);
            } catch (error) {
                throw new PluginError(plugin, "can't be loaded. Is it installed?", {
                    cause: error,
                });
            }
            for (const operation of operationsOf(plugin, module)) {
                if (!isOperation(operation)) {
                    throw new PluginError(
                        plugin,
                        'exports something that defineOperation() did not create.',
                    );
                }
                operations.push(operation);
            }
        }
        try {
            return new OperationRegistry(operations);
        } catch (error) {
            throw new PluginError(plugins.join(', '), (error as Error).message, { cause: error });
        }
    }

    /** Finds an operation by name (the latest version) or by `name@version`. */
    resolve(value: string): Operation | undefined {
        const { name, version } = parseOperationName(value);
        return version === undefined
            ? this.#latest.get(name)
            : this.#operations.get(`${name}@${version}`);
    }

    /** Every operation, every version, sorted by name and version. */
    list(): Operation[] {
        return [...this.#operations.values()].sort((a, b) =>
            a.name === b.name ? a.version - b.version : a.name.localeCompare(b.name),
        );
    }

    /** Validates options and returns a copy with the schema's defaults. Throws an `InvalidValueError`. */
    validateOptions(operation: Operation, options: unknown, pointer = ''): Record<string, unknown> {
        const validate = this.#validators.get(operation.key);
        if (validate === undefined) {
            throw new Error(`${operation.key} isn't registered.`);
        }
        const copy = structuredClone(options ?? {});
        if (!validate(copy)) {
            throw new InvalidValueError(
                groupErrors(validate.errors ?? [], pointer),
                `The options of ${operation.key} are invalid.`,
            );
        }
        return copy as Record<string, unknown>;
    }

    /**
     * Checks tasks for a project: each operation exists, the project may use it, and its options are
     * valid. Reports every problem at once, by JSON pointer.
     */
    checkTasks(
        tasks: Record<string, TaskRequest>,
        pointer: string,
        settings: ProjectSettings | undefined,
    ): void {
        const errors: Record<string, string[]> = {};
        for (const [name, task] of Object.entries(tasks)) {
            const base = `${pointer}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
            const operation = this.resolve(task.op);
            if (operation === undefined) {
                errors[`${base}/op`] = [`"${task.op}" is not an operation of this server`];
                continue;
            }
            if (
                settings?.operations !== undefined &&
                !settings.operations.includes(operation.name)
            ) {
                errors[`${base}/op`] = [`the project may not use ${operation.name}`];
                continue;
            }
            try {
                this.validateOptions(operation, task.options, `${base}/options`);
            } catch (error) {
                if (!(error instanceof InvalidValueError)) {
                    throw error;
                }
                Object.assign(errors, error.errors);
            }
        }
        if (Object.keys(errors).length > 0) {
            throw new InvalidValueError(errors, 'Some tasks are invalid.');
        }
    }

    /** The operations a project may use, as the protocol describes them. */
    describe(settings: ProjectSettings | undefined): OperationResponse[] {
        return this.list()
            .filter((operation) => settings?.operations?.includes(operation.name) ?? true)
            .map((operation) => ({
                name: operation.name,
                version: operation.version,
                description: operation.description,
                accepts: operation.accepts,
                capability: operation.capability,
                outputs: operation.outputs,
                // TypeBox marks its schemas with symbols, which JSON leaves out.
                options: JSON.parse(JSON.stringify(operation.options)) as Record<string, unknown>,
            }));
    }
}
