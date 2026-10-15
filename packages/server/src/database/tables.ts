import type { ColumnType } from 'kysely';

/*
 * Table types of the Eclair database. Columns whose type differs between the databases are typed
 * as what any of them may return, so that code reads them with the helpers of `values.ts`.
 * `tables.test.ts` runs the migrations and checks that the database has exactly these columns.
 */

/** A `Date` from MySQL and PostgreSQL, ISO 8601 text from SQLite. Written as a `Date`. */
type Timestamp = ColumnType<Date | string, Date, Date>;
type NullableTimestamp = ColumnType<Date | string | null, Date | null | undefined, Date | null>;

/** Parsed by MySQL and PostgreSQL, text in SQLite. Written with `toJson()`. */
type Json = ColumnType<unknown, string, string>;
type NullableJson = ColumnType<unknown, string | null | undefined, string | null>;

/** `boolean` from PostgreSQL, 0 or 1 from MySQL and SQLite. Written as a `boolean`. */
type Bool = ColumnType<boolean | number, boolean, boolean>;

/** A string from PostgreSQL, a number from MySQL and SQLite. */
type BigInteger = ColumnType<number | string, number, number>;
type NullableBigInteger = ColumnType<
    number | string | null,
    number | null | undefined,
    number | null
>;

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ProjectsTable {
    id: string;
    slug: string;
    name: string;
    priority: string;
    /** Limits, allowed operations and providers, retention… (see `ProjectSettings`). */
    settings: Json;
    webhook_url: Nullable<string>;
    /** The webhook secret, encrypted with `ECLAIR_SECRET_KEY`. */
    webhook_secret: string;
    created_at: Timestamp;
    updated_at: Timestamp;
    disabled_at: NullableTimestamp;
}

export interface ApiKeysTable {
    id: string;
    project_id: string;
    name: string;
    /** The start of the key, shown to recognize it. */
    prefix: string;
    /** SHA-256 of the key, in hexadecimal. The key itself is never stored. */
    hash: string;
    scopes: Json;
    created_at: Timestamp;
    last_used_at: NullableTimestamp;
    revoked_at: NullableTimestamp;
}

export interface StoragesTable {
    id: string;
    project_id: string;
    name: string;
    kind: string;
    /** The storage's configuration and credentials, encrypted with `ECLAIR_SECRET_KEY`. */
    config: string;
    created_at: Timestamp;
    updated_at: Timestamp;
}

export interface PresetsTable {
    id: string;
    /** The project's id, or `global` for a preset that every project can use. */
    scope: string;
    project_id: Nullable<string>;
    name: string;
    description: Nullable<string>;
    version: number;
    tasks: Json;
    created_at: Timestamp;
    updated_at: Timestamp;
}

export interface JobsTable {
    id: string;
    project_id: string;
    status: string;
    priority: string;
    input: Json;
    output: NullableJson;
    preset: Nullable<string>;
    preset_version: Nullable<number>;
    webhook_url: Nullable<string>;
    metadata: Json;
    fail_fast: Bool;
    idempotency_key: Nullable<string>;
    /** SHA-256 of the request body, to detect an `Idempotency-Key` reused with another body. */
    request_hash: Nullable<string>;
    created_at: Timestamp;
    updated_at: Timestamp;
    started_at: NullableTimestamp;
    ended_at: NullableTimestamp;
}

export interface TasksTable {
    id: string;
    job_id: string;
    project_id: string;
    name: string;
    operation: string;
    operation_version: number;
    queue: string;
    options: Json;
    /** The task whose output is this task's input (`from`), or `null` for the job input. */
    source: Nullable<string>;
    /** Names of the tasks this one waits for: `from` and `after`. */
    dependencies: Json;
    condition: NullableJson;
    keep: Bool;
    status: string;
    attempts: number;
    progress: Nullable<number>;
    error: NullableJson;
    worker: Nullable<string>;
    created_at: Timestamp;
    updated_at: Timestamp;
    queued_at: NullableTimestamp;
    started_at: NullableTimestamp;
    ended_at: NullableTimestamp;
}

export interface OutputsTable {
    id: string;
    task_id: string;
    job_id: string;
    project_id: string;
    /** `file` or `metadata`. */
    kind: string;
    name: string;
    storage: Nullable<string>;
    path: Nullable<string>;
    mime: Nullable<string>;
    size: NullableBigInteger;
    checksum: Nullable<string>;
    role: Nullable<string>;
    /** For a file with many parts (HLS segments): how many there are. */
    count: Nullable<number>;
    data: NullableJson;
    expires_at: NullableTimestamp;
    expired: Bool;
    created_at: Timestamp;
}

export interface UploadsTable {
    id: string;
    project_id: string;
    path: string;
    /** Unknown until a resumable upload declares it. */
    size: NullableBigInteger;
    received: BigInteger;
    mime: Nullable<string>;
    checksum: Nullable<string>;
    /** The probe's result, when the upload was probed. */
    metadata: NullableJson;
    /** Parts of a resumable upload, `[{ offset, size }]`. `null` for an upload sent at once. */
    parts: NullableJson;
    expires_at: Timestamp;
    completed_at: NullableTimestamp;
    created_at: Timestamp;
    updated_at: Timestamp;
}

export interface UsageTable {
    id: string;
    project_id: string;
    job_id: Nullable<string>;
    task_id: Nullable<string>;
    operation: string;
    cpu_ms: BigInteger;
    media_ms: BigInteger;
    bytes_in: BigInteger;
    bytes_out: BigInteger;
    bytes_stored: BigInteger;
    /** Cost reported by an external provider, in US dollars. */
    cost: Nullable<number>;
    created_at: Timestamp;
}

export interface WebhookDeliveriesTable {
    id: string;
    project_id: string;
    job_id: string;
    event: string;
    url: string;
    status: string;
    attempts: number;
    response_status: Nullable<number>;
    next_attempt_at: NullableTimestamp;
    delivered_at: NullableTimestamp;
    created_at: Timestamp;
    updated_at: Timestamp;
}

export interface Tables {
    projects: ProjectsTable;
    api_keys: ApiKeysTable;
    storages: StoragesTable;
    presets: PresetsTable;
    jobs: JobsTable;
    tasks: TasksTable;
    outputs: OutputsTable;
    uploads: UploadsTable;
    usage: UsageTable;
    webhook_deliveries: WebhookDeliveriesTable;
}

type ColumnList<T> = readonly (keyof T & string)[];

/** The columns of each table, for the test that compares them with the database. */
export const COLUMNS = {
    projects: [
        'id',
        'slug',
        'name',
        'priority',
        'settings',
        'webhook_url',
        'webhook_secret',
        'created_at',
        'updated_at',
        'disabled_at',
    ],
    api_keys: [
        'id',
        'project_id',
        'name',
        'prefix',
        'hash',
        'scopes',
        'created_at',
        'last_used_at',
        'revoked_at',
    ],
    storages: ['id', 'project_id', 'name', 'kind', 'config', 'created_at', 'updated_at'],
    presets: [
        'id',
        'scope',
        'project_id',
        'name',
        'description',
        'version',
        'tasks',
        'created_at',
        'updated_at',
    ],
    jobs: [
        'id',
        'project_id',
        'status',
        'priority',
        'input',
        'output',
        'preset',
        'preset_version',
        'webhook_url',
        'metadata',
        'fail_fast',
        'idempotency_key',
        'request_hash',
        'created_at',
        'updated_at',
        'started_at',
        'ended_at',
    ],
    tasks: [
        'id',
        'job_id',
        'project_id',
        'name',
        'operation',
        'operation_version',
        'queue',
        'options',
        'source',
        'dependencies',
        'condition',
        'keep',
        'status',
        'attempts',
        'progress',
        'error',
        'worker',
        'created_at',
        'updated_at',
        'queued_at',
        'started_at',
        'ended_at',
    ],
    outputs: [
        'id',
        'task_id',
        'job_id',
        'project_id',
        'kind',
        'name',
        'storage',
        'path',
        'mime',
        'size',
        'checksum',
        'role',
        'count',
        'data',
        'expires_at',
        'expired',
        'created_at',
    ],
    uploads: [
        'id',
        'project_id',
        'path',
        'size',
        'received',
        'mime',
        'checksum',
        'metadata',
        'parts',
        'expires_at',
        'completed_at',
        'created_at',
        'updated_at',
    ],
    usage: [
        'id',
        'project_id',
        'job_id',
        'task_id',
        'operation',
        'cpu_ms',
        'media_ms',
        'bytes_in',
        'bytes_out',
        'bytes_stored',
        'cost',
        'created_at',
    ],
    webhook_deliveries: [
        'id',
        'project_id',
        'job_id',
        'event',
        'url',
        'status',
        'attempts',
        'response_status',
        'next_attempt_at',
        'delivered_at',
        'created_at',
        'updated_at',
    ],
} as const satisfies { [Name in keyof Tables]: ColumnList<Tables[Name]> };

// Fails to compile when a table type has a column that COLUMNS doesn't list.
type MissingColumns = {
    [Name in keyof Tables]: Exclude<keyof Tables[Name], (typeof COLUMNS)[Name][number]>;
}[keyof Tables];
const columnsAreComplete: [MissingColumns] extends [never] ? true : MissingColumns = true;
void columnsAreComplete;
