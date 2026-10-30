import type { Insertable } from 'kysely';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
    OperationError,
    acceptsInput,
    detectType,
    execBinary,
    matchesMime,
} from '@eclair-js/operation';
import type { Operation, OperationContext, OutputOptions } from '@eclair-js/operation';
import type { ProbeMetadata, TaskCondition, TaskError } from '@eclair-js/protocol';

import type { Config } from '../config/config.ts';
import type { Database } from '../database/connection.ts';
import type { OutputsTable } from '../database/tables.ts';
import { toJson } from '../database/values.ts';
import { createId } from '../ids.ts';
import type { JobRecord, OutputRecord, TaskRecord } from '../jobs/records.ts';
import { toOutputRecord } from '../jobs/records.ts';
import type { Scheduler } from '../jobs/scheduler.ts';
import type { Metrics } from '../metrics.ts';
import type { GuardOptions } from '../net/ssrf.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { Project, Projects } from '../projects/projects.ts';
import { StorageError, checkStoragePath } from '../storages/drivers/types.ts';
import { fetchInput } from '../storages/inputs.ts';
import type { StorageResolver } from '../storages/resolver.ts';
import { TEMPORARY_STORAGE } from '../storages/storages.ts';
import type { Uploads } from '../uploads/uploads.ts';
import { ProgressThrottle } from '../webhooks/progress.ts';
import type { Webhooks } from '../webhooks/webhooks.ts';

/** What happened to a task. `retry`: it failed for a reason that may pass, and has attempts left. */
export type RunOutcome = 'completed' | 'failed' | 'skipped' | 'canceled' | 'ignored' | 'retry';

export interface RunnerLogger {
    debug(data: Record<string, unknown>, message: string): void;
    info(data: Record<string, unknown>, message: string): void;
    warn(data: Record<string, unknown>, message: string): void;
    error(data: Record<string, unknown>, message: string): void;
}

export interface TaskRunnerOptions {
    database: Database;
    scheduler: Scheduler;
    operations: OperationRegistry;
    projects: Projects;
    resolver: StorageResolver;
    uploads: Uploads;
    config: Pick<
        Config,
        | 'binaries'
        | 'tmpDir'
        | 'taskTimeout'
        | 'maxInputSize'
        | 'tempRetention'
        | 'tempMaxRetention'
    >;
    /** Name of this worker, recorded on the tasks it runs. */
    worker: string;
    logger: RunnerLogger;
    /** Only for tests, to read inputs from a local server. */
    guard?: Pick<GuardOptions, 'allowHttp' | 'allowPrivateAddresses'>;
    /**
     * Sends `task.completed` webhooks, for projects with `taskWebhooks`, and `task.progress`
     * webhooks, for projects with `progressWebhooks`.
     */
    webhooks?: Webhooks | undefined;
    metrics?: Metrics | undefined;
}

export interface RunOptions {
    /** Whether a failure that may pass can still be retried. */
    canRetry: boolean;
    /** Aborted when the task is canceled. */
    signal?: AbortSignal;
    /** Called with the progress, from 0 to 1, at most once a second. */
    onProgress?: (progress: number) => void;
}

/** A ThumbHash in base64, as `OutputFile.thumbhash` allows it. */
const THUMBHASH_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

interface DeclaredFile extends OutputOptions {
    name: string;
    path: string;
}

/** Errors that may pass if the task runs again: storage and the unexpected. */
function isRetryable(error: unknown): boolean {
    if (error instanceof OperationError) {
        return error.code === 'storage_failed';
    }
    if (error instanceof StorageError) {
        return error.code === 'storage_failed';
    }
    return true;
}

/** The error a task reports: the operation's own, or a safe message for anything else. */
function taskErrorOf(error: unknown, stage: 'input' | 'run' | 'output'): TaskError {
    if (error instanceof OperationError) {
        return { code: error.code, message: error.message };
    }
    if (error instanceof StorageError) {
        if (error.code === 'limit_exceeded') {
            return { code: 'limit_exceeded', message: error.message };
        }
        if (error.code === 'not_found' && stage === 'input') {
            return {
                code: 'input_unreadable',
                message: `The input can't be read: ${error.message}`,
            };
        }
        return { code: 'storage_failed', message: error.message };
    }
    return { code: 'operation_failed', message: 'The task failed unexpectedly.' };
}

/** Whether an input matches a task's condition. Durations come from the probe. */
function matchesCondition(
    condition: TaskCondition,
    input: { kind: string; mime: string },
    probe: ProbeMetadata | undefined,
): boolean {
    if (condition.kind !== undefined && !condition.kind.includes(input.kind as never)) {
        return false;
    }
    if (
        condition.mime !== undefined &&
        !condition.mime.some((pattern) => matchesMime(pattern, input.mime))
    ) {
        return false;
    }
    const duration = probe?.duration;
    if (
        condition.minDuration !== undefined &&
        (duration === undefined || duration < condition.minDuration)
    ) {
        return false;
    }
    if (
        condition.maxDuration !== undefined &&
        (duration === undefined || duration > condition.maxDuration)
    ) {
        return false;
    }
    return true;
}

async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
        hash.update(chunk);
        size += chunk.length;
    }
    return { sha256: hash.digest('hex'), size };
}

/** A file name within a task's outputs: no directory, no control character. */
function checkOutputName(name: string): string {
    if (
        name === '' ||
        name.length > 255 ||
        /[/\\]/.test(name) ||
        name === '.' ||
        name === '..' ||
        [...name].some((character) => character.charCodeAt(0) < 0x20)
    ) {
        throw new OperationError('operation_failed', `"${name}" is not a valid output name.`);
    }
    return name;
}

/**
 * Runs one task (decision 0006): reads its input, runs its operation, writes its outputs and moves
 * its job forward. It can run twice for the same task (a retry, a worker that crashed): outputs go
 * to the same paths and replace the previous ones.
 */
export class TaskRunner {
    readonly #options: TaskRunnerOptions;

    constructor(options: TaskRunnerOptions) {
        this.#options = options;
    }

    async #loadTask(taskId: string): Promise<TaskRecord | undefined> {
        const tasks = await this.#options.database.kysely
            .selectFrom('tasks')
            .select('job_id')
            .where('id', '=', taskId)
            .executeTakeFirst();
        if (tasks === undefined) {
            return undefined;
        }
        return (await this.#options.scheduler.loadTasks(tasks.job_id)).find(
            ({ id }) => id === taskId,
        );
    }

    async #outputsOf(taskIds: string[]): Promise<OutputRecord[]> {
        if (taskIds.length === 0) {
            return [];
        }
        const rows = await this.#options.database.kysely
            .selectFrom('outputs')
            .selectAll()
            .where('task_id', 'in', taskIds)
            .orderBy('id')
            .execute();
        return rows.map(toOutputRecord);
    }

    /** Ends a running task. Returns `false` when it isn't running here anymore (canceled meanwhile). */
    async #end(
        task: TaskRecord,
        status: 'completed' | 'failed' | 'skipped' | 'canceled',
        error?: TaskError,
    ): Promise<boolean> {
        const now = new Date();
        const result = await this.#options.database.kysely
            .updateTable('tasks')
            .set({
                status,
                error: error === undefined ? null : toJson(error),
                progress: status === 'completed' ? 1 : null,
                ended_at: now,
                updated_at: now,
            })
            .where('id', '=', task.id)
            .where('status', '=', 'running')
            .where('worker', '=', this.#options.worker)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            return false;
        }
        await this.#options.scheduler.emit({
            type: 'task.status',
            job: task.jobId,
            task: task.name,
            status,
        });
        return true;
    }

    /** Runs a task. Never throws for a failure of the task: it reports it and returns the outcome. */
    async run(taskId: string, options: RunOptions): Promise<RunOutcome> {
        const started = process.hrtime.bigint();
        let operation = 'unknown';
        const outcome = await this.#run(taskId, options, (key) => {
            operation = key;
        });
        if (outcome !== 'ignored') {
            this.#options.metrics?.tasks.inc({ operation, outcome });
            this.#options.metrics?.taskDuration.observe(
                { operation },
                Number(process.hrtime.bigint() - started) / 1e9,
            );
        }
        return outcome;
    }

    async #run(
        taskId: string,
        options: RunOptions,
        onOperation: (key: string) => void,
    ): Promise<RunOutcome> {
        const { database, scheduler, logger } = this.#options;
        const task = await this.#loadTask(taskId);
        if (task === undefined || (task.status !== 'queued' && task.status !== 'running')) {
            return 'ignored';
        }
        const job = await scheduler.loadJob(task.jobId);
        if (job === undefined || job.status === 'canceled' || job.endedAt !== undefined) {
            return 'ignored';
        }
        onOperation(task.operation);
        const operation = this.#options.operations.resolve(task.operation);
        if (operation === undefined) {
            // A worker without this operation's plugin: another worker may have it.
            logger.warn(
                { task: task.id, operation: task.operation },
                'Operation not available on this worker',
            );
            return options.canRetry
                ? 'retry'
                : this.#fail(task, {
                      code: 'operation_failed',
                      message: `${task.operation} isn't available.`,
                  });
        }

        const now = new Date();
        const started = await database.kysely
            .updateTable('tasks')
            .set({
                status: 'running',
                attempts: task.attempts + 1,
                worker: this.#options.worker,
                progress: 0,
                error: null,
                started_at: now,
                updated_at: now,
            })
            .where('id', '=', task.id)
            .where('status', 'in', ['queued', 'running'])
            .executeTakeFirst();
        if (started.numUpdatedRows === 0n) {
            return 'ignored';
        }
        await scheduler.emit({
            type: 'task.status',
            job: job.id,
            task: task.name,
            status: 'running',
        });
        const jobStarted = await database.kysely
            .updateTable('jobs')
            .set({ status: 'running', started_at: now, updated_at: now })
            .where('id', '=', job.id)
            .where('status', '=', 'pending')
            .executeTakeFirst();
        if (jobStarted.numUpdatedRows > 0n) {
            await scheduler.emit({ type: 'job.status', job: job.id, status: 'running' });
        }

        const project = await this.#options.projects.get(job.projectId);
        await mkdir(this.#options.config.tmpDir, { recursive: true });
        const workdir = await mkdtemp(join(this.#options.config.tmpDir, `${task.name}-`));
        const timeout = project.settings.taskTimeout ?? this.#options.config.taskTimeout;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort('timeout'), timeout);
        const onCancel = () => controller.abort('canceled');
        options.signal?.addEventListener('abort', onCancel, { once: true });
        const startedAt = Date.now();
        let stage: 'input' | 'run' | 'output' = 'input';

        try {
            const input = await this.#fetchTaskInput(
                task,
                job.input,
                project,
                workdir,
                controller.signal,
            );
            const type = await detectType(input.path);
            if (!acceptsInput(operation, type)) {
                throw new OperationError(
                    'unsupported_input',
                    `${operation.key} doesn't read ${type.mime} files.`,
                );
            }

            const probe = await this.#probeOf(task, job.id);
            if (task.condition !== undefined && !matchesCondition(task.condition, type, probe)) {
                if (await this.#end(task, 'skipped')) {
                    await scheduler.advance(job.id);
                }
                return 'skipped';
            }

            stage = 'run';
            const files: DeclaredFile[] = [];
            const result = await operation.run(
                this.#context(
                    operation,
                    task,
                    { ...type, path: input.path, size: input.size, probe },
                    workdir,
                    controller.signal,
                    files,
                    options,
                    this.#progressWebhooks(project, job, task),
                ),
                task.options as never,
            );
            if (controller.signal.aborted) {
                throw new OperationError(
                    controller.signal.reason === 'timeout' ? 'timeout' : 'operation_failed',
                    controller.signal.reason === 'timeout'
                        ? `The task took longer than ${timeout} ms.`
                        : 'The task was canceled.',
                );
            }

            stage = 'output';
            const written = await this.#writeOutputs(
                task,
                job.id,
                job.output,
                project,
                operation,
                files,
                result.metadata,
            );
            if (!(await this.#end(task, 'completed'))) {
                return 'canceled';
            }
            if (project.settings.taskWebhooks) {
                await this.#options.webhooks?.send(job, 'task.completed');
            }
            await this.#recordUsage(
                task,
                project,
                operation,
                input.size,
                written,
                probe,
                Date.now() - startedAt,
            );
            await scheduler.advance(job.id);
            return 'completed';
        } catch (caught) {
            let error = caught;
            if (
                controller.signal.aborted &&
                !(caught instanceof OperationError && caught.code === 'timeout')
            ) {
                if (controller.signal.reason === 'canceled') {
                    if (await this.#end(task, 'canceled')) {
                        await scheduler.advance(job.id);
                    }
                    return 'canceled';
                }
                error = new OperationError('timeout', `The task took longer than ${timeout} ms.`);
            }
            const taskError = taskErrorOf(error, stage);
            if (!(error instanceof OperationError) && !(error instanceof StorageError)) {
                logger.error(
                    { err: error, task: task.id, job: job.id },
                    'Task failed unexpectedly',
                );
            }
            if (options.canRetry && isRetryable(error)) {
                // Back to the queue: BullMQ runs it again after a delay.
                await database.kysely
                    .updateTable('tasks')
                    .set({ status: 'queued', error: toJson(taskError), updated_at: new Date() })
                    .where('id', '=', task.id)
                    .where('status', '=', 'running')
                    .execute();
                await scheduler.emit({
                    type: 'task.status',
                    job: job.id,
                    task: task.name,
                    status: 'queued',
                });
                return 'retry';
            }
            return this.#fail(task, taskError);
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onCancel);
            await rm(workdir, { recursive: true, force: true });
        }
    }

    async #fail(task: TaskRecord, error: TaskError): Promise<RunOutcome> {
        const now = new Date();
        const result = await this.#options.database.kysely
            .updateTable('tasks')
            .set({ status: 'failed', error: toJson(error), ended_at: now, updated_at: now })
            .where('id', '=', task.id)
            .where('status', 'in', ['queued', 'running'])
            .executeTakeFirst();
        if (result.numUpdatedRows > 0n) {
            await this.#options.scheduler.emit({
                type: 'task.status',
                job: task.jobId,
                task: task.name,
                status: 'failed',
            });
            await this.#options.scheduler.advance(task.jobId);
        }
        return 'failed';
    }

    /** The task's input on disk: the job's input, or a file of the task it reads from. */
    async #fetchTaskInput(
        task: TaskRecord,
        jobInput: Parameters<typeof fetchInput>[0],
        project: Project,
        workdir: string,
        signal: AbortSignal,
    ): Promise<{ path: string; size: number }> {
        const path = join(workdir, 'input');
        const maxSize = project.settings.maxInputSize ?? this.#options.config.maxInputSize;
        if (task.source === undefined) {
            const size = await fetchInput(jobInput, path, {
                project,
                resolver: this.#options.resolver,
                uploads: this.#options.uploads,
                maxSize,
                signal,
                jobId: task.jobId,
                ...(this.#options.guard === undefined ? {} : { guard: this.#options.guard }),
            });
            return { path, size };
        }

        const tasks = await this.#options.scheduler.loadTasks(task.jobId);
        const sourceTask = tasks.find(({ name }) => name === task.source?.task);
        const files = (
            await this.#outputsOf(sourceTask === undefined ? [] : [sourceTask.id])
        ).filter(({ kind }) => kind === 'file');
        const file =
            task.source.file === undefined
                ? (files.find(({ role }) => role === 'main') ?? files[0])
                : files.find(({ name }) => name === task.source?.file);
        if (file?.storage === undefined || file.path === undefined) {
            throw new OperationError(
                'input_unreadable',
                task.source.file === undefined
                    ? `${task.source.task} wrote no file.`
                    : `${task.source.task} wrote no file named ${task.source.file}.`,
            );
        }
        const driver = await this.#options.resolver.driverFor(project.id, file.storage);
        const size = await driver.read(file.path, path, { maxSize, signal, jobId: task.jobId });
        return { path, size };
    }

    /** What `probe` read from the job's input, for a task that reads the job's input too. */
    async #probeOf(task: TaskRecord, jobId: string): Promise<ProbeMetadata | undefined> {
        if (task.source !== undefined) {
            return undefined;
        }
        const tasks = await this.#options.scheduler.loadTasks(jobId);
        const probes = tasks.filter(
            ({ operation, source, status }) =>
                operation.startsWith('probe@') && source === undefined && status === 'completed',
        );
        const outputs = await this.#outputsOf(probes.map(({ id }) => id));
        return outputs.find(({ kind }) => kind === 'metadata')?.data as ProbeMetadata | undefined;
    }

    /**
     * Sends the task's `task.progress` webhooks, for projects with `progressWebhooks`, throttled
     * by `progressWebhookInterval` (decision 0020).
     */
    #progressWebhooks(
        project: Project,
        job: JobRecord,
        task: TaskRecord,
    ): ((progress: number) => void) | undefined {
        const webhooks = this.#options.webhooks;
        if (!project.settings.progressWebhooks || webhooks === undefined) {
            return undefined;
        }
        const throttle = new ProgressThrottle(project.settings.progressWebhookInterval);
        return (progress) => {
            if (throttle.accept(progress)) {
                webhooks.sendProgress(job, task.name).catch((error: unknown) => {
                    this.#options.logger.warn(
                        { task: task.id, job: job.id, error: (error as Error).message },
                        'Progress webhook not queued',
                    );
                });
            }
        };
    }

    #context(
        operation: Operation,
        task: TaskRecord,
        input: OperationContext['input'],
        workdir: string,
        signal: AbortSignal,
        files: DeclaredFile[],
        options: RunOptions,
        sendProgress: ((progress: number) => void) | undefined,
    ): OperationContext {
        const { binaries } = this.#options.config;
        const log = this.#options.logger;
        const fields = { task: task.id, job: task.jobId, operation: operation.key };
        let lastProgress = 0;
        return {
            input,
            workdir,
            signal,
            exec: (binary, args, execOptions) => {
                if (!operation.binaries.includes(binary)) {
                    throw new OperationError(
                        'operation_failed',
                        `${operation.key} runs ${binary} without declaring it.`,
                    );
                }
                const path = (binaries as Record<string, string>)[binary] ?? binary;
                return execBinary(path, args, {
                    cwd: workdir,
                    ...execOptions,
                    env: { TMPDIR: workdir, MAGICK_TEMPORARY_PATH: workdir, ...execOptions?.env },
                    signal,
                });
            },
            progress: (ratio) => {
                const now = Date.now();
                if (now - lastProgress < 1000) {
                    return;
                }
                lastProgress = now;
                const progress = Math.min(1, Math.max(0, ratio));
                options.onProgress?.(progress);
                sendProgress?.(progress);
                void this.#options.scheduler.emit({
                    type: 'task.progress',
                    job: task.jobId,
                    task: task.name,
                    progress,
                });
                void this.#options.database.kysely
                    .updateTable('tasks')
                    .set({ progress })
                    .where('id', '=', task.id)
                    .where('status', '=', 'running')
                    .execute()
                    .catch(() => {});
            },
            log: {
                debug: (message, data) => log.debug({ ...fields, ...data }, message),
                info: (message, data) => log.info({ ...fields, ...data }, message),
                warn: (message, data) => log.warn({ ...fields, ...data }, message),
            },
            output: (name, path, outputOptions) => {
                const full = resolve(workdir, path);
                if (relative(workdir, full).startsWith('..')) {
                    throw new OperationError(
                        'operation_failed',
                        `${operation.key} declared a file outside its work directory.`,
                    );
                }
                if (
                    outputOptions?.thumbhash !== undefined &&
                    (outputOptions.thumbhash.length > 64 ||
                        !THUMBHASH_PATTERN.test(outputOptions.thumbhash))
                ) {
                    throw new OperationError(
                        'operation_failed',
                        `${operation.key} gave ${name} a placeholder that isn't a ThumbHash.`,
                    );
                }
                files.push({ name: checkOutputName(name), path: full, ...outputOptions });
            },
        };
    }

    /**
     * Writes the declared files to the output storage (the temporary storage for `keep: false`),
     * then replaces the task's outputs in the database. Returns the bytes written.
     */
    async #writeOutputs(
        task: TaskRecord,
        jobId: string,
        target: { storage: string; prefix?: string; path?: string } | undefined,
        project: Project,
        operation: Operation,
        files: DeclaredFile[],
        metadata: Record<string, unknown> | undefined,
    ): Promise<{ bytes: number; stored: number }> {
        if (files.length > 0 && !operation.outputs.files) {
            throw new OperationError(
                'operation_failed',
                `${operation.key} wrote files but says it doesn't.`,
            );
        }
        const keep = task.keep && target !== undefined;
        const storage = keep ? target.storage : TEMPORARY_STORAGE;
        const driver = await this.#options.resolver.driverFor(project.id, storage);
        const expiresAt =
            storage === TEMPORARY_STORAGE
                ? new Date(
                      Date.now() +
                          Math.min(
                              project.settings.tempRetention ?? this.#options.config.tempRetention,
                              this.#options.config.tempMaxRetention,
                          ),
                  )
                : undefined;

        const rows: Insertable<OutputsTable>[] = [];
        let bytes = 0;
        for (const file of files) {
            const path = keep
                ? `${target.prefix ?? ''}${(target.path ?? '{task}/{file}').replaceAll('{task}', task.name).replaceAll('{file}', file.name)}`
                : `jobs/${jobId}/${task.name}/${file.name}`;
            checkStoragePath(path);
            let info;
            try {
                info = await hashFile(file.path);
            } catch (error) {
                throw new OperationError(
                    'operation_failed',
                    `${operation.key} declared ${file.name} but didn't write it.`,
                    { cause: error },
                );
            }
            const mime = file.mime ?? (await detectType(file.path)).mime;
            await driver.write(path, file.path, {
                mime,
                size: info.size,
                sha256: info.sha256,
                jobId,
            });
            bytes += info.size;
            rows.push({
                id: createId('output'),
                task_id: task.id,
                job_id: jobId,
                project_id: project.id,
                kind: 'file',
                name: file.name,
                storage,
                path,
                mime,
                size: info.size,
                checksum: info.sha256,
                role: file.role ?? null,
                data: file.thumbhash === undefined ? null : toJson({ thumbhash: file.thumbhash }),
                expires_at: expiresAt ?? null,
                expired: false,
                created_at: new Date(),
            });
        }
        if (metadata !== undefined) {
            rows.push({
                id: createId('output'),
                task_id: task.id,
                job_id: jobId,
                project_id: project.id,
                kind: 'metadata',
                name: task.name,
                data: toJson(metadata),
                expired: false,
                created_at: new Date(),
            });
        }
        await this.#options.database.kysely.transaction().execute(async (transaction) => {
            // A task that runs again replaces its outputs.
            await transaction.deleteFrom('outputs').where('task_id', '=', task.id).execute();
            if (rows.length > 0) {
                await transaction.insertInto('outputs').values(rows).execute();
            }
        });
        return { bytes, stored: storage === TEMPORARY_STORAGE ? bytes : 0 };
    }

    async #recordUsage(
        task: TaskRecord,
        project: Project,
        operation: Operation,
        bytesIn: number,
        written: { bytes: number; stored: number },
        probe: ProbeMetadata | undefined,
        elapsed: number,
    ): Promise<void> {
        await this.#options.database.kysely
            .insertInto('usage')
            .values({
                id: createId('usage'),
                project_id: project.id,
                job_id: task.jobId,
                task_id: task.id,
                operation: operation.key,
                // Wall-clock time of the task: the CPU time of its binaries isn't measured yet.
                cpu_ms: elapsed,
                media_ms: Math.round((probe?.duration ?? 0) * 1000),
                bytes_in: bytesIn,
                bytes_out: written.bytes,
                bytes_stored: written.stored,
                created_at: new Date(),
            })
            .execute();
    }
}
