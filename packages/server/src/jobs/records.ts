import type { Selectable } from 'kysely';

import type { Capability } from '@eclair-js/operation';
import type {
    Input,
    JobStatus,
    OutputTarget,
    Priority,
    TaskCondition,
    TaskError,
    TaskStatus,
} from '@eclair-js/protocol';

import type { JobsTable, OutputsTable, TasksTable } from '../database/tables.ts';
import {
    readBoolean,
    readDate,
    readJson,
    readOptionalDate,
    readOptionalJson,
    readOptionalNumber,
} from '../database/values.ts';
import { parseSource } from './pipeline.ts';

export interface JobRecord {
    id: string;
    projectId: string;
    status: JobStatus;
    priority: Priority;
    input: Input;
    output: OutputTarget | undefined;
    preset: { name: string; version: number } | undefined;
    webhookUrl: string | undefined;
    metadata: Record<string, unknown>;
    failFast: boolean;
    createdAt: Date;
    startedAt: Date | undefined;
    endedAt: Date | undefined;
}

export interface TaskRecord {
    id: string;
    jobId: string;
    projectId: string;
    name: string;
    /** `name@version`. */
    operation: string;
    queue: Capability;
    options: Record<string, unknown>;
    source: { task: string; file: string | undefined } | undefined;
    /** As the client wrote it: `h264` or `h264:file`. */
    from: string | undefined;
    dependencies: string[];
    after: string[];
    condition: TaskCondition | undefined;
    keep: boolean;
    status: TaskStatus;
    attempts: number;
    progress: number | undefined;
    error: TaskError | undefined;
    worker: string | undefined;
    queuedAt: Date | undefined;
    startedAt: Date | undefined;
    endedAt: Date | undefined;
}

export interface OutputRecord {
    id: string;
    taskId: string;
    jobId: string;
    kind: 'file' | 'metadata';
    name: string;
    storage: string | undefined;
    path: string | undefined;
    mime: string | undefined;
    size: number | undefined;
    checksum: string | undefined;
    role: string | undefined;
    count: number | undefined;
    data: Record<string, unknown> | undefined;
    expiresAt: Date | undefined;
    expired: boolean;
}

/** The task statuses after which a task never runs again, unless the job is retried. */
export const ENDED_TASK_STATUSES: readonly TaskStatus[] = [
    'completed',
    'failed',
    'canceled',
    'skipped',
];

/** The job statuses of an ended job. */
export const ENDED_JOB_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'canceled'];

export function toJobRecord(row: Selectable<JobsTable>): JobRecord {
    return {
        id: row.id,
        projectId: row.project_id,
        status: row.status as JobStatus,
        priority: row.priority as Priority,
        input: readJson<Input>(row.input),
        output: readOptionalJson<OutputTarget>(row.output),
        preset:
            row.preset === null || row.preset_version === null
                ? undefined
                : { name: row.preset, version: row.preset_version },
        webhookUrl: row.webhook_url ?? undefined,
        metadata: readJson<Record<string, unknown>>(row.metadata),
        failFast: readBoolean(row.fail_fast),
        createdAt: readDate(row.created_at),
        startedAt: readOptionalDate(row.started_at),
        endedAt: readOptionalDate(row.ended_at),
    };
}

/** Dependencies are stored with the `after` list, to give `after` back to the client. */
export interface StoredDependencies {
    all: string[];
    after: string[];
}

export function toTaskRecord(row: Selectable<TasksTable>): TaskRecord {
    const dependencies = readJson<StoredDependencies>(row.dependencies);
    return {
        id: row.id,
        jobId: row.job_id,
        projectId: row.project_id,
        name: row.name,
        operation: `${row.operation}@${row.operation_version}`,
        queue: row.queue as Capability,
        options: readJson<Record<string, unknown>>(row.options),
        source: row.source === null ? undefined : parseSource(row.source),
        from: row.source ?? undefined,
        dependencies: dependencies.all,
        after: dependencies.after,
        condition: readOptionalJson<TaskCondition>(row.condition),
        keep: readBoolean(row.keep),
        status: row.status as TaskStatus,
        attempts: row.attempts,
        progress: readOptionalNumber(row.progress),
        error: readOptionalJson<TaskError>(row.error),
        worker: row.worker ?? undefined,
        queuedAt: readOptionalDate(row.queued_at),
        startedAt: readOptionalDate(row.started_at),
        endedAt: readOptionalDate(row.ended_at),
    };
}

export function toOutputRecord(row: Selectable<OutputsTable>): OutputRecord {
    return {
        id: row.id,
        taskId: row.task_id,
        jobId: row.job_id,
        kind: row.kind as OutputRecord['kind'],
        name: row.name,
        storage: row.storage ?? undefined,
        path: row.path ?? undefined,
        mime: row.mime ?? undefined,
        size: readOptionalNumber(row.size),
        checksum: row.checksum ?? undefined,
        role: row.role ?? undefined,
        count: row.count ?? undefined,
        data: readOptionalJson<Record<string, unknown>>(row.data),
        expiresAt: readOptionalDate(row.expires_at),
        expired: readBoolean(row.expired),
    };
}
