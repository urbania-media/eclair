import type {
    Job,
    JobFile,
    JobFileList,
    JobList,
    JobRequest,
    JobStatus,
    OutputFile,
    Task,
} from '@eclair-js/protocol';

import { sha256 } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import { isUniqueViolation } from '../database/errors.ts';
import { jsonText } from '../database/json.ts';
import { toJson } from '../database/values.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { createId, isId } from '../ids.ts';
import { BlockedUrlError, checkUrl } from '../net/ssrf.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { Presets } from '../presets/presets.ts';
import type { Project } from '../projects/projects.ts';
import { StorageError, checkStoragePath } from '../storages/drivers/types.ts';
import { TEMPORARY_STORAGE } from '../storages/storages.ts';
import type { Storages } from '../storages/storages.ts';
import type { Uploads } from '../uploads/uploads.ts';
import { InvalidValueError } from '../validation.ts';
import { mergeTasks, resolvePipeline } from './pipeline.ts';
import type { ResolvedTask } from './pipeline.ts';
import { toJobRecord, toOutputRecord, toTaskRecord } from './records.ts';
import type { JobRecord, OutputRecord, StoredDependencies, TaskRecord } from './records.ts';
import type { Scheduler } from './scheduler.ts';

export interface JobsOptions {
    database: Database;
    presets: Presets;
    storages: Storages;
    uploads: Uploads;
    operations: OperationRegistry;
    scheduler: Scheduler;
}

export interface JobFilters {
    status?: JobStatus[];
    createdAfter?: Date;
    metadata?: Record<string, string>;
    cursor?: string;
    limit: number;
}

/** A value with its object keys sorted, so that equal requests hash the same. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}

function iso(date: Date | undefined): string | undefined {
    return date?.toISOString();
}

export function toOutputFile(output: OutputRecord): OutputFile {
    return {
        name: output.name,
        path: output.path ?? '',
        mime: output.mime ?? 'application/octet-stream',
        size: output.size ?? 0,
        ...(output.checksum === undefined ? {} : { checksum: output.checksum }),
        ...(output.role === undefined ? {} : { role: output.role }),
        ...(output.count === undefined ? {} : { count: output.count }),
        ...(output.expiresAt === undefined ? {} : { expiresAt: output.expiresAt.toISOString() }),
        ...(output.expired ? { expired: true } : {}),
    };
}

function toTask(task: TaskRecord, outputs: OutputRecord[]): Task {
    const metadata = outputs.find(({ kind }) => kind === 'metadata')?.data;
    const files = outputs.filter(({ kind }) => kind === 'file').map(toOutputFile);
    return {
        status: task.status,
        op: task.operation,
        ...(task.from === undefined ? {} : { from: task.from }),
        ...(task.after.length === 0 ? {} : { after: task.after }),
        ...(task.progress === undefined || task.status !== 'running'
            ? {}
            : { progress: task.progress }),
        attempts: task.attempts,
        ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt.toISOString() }),
        ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt.toISOString() }),
        ...(metadata === undefined && files.length === 0
            ? {}
            : {
                  outputs: {
                      ...(metadata === undefined ? {} : { metadata }),
                      ...(files.length === 0 ? {} : { files }),
                  },
              }),
        ...(task.error === undefined ? {} : { error: task.error }),
    };
}

/** A job as the protocol shows it, with its tasks and their outputs. */
export function toJob(job: JobRecord, tasks: TaskRecord[], outputs: OutputRecord[]): Job {
    return {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        ...(job.startedAt === undefined ? {} : { startedAt: iso(job.startedAt) }),
        ...(job.endedAt === undefined ? {} : { endedAt: iso(job.endedAt) }),
        input: job.input,
        ...(job.output === undefined ? {} : { output: job.output }),
        ...(job.preset === undefined ? {} : { preset: job.preset }),
        priority: job.priority,
        failFast: job.failFast,
        metadata: job.metadata,
        tasks: Object.fromEntries(
            tasks.map((task) => [
                task.name,
                toTask(
                    task,
                    outputs.filter(({ taskId }) => taskId === task.id),
                ),
            ]),
        ),
    };
}

/** Jobs: what projects ask Eclair to do (decision 0004). */
export class Jobs {
    readonly #database: Database;
    readonly #presets: Presets;
    readonly #storages: Storages;
    readonly #uploads: Uploads;
    readonly #operations: OperationRegistry;
    readonly #scheduler: Scheduler;

    constructor(options: JobsOptions) {
        this.#database = options.database;
        this.#presets = options.presets;
        this.#storages = options.storages;
        this.#uploads = options.uploads;
        this.#operations = options.operations;
        this.#scheduler = options.scheduler;
    }

    /** Checks the input and output target of a job. Adds errors by JSON pointer. */
    async #checkTargets(
        project: Project,
        request: JobRequest,
        tasks: ResolvedTask[],
        errors: Record<string, string[]>,
    ): Promise<void> {
        const fail = (pointer: string, message: string) => (errors[pointer] ??= []).push(message);
        const { input, output } = request;

        if ('url' in input) {
            try {
                checkUrl(new URL(input.url), { allowedHosts: project.settings.inputHosts });
            } catch (error) {
                if (!(error instanceof BlockedUrlError)) {
                    throw error;
                }
                fail('/input/url', error.message);
            }
        } else if ('upload' in input) {
            const upload = await this.#uploads.find(project.id, input.upload);
            if (upload === undefined) {
                fail('/input/upload', `there is no upload "${input.upload}"`);
            } else if (upload.completedAt === undefined) {
                fail('/input/upload', 'the upload is not complete');
            }
        } else {
            if (
                input.storage !== TEMPORARY_STORAGE &&
                !(await this.#storages.has(project.id, input.storage))
            ) {
                fail('/input/storage', `the project has no storage "${input.storage}"`);
            }
            try {
                checkStoragePath(input.path);
            } catch (error) {
                if (!(error instanceof StorageError)) {
                    throw error;
                }
                fail('/input/path', error.message);
            }
        }

        const writers = tasks.filter(({ operation, keep }) => operation.outputs.files && keep);
        if (output === undefined) {
            if (writers.length > 0) {
                fail(
                    '/output',
                    `is required: ${writers.map(({ name }) => name).join(', ')} write files`,
                );
            }
            return;
        }
        if (
            output.storage !== TEMPORARY_STORAGE &&
            !(await this.#storages.has(project.id, output.storage))
        ) {
            fail('/output/storage', `the project has no storage "${output.storage}"`);
        }
        const pattern = output.path ?? '{task}/{file}';
        if (!pattern.includes('{file}')) {
            fail(
                '/output/path',
                'must contain {file}, or the files of a task would overwrite each other',
            );
        }
        try {
            checkStoragePath(
                `${output.prefix ?? ''}${pattern.replaceAll('{task}', 'task').replaceAll('{file}', 'file')}`,
            );
        } catch (error) {
            if (!(error instanceof StorageError)) {
                throw error;
            }
            fail(
                output.prefix === undefined || output.prefix === ''
                    ? '/output/path'
                    : '/output/prefix',
                error.message,
            );
        }
    }

    /**
     * Creates a job. With an `Idempotency-Key`, a replay of the same request returns the first job
     * (`created: false`), and another request with the same key is a `ConflictError`.
     */
    async create(
        project: Project,
        request: JobRequest,
        idempotencyKey?: string,
    ): Promise<{ job: Job; created: boolean }> {
        const requestHash = sha256(JSON.stringify(canonical(request)));
        if (idempotencyKey !== undefined) {
            const replay = await this.#findByIdempotencyKey(
                project.id,
                idempotencyKey,
                requestHash,
            );
            if (replay !== undefined) {
                return { job: replay, created: false };
            }
        }

        const preset =
            request.preset === undefined
                ? undefined
                : await this.#presets.find(project.id, request.preset);
        const errors: Record<string, string[]> = {};
        if (request.preset !== undefined && preset === undefined) {
            errors['/preset'] = [`there is no preset "${request.preset}"`];
        }
        const merged = mergeTasks(preset?.tasks, request.tasks);
        let tasks: ResolvedTask[] = [];
        if (Object.keys(merged).length === 0) {
            errors['/tasks'] = ['the job has no task'];
        } else {
            try {
                tasks = resolvePipeline(merged, this.#operations, project.settings);
            } catch (error) {
                if (!(error instanceof InvalidValueError)) {
                    throw error;
                }
                Object.assign(errors, error.errors);
            }
        }
        await this.#checkTargets(project, request, tasks, errors);
        if (Object.keys(errors).length > 0) {
            throw new InvalidValueError(errors, 'The job is invalid.');
        }

        const id = createId('job');
        const now = new Date();
        try {
            await this.#database.kysely.transaction().execute(async (transaction) => {
                await transaction
                    .insertInto('jobs')
                    .values({
                        id,
                        project_id: project.id,
                        status: 'pending',
                        priority: request.priority ?? 'normal',
                        input: toJson(request.input),
                        output: request.output === undefined ? null : toJson(request.output),
                        preset: preset?.name ?? null,
                        preset_version: preset?.version ?? null,
                        webhook_url: request.webhook ?? project.webhookUrl ?? null,
                        metadata: toJson(request.metadata ?? {}),
                        fail_fast: request.failFast ?? false,
                        idempotency_key: idempotencyKey ?? null,
                        request_hash: requestHash,
                        created_at: now,
                        updated_at: now,
                    })
                    .execute();
                await transaction
                    .insertInto('tasks')
                    .values(
                        tasks.map((task) => ({
                            id: createId('task'),
                            job_id: id,
                            project_id: project.id,
                            name: task.name,
                            operation: task.operation.name,
                            operation_version: task.operation.version,
                            queue: task.operation.capability,
                            options: toJson(task.options),
                            source:
                                task.source === undefined
                                    ? null
                                    : task.source.file === undefined
                                      ? task.source.task
                                      : `${task.source.task}:${task.source.file}`,
                            dependencies: toJson({
                                all: task.dependencies,
                                after: task.after,
                            } satisfies StoredDependencies),
                            condition: task.condition === undefined ? null : toJson(task.condition),
                            keep: task.keep,
                            status: 'pending',
                            attempts: 0,
                            created_at: now,
                            updated_at: now,
                        })),
                    )
                    .execute();
            });
        } catch (error) {
            // Two requests with the same key at once: the other one created the job.
            if (idempotencyKey !== undefined && isUniqueViolation(error)) {
                const replay = await this.#findByIdempotencyKey(
                    project.id,
                    idempotencyKey,
                    requestHash,
                );
                if (replay !== undefined) {
                    return { job: replay, created: false };
                }
            }
            throw error;
        }

        await this.#scheduler.advance(id);
        return { job: await this.get(project.id, id), created: true };
    }

    async #findByIdempotencyKey(
        projectId: string,
        key: string,
        requestHash: string,
    ): Promise<Job | undefined> {
        const row = await this.#database.kysely
            .selectFrom('jobs')
            .select(['id', 'request_hash'])
            .where('project_id', '=', projectId)
            .where('idempotency_key', '=', key)
            .executeTakeFirst();
        if (row === undefined) {
            return undefined;
        }
        if (row.request_hash !== requestHash) {
            throw new ConflictError('The Idempotency-Key was used with another request.');
        }
        return this.get(projectId, row.id);
    }

    async #record(projectId: string, id: string): Promise<JobRecord> {
        const row = isId('job', id)
            ? await this.#database.kysely
                  .selectFrom('jobs')
                  .selectAll()
                  .where('project_id', '=', projectId)
                  .where('id', '=', id)
                  .executeTakeFirst()
            : undefined;
        if (row === undefined) {
            throw new NotFoundError(`There is no job "${id}".`);
        }
        return toJobRecord(row);
    }

    async #responses(records: JobRecord[]): Promise<Job[]> {
        if (records.length === 0) {
            return [];
        }
        const ids = records.map(({ id }) => id);
        const [tasks, outputs] = await Promise.all([
            this.#database.kysely
                .selectFrom('tasks')
                .selectAll()
                .where('job_id', 'in', ids)
                .orderBy('id')
                .execute(),
            this.#database.kysely
                .selectFrom('outputs')
                .selectAll()
                .where('job_id', 'in', ids)
                .orderBy('id')
                .execute(),
        ]);
        const taskRecords = tasks.map(toTaskRecord);
        const outputRecords = outputs.map(toOutputRecord);
        return records.map((job) =>
            toJob(
                job,
                taskRecords.filter(({ jobId }) => jobId === job.id),
                outputRecords.filter(({ jobId }) => jobId === job.id),
            ),
        );
    }

    async get(projectId: string, id: string): Promise<Job> {
        const [job] = await this.#responses([await this.#record(projectId, id)]);
        if (job === undefined) {
            throw new NotFoundError(`There is no job "${id}".`);
        }
        return job;
    }

    /** The project's jobs, newest first, a page at a time. */
    async list(projectId: string, filters: JobFilters): Promise<JobList> {
        let query = this.#database.kysely
            .selectFrom('jobs')
            .selectAll()
            .where('project_id', '=', projectId)
            .orderBy('id', 'desc')
            .limit(filters.limit + 1);
        if (filters.status !== undefined && filters.status.length > 0) {
            query = query.where('status', 'in', filters.status);
        }
        if (filters.createdAfter !== undefined) {
            query = query.where('created_at', '>', filters.createdAfter);
        }
        if (filters.cursor !== undefined) {
            query = query.where('id', '<', filters.cursor);
        }
        for (const [key, value] of Object.entries(filters.metadata ?? {})) {
            query = query.where(jsonText(this.#database.dialect, 'metadata', key), '=', value);
        }
        const rows = await query.execute();
        const page = rows.slice(0, filters.limit).map(toJobRecord);
        return {
            data: await this.#responses(page),
            nextCursor: rows.length > filters.limit ? (page.at(-1)?.id ?? null) : null,
        };
    }

    /** The files of a job, a page at a time, segments included. */
    async files(
        projectId: string,
        id: string,
        filters: { task?: string; cursor?: string; limit: number },
    ): Promise<JobFileList> {
        const job = await this.#record(projectId, id);
        let query = this.#database.kysely
            .selectFrom('outputs')
            .innerJoin('tasks', 'tasks.id', 'outputs.task_id')
            .selectAll('outputs')
            .select('tasks.name as task_name')
            .where('outputs.job_id', '=', job.id)
            .where('outputs.kind', '=', 'file')
            .orderBy('outputs.id')
            .limit(filters.limit + 1);
        if (filters.task !== undefined) {
            query = query.where('tasks.name', '=', filters.task);
        }
        if (filters.cursor !== undefined) {
            query = query.where('outputs.id', '>', filters.cursor);
        }
        const rows = await query.execute();
        const page = rows.slice(0, filters.limit);
        return {
            data: page.map((row): JobFile => ({
                ...toOutputFile(toOutputRecord(row)),
                task: row.task_name,
            })),
            nextCursor: rows.length > filters.limit ? (page.at(-1)?.id ?? null) : null,
        };
    }

    /** Cancels a job. A job that already ended is returned as it is. */
    async cancel(projectId: string, id: string): Promise<Job> {
        const job = await this.#record(projectId, id);
        await this.#scheduler.cancel(job.id);
        return this.get(projectId, job.id);
    }

    /** Runs the failed and canceled tasks of a job again. */
    async retry(projectId: string, id: string): Promise<Job> {
        const job = await this.#record(projectId, id);
        if (!(await this.#scheduler.retry(job.id))) {
            throw new ConflictError(
                `The job is ${job.status}: only a failed or canceled job can be retried.`,
            );
        }
        return this.get(projectId, job.id);
    }
}
