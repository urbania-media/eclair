import type { Operation } from '@eclair-js/operation';
import type { TaskCondition, TaskRequest } from '@eclair-js/protocol';

import type { OperationRegistry } from '../operations/registry.ts';
import type { ProjectSettings } from '../projects/settings.ts';
import { InvalidValueError } from '../validation.ts';

/** A task of a job, resolved: its operation and version, options with their defaults, dependencies. */
export interface ResolvedTask {
    name: string;
    operation: Operation;
    options: Record<string, unknown>;
    /** The task whose output is this task's input, or `undefined` for the job's input. */
    source: { task: string; file: string | undefined } | undefined;
    /** Every task this one waits for: its source and `after`. */
    dependencies: string[];
    /** Only the `after` dependencies, as the client sent them. */
    after: string[];
    keep: boolean;
    condition: TaskCondition | undefined;
}

function escapeToken(token: string): string {
    return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Parses `from`: `h264`, or `h264:file` for one output file of that task. */
export function parseSource(from: string): { task: string; file: string | undefined } {
    const separator = from.indexOf(':');
    return separator === -1
        ? { task: from, file: undefined }
        : { task: from.slice(0, separator), file: from.slice(separator + 1) };
}

/**
 * Merges a preset's tasks with a job's tasks: a job task with the name of a preset task replaces it
 * (decision 0004).
 */
export function mergeTasks(
    presetTasks: Record<string, TaskRequest> | undefined,
    jobTasks: Record<string, TaskRequest> | undefined,
): Record<string, TaskRequest> {
    return { ...presetTasks, ...jobTasks };
}

/**
 * Resolves a job's tasks: checks every operation and its options for the project, then the graph
 * (`from` and `after` name tasks of the job, and there is no cycle). Throws an `InvalidValueError`
 * with every problem at once, by JSON pointer.
 */
export function resolvePipeline(
    tasks: Record<string, TaskRequest>,
    operations: OperationRegistry,
    settings: ProjectSettings,
): ResolvedTask[] {
    const errors: Record<string, string[]> = {};
    const fail = (pointer: string, message: string) => (errors[pointer] ??= []).push(message);

    // Operations, options and what the project may use, with the protocol's pointers.
    try {
        operations.checkTasks(tasks, '/tasks', settings);
    } catch (error) {
        if (!(error instanceof InvalidValueError)) {
            throw error;
        }
        Object.assign(errors, error.errors);
    }

    const names = new Set(Object.keys(tasks));
    const resolved: ResolvedTask[] = [];
    for (const [name, task] of Object.entries(tasks)) {
        const base = `/tasks/${escapeToken(name)}`;
        const source = task.from === undefined ? undefined : parseSource(task.from);
        if (source !== undefined) {
            if (source.task === name) {
                fail(`${base}/from`, 'a task cannot read its own output');
            } else if (!names.has(source.task)) {
                fail(`${base}/from`, `there is no task "${source.task}"`);
            } else {
                const producer = operations.resolve(tasks[source.task]?.op ?? '');
                if (producer !== undefined && !producer.outputs.files) {
                    fail(`${base}/from`, `${source.task} (${producer.key}) writes no file`);
                }
            }
        }
        const after = task.after ?? [];
        for (const dependency of after) {
            if (dependency === name) {
                fail(`${base}/after`, 'a task cannot wait for itself');
            } else if (!names.has(dependency)) {
                fail(`${base}/after`, `there is no task "${dependency}"`);
            }
        }

        const operation = operations.resolve(task.op);
        if (
            operation === undefined ||
            Object.keys(errors).some((pointer) => pointer.startsWith(`${base}/`))
        ) {
            continue;
        }
        resolved.push({
            name,
            operation,
            options: operations.validateOptions(operation, task.options),
            source,
            dependencies: [...new Set([...(source === undefined ? [] : [source.task]), ...after])],
            after,
            keep: task.keep ?? true,
            condition: task.when,
        });
    }

    if (Object.keys(errors).length === 0) {
        const cycle = findCycle(resolved);
        if (cycle !== undefined) {
            fail('/tasks', `the tasks wait for each other: ${cycle.join(' → ')}`);
        }
    }
    if (Object.keys(errors).length > 0) {
        throw new InvalidValueError(errors, 'The pipeline is invalid.');
    }
    return resolved;
}

/** A cycle in the dependencies, as a list of task names, or `undefined`. */
export function findCycle(
    tasks: readonly Pick<ResolvedTask, 'name' | 'dependencies'>[],
): string[] | undefined {
    const dependencies = new Map(tasks.map((task) => [task.name, task.dependencies]));
    const state = new Map<string, 'visiting' | 'done'>();
    const path: string[] = [];

    const visit = (name: string): string[] | undefined => {
        if (state.get(name) === 'done') {
            return undefined;
        }
        if (state.get(name) === 'visiting') {
            return [...path.slice(path.indexOf(name)), name];
        }
        state.set(name, 'visiting');
        path.push(name);
        for (const dependency of dependencies.get(name) ?? []) {
            const cycle = visit(dependency);
            if (cycle !== undefined) {
                return cycle;
            }
        }
        path.pop();
        state.set(name, 'done');
        return undefined;
    };

    for (const task of tasks) {
        const cycle = visit(task.name);
        if (cycle !== undefined) {
            return cycle;
        }
    }
    return undefined;
}
