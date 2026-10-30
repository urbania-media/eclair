// Generated from schema/openapi.json by `npm run generate`. Do not edit.

export interface paths {
    "/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List jobs
         * @description The project's jobs, newest first.
         */
        get: operations["listJobs"];
        put?: never;
        /**
         * Create a job
         * @description Validates the job (the body, then each task's options against its operation's schema), stores it and queues its first tasks. The task graph must be acyclic.
         */
        post: operations["createJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        /** Show a job */
        get: operations["getJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel a job
         * @description Cancels the pending and running tasks. Tasks that ended keep their outputs. Canceling an ended job changes nothing and returns it.
         */
        post: operations["cancelJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry a job
         * @description Runs the failed and canceled tasks again, and the tasks that depend on them.
         */
        post: operations["retryJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        /**
         * Follow a job
         * @description Server-sent events with the job's status and progress changes. Each event's `event` field is the `type` of its data, and its `data` field is a `JobEvent` as JSON. The stream ends after the job ends.
         */
        get: operations["streamJobEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        /**
         * List a job's files
         * @description Every file of the job, parts included (HLS segments, thumbnail series), with fresh signed URLs for files in the temporary storage.
         */
        get: operations["listJobFiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/probe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Probe a file
         * @description Returns the file's metadata in the response, as the `probe` operation does. The input is a URL, a storage path or an upload (JSON body), or the file itself. The file, as `multipart/form-data` (a `file` part) or as the raw body with its `Content-Type`. With a file body, `timeout`, `checksum` and `thumbhash` are query parameters.
         */
        post: operations["probe"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a file
         * @description Stores a file in the temporary storage, until it expires. The file, as `multipart/form-data` (a `file` part) or as the raw body with its `Content-Type`.
         *
         *     Larger files use a resumable upload, following the tus protocol 1.0 (core, creation and termination): send this request with `Tus-Resumable` and `Upload-Length` and no body, then `PATCH` the chunks to the `Location` it returns.
         */
        post: operations["createUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["UploadId"];
            };
            cookie?: never;
        };
        /** Show an upload */
        get: operations["getUpload"];
        put?: never;
        post?: never;
        /**
         * Delete an upload
         * @description Deletes the file now instead of when it expires. Jobs that already read it are not affected. Also the tus termination extension.
         */
        delete: operations["deleteUpload"];
        options?: never;
        /**
         * Resume an upload (tus)
         * @description Returns how many bytes of a resumable upload were received, in `Upload-Offset`.
         */
        head: operations["getUploadOffset"];
        /**
         * Send a chunk (tus)
         * @description Appends a chunk to a resumable upload, at `Upload-Offset`. The last chunk completes the upload: its file type is then detected.
         */
        patch: operations["appendUpload"];
        trace?: never;
    };
    "/v1/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List presets
         * @description The project's presets and the global ones. A project preset hides a global one with the same name.
         */
        get: operations["listPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/presets/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        /** Show a preset */
        get: operations["getPreset"];
        /**
         * Create or replace a project preset
         * @description Each change gives the preset a new version. Jobs record the version they used.
         */
        put: operations["putPreset"];
        post?: never;
        /**
         * Delete a project preset
         * @description Global presets can't be deleted with a project key. Jobs that used the preset keep their pipeline.
         */
        delete: operations["deletePreset"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List operations
         * @description The operations this server provides and this project may use, with their options schema. Clients can validate options or build forms from it.
         */
        get: operations["listOperations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a file of the temporary storage
         * @description The `url` of an `OutputFile` in the temporary storage, when it's a local directory. The token is signed by the server and expires with the file, so the request needs no API key. An unknown, expired or changed token is a 404.
         */
        get: operations["downloadFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the projects */
        get: operations["adminListProjects"];
        put?: never;
        /** Create a project */
        post: operations["adminCreateProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        /** Read a project */
        get: operations["adminGetProject"];
        put?: never;
        post?: never;
        /** Delete a project */
        delete: operations["adminDeleteProject"];
        options?: never;
        head?: never;
        /** Change a project */
        patch: operations["adminUpdateProject"];
        trace?: never;
    };
    "/admin/v1/projects/{project}/webhook-secret": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        /** Read a project's webhook secret */
        get: operations["adminGetWebhookSecret"];
        put?: never;
        /**
         * Replace a project's webhook secret
         * @description The previous secret stays valid for a grace period, 24 hours by default: until it expires, webhooks and `http` storage requests carry a `v1` value for each secret, so the application can move to the new one without refusing any request. Rotating again during a grace period drops the older secret.
         */
        post: operations["adminRotateWebhookSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}/keys": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        /** List a project's API keys */
        get: operations["adminListKeys"];
        put?: never;
        /** Create an API key */
        post: operations["adminCreateKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/keys/{key}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The key's id. */
                key: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke an API key */
        post: operations["adminRevokeKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}/storages": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        /** List a project's storages */
        get: operations["adminListStorages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}/storages/{storage}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
                /** @description Name of one of the project's storages. */
                storage: components["parameters"]["StorageNameParameter"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Create or replace a storage
         * @description `eclair` is the temporary storage's name: it can't be used.
         */
        put: operations["adminPutStorage"];
        post?: never;
        /** Remove a storage */
        delete: operations["adminDeleteStorage"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the global presets */
        get: operations["adminListPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/presets/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Create or replace a global preset
         * @description Every project can use a global preset, unless it has its own with the same name.
         */
        put: operations["adminPutPreset"];
        post?: never;
        /** Delete a global preset */
        delete: operations["adminDeletePreset"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Usage per project and day
         * @description To split the cost of a server between the projects that share it.
         */
        get: operations["adminUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface webhooks {
    "job.completed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "job.failed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "job.canceled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "task.completed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A task completed
         * @description Sent when a task completes, to projects that subscribe to it, so they can attach outputs as soon as they exist. The body is the whole job, and `Eclair-Task` names the task.
         */
        post: operations["taskCompletedWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "storage.write": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Write a file to an `http` storage
         * @description With an `http` storage, workers send each output file to `PUT {endpoint}/{path}`. Retried until the endpoint answers `2xx`: the same path can be written twice.
         */
        put: operations["httpStorageWrite"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "storage.read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a file from an `http` storage
         * @description Workers read an input with `GET {endpoint}/{path}`. The signature covers the timestamp, the path and the SHA-256 of an empty body.
         */
        get: operations["httpStorageRead"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface components {
    schemas: {
        /**
         * @description Prefixed ULID.
         * @example job_01JA2Y8C6W4N5V7TQ3H9XK0B2M
         */
        JobId: string;
        /**
         * @description Name of a task in a job. It is also the name of its outputs: the handle the application reads.
         * @example h264
         * @example thumbnails
         */
        TaskName: string;
        /**
         * @description Name of an operation, `<domain>.<action>` or `probe`, optionally with a major version: `video.hls@1`. Without a version, the latest one.
         * @example probe
         * @example video.transcode
         * @example video.hls@1
         */
        OperationName: string;
        /**
         * @description Name of a preset. A `/` groups presets: `mediatheque/video`.
         * @example web-video
         * @example mediatheque/video
         */
        PresetName: string;
        /**
         * @description Name of one of the project's storages. `eclair` is Eclair's temporary storage, available to every project.
         * @example media
         */
        StorageName: string;
        /**
         * @description Kind of a file, detected from its content.
         * @enum {string}
         */
        Kind: "image" | "video" | "audio" | "document" | "font" | "other";
        /** @enum {string} */
        Priority: "low" | "normal" | "high";
        /** @description Free object of the client, returned as is in the job and the webhooks. */
        Metadata: {
            [key: string]: unknown;
        };
        UrlInput: {
            /**
             * Format: uri
             * @description `https` URL of the file, for example a presigned URL. Fetched through the SSRF guard.
             */
            url: string;
            mime?: components["schemas"]["MimeHint"];
            size?: components["schemas"]["SizeHint"];
        };
        StorageInput: {
            storage: components["schemas"]["StorageName"];
            path: components["schemas"]["StoragePath"];
            mime?: components["schemas"]["MimeHint"];
            size?: components["schemas"]["SizeHint"];
        };
        /** @description The file to process: a URL, a path in one of the project's storages, or an upload. */
        Input: components["schemas"]["UrlInput"] | components["schemas"]["StorageInput"] | components["schemas"]["UploadInput"];
        /** @description Path in a storage, without a leading `/`. */
        StoragePath: string;
        /** @description The mime type the client expects. A hint: Eclair detects the real one from the content. */
        MimeHint: string;
        /** @description The size in bytes the client expects. A hint, checked against the project's limits before downloading. */
        SizeHint: number;
        /** @description Where output files are written. Optional when no task writes files. */
        OutputTarget: {
            storage: components["schemas"]["StorageName"];
            /**
             * @description Prefix of every output path, usually ending with `/`.
             * @default
             */
            prefix?: string;
            /**
             * @description Pattern of each output file's path, after the prefix. `{task}` is the task's name, `{file}` the file's name.
             * @default {task}/{file}
             */
            path?: string;
        };
        /** @description Runs the task only if the probed input matches every given condition. Otherwise the task is `skipped`. */
        TaskCondition: {
            kind?: components["schemas"]["Kind"][];
            /** @description Mime types, with `*` for a subtype: `image/*`. */
            mime?: string[];
            /** @description Seconds. */
            minDuration?: number;
            /** @description Seconds. */
            maxDuration?: number;
        };
        TaskRequest: {
            op: components["schemas"]["OperationName"];
            /** @description Name of the task whose output is this task's input. Defaults to the job's input. `h264:file` picks one output file of that task. */
            from?: string;
            /** @description Validated against the operation's options schema (see `GET /v1/operations`). */
            options?: {
                [key: string]: unknown;
            };
            /** @description Extra dependencies, for ordering without using an output. */
            after?: components["schemas"]["TaskName"][];
            /**
             * @description `false` for an intermediate output, deleted when the job ends.
             * @default true
             */
            keep?: boolean;
            when?: components["schemas"]["TaskCondition"];
        };
        /** @description Named tasks. */
        TaskRequests: {
            [key: string]: components["schemas"]["TaskRequest"];
        };
        /** @description A job: an input, where to write the outputs, and a pipeline: a preset, inline tasks, or both. Without a preset, `tasks` is required. Tasks with the same name as a preset's task replace it. */
        JobRequest: {
            input: components["schemas"]["Input"];
            output?: components["schemas"]["OutputTarget"];
            preset?: components["schemas"]["PresetName"];
            tasks?: components["schemas"]["TaskRequests"];
            /**
             * Format: uri
             * @description URL called when the job ends. Defaults to the project's webhook.
             */
            webhook?: string;
            metadata?: components["schemas"]["Metadata"];
            /**
             * @description Within the project's limits.
             * @default normal
             */
            priority?: components["schemas"]["Priority"];
            /**
             * @description Cancel the remaining tasks as soon as one fails.
             * @default false
             */
            failFast?: boolean;
        };
        /** @enum {string} */
        JobStatus: "pending" | "running" | "completed" | "failed" | "canceled";
        /** @enum {string} */
        TaskStatus: "pending" | "queued" | "running" | "completed" | "failed" | "canceled" | "skipped";
        /**
         * @description Stable error code: `input_unreadable`, `unsupported_input`, `timeout`, `limit_exceeded`, `operation_failed`, `storage_failed`, `provider_failed`, and `dependency_failed` when a task it depends on failed. New codes can be added: treat unknown ones as `operation_failed`.
         * @example input_unreadable
         * @example unsupported_input
         * @example timeout
         * @example limit_exceeded
         * @example operation_failed
         * @example storage_failed
         * @example provider_failed
         * @example dependency_failed
         */
        TaskErrorCode: string;
        TaskError: {
            code: components["schemas"]["TaskErrorCode"];
            /** @description For humans. Can change. */
            message: string;
        };
        OutputFile: {
            /** @description Name of the file within the task's outputs. */
            name: string;
            /** @description Path in the job's output storage. */
            path: string;
            mime: string;
            /** @description Bytes. */
            size: number;
            /** @description SHA-256 of the file, in hex. */
            checksum?: string;
            /** @description What the file is for, when a task writes several: `main`, `thumbnail`, `segment`… */
            role?: string;
            /** @description For files with many parts (HLS segments, a thumbnail series): how many parts are not listed. */
            count?: number;
            /**
             * Format: uri
             * @description Signed download URL, for files in the temporary storage (`eclair`): the bucket's presigned URL, or `GET /v1/files/{token}` when the temporary storage is a local directory. Not for end users: it expires with the file.
             */
            url?: string;
            /**
             * Format: date-time
             * @description When a file in the temporary storage is deleted.
             */
            expiresAt?: string;
            /** @description `true` once a file in the temporary storage was deleted. It then has no `url`. */
            expired?: boolean;
        };
        TaskOutputs: {
            /** @description Data extracted by the task. Its shape depends on the operation: `probe` gives a `ProbeMetadata`. */
            metadata?: {
                [key: string]: unknown;
            };
            files?: components["schemas"]["OutputFile"][];
        };
        Task: {
            status: components["schemas"]["TaskStatus"];
            /** @description The operation that runs, always with its version: `video.hls@1`. */
            op: string;
            from?: string;
            after?: components["schemas"]["TaskName"][];
            /** @description From 0 to 1, while the task runs. */
            progress?: number;
            attempts?: number;
            /** Format: date-time */
            startedAt?: string;
            /** Format: date-time */
            endedAt?: string;
            outputs?: components["schemas"]["TaskOutputs"];
            error?: components["schemas"]["TaskError"];
        };
        Job: {
            id: components["schemas"]["JobId"];
            status: components["schemas"]["JobStatus"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt?: string;
            /** Format: date-time */
            endedAt?: string;
            input?: components["schemas"]["Input"];
            output?: components["schemas"]["OutputTarget"];
            /** @description The preset the job used, and its version at that time. */
            preset?: {
                name: components["schemas"]["PresetName"];
                version: number;
            };
            priority?: components["schemas"]["Priority"];
            failFast?: boolean;
            metadata?: components["schemas"]["Metadata"];
            /** @description Every task of the resolved pipeline, by name. */
            tasks: {
                [key: string]: components["schemas"]["Task"];
            };
        };
        JobList: {
            data: components["schemas"]["Job"][];
            nextCursor: components["schemas"]["NextCursor"];
        };
        /** @description Cursor of the next page, `null` on the last one. */
        NextCursor: string | null;
        /** @description An event of `GET /v1/jobs/{id}/events`. */
        JobEvent: {
            /** @enum {string} */
            type: "job.status" | "task.status" | "task.progress";
            job: components["schemas"]["JobId"];
            /** @description The new status, for `job.status` and `task.status`. */
            status?: string;
            /** @description The task, for `task.*` events. */
            task?: components["schemas"]["TaskName"];
            progress?: number;
        };
        PresetRequest: {
            description?: string;
            tasks: components["schemas"]["TaskRequests"];
        };
        Preset: {
            name: components["schemas"]["PresetName"];
            /**
             * @description `global` presets come with the server or the admin API, `project` presets are the project's own.
             * @enum {string}
             */
            scope: "global" | "project";
            version: number;
            description?: string;
            tasks: {
                [key: string]: components["schemas"]["TaskRequest"];
            };
        };
        PresetList: {
            data: components["schemas"]["Preset"][];
        };
        Operation: {
            /** @example image.palette */
            name: string;
            /** @description Major version. */
            version: number;
            description?: string;
            /** @description Inputs it can read. Other inputs are refused before anything runs. */
            accepts: {
                kinds?: components["schemas"]["Kind"][];
                mimes?: string[];
            };
            /**
             * @description Queue it runs on.
             * @example cpu
             * @example video
             * @example gpu
             * @example ai
             */
            capability: string;
            outputs: {
                files: boolean;
                metadata: boolean;
            };
            /** @description JSON Schema (2020-12) of the options. */
            options: {
                [key: string]: unknown;
            };
        };
        OperationList: {
            data: components["schemas"]["Operation"][];
        };
        /** @enum {string} */
        WebhookEvent: "job.completed" | "job.failed" | "job.canceled" | "task.completed";
        /** @description `t=<unix time>,v1=<hex HMAC-SHA256>`. Several `v1` values can follow, one per valid secret of the project (the current one first, then the previous one during the grace period of a rotation): the signature is valid if one of them matches. */
        Signature: string;
        /** @description Problem details (RFC 9457). */
        Problem: {
            /**
             * Format: uri-reference
             * @description URI of the problem type. `about:blank` when the status says it all.
             * @default about:blank
             */
            type?: string;
            title: string;
            status: number;
            detail?: string;
            /** Format: uri-reference */
            instance?: string;
            /** @description Validation errors: messages by JSON pointer to the invalid value in the request body (`/tasks/h264/options/codec`). The empty pointer is the body itself. */
            errors?: {
                [key: string]: string[];
            };
        };
        /**
         * @description Prefixed ULID.
         * @example upl_01JA2Y9F3K8M2R6T4V7W9X1Z3B
         */
        UploadId: string;
        UploadInput: {
            /** @description A file sent with `POST /v1/uploads`. */
            upload: components["schemas"]["UploadId"];
            mime?: components["schemas"]["MimeHint"];
            size?: components["schemas"]["SizeHint"];
        };
        /** @description A file of a job, with the task that wrote it. */
        JobFile: components["schemas"]["OutputFile"] & {
            task: components["schemas"]["TaskName"];
        };
        JobFileList: {
            data: components["schemas"]["JobFile"][];
            nextCursor: components["schemas"]["NextCursor"];
        };
        /** @description What `probe` reads from a file. Only what applies to the file's kind is present. */
        ProbeMetadata: {
            kind: components["schemas"]["Kind"];
            /** @description Detected from the content. */
            mime: string;
            /** @description Usual extension for the mime type, without the dot. */
            extension?: string;
            /** @description Bytes. */
            size?: number;
            /** @description SHA-256 of the whole file, in hex, when asked for. */
            checksum?: string;
            width?: number;
            height?: number;
            /**
             * @description Degrees, clockwise.
             * @enum {integer}
             */
            rotation?: 0 | 90 | 180 | 270;
            /** @description Seconds. */
            duration?: number;
            frameRate?: number;
            /** @description Bits per second. */
            bitrate?: number;
            /**
             * @example h264
             * @example hevc
             * @example vp9
             */
            videoCodec?: string;
            /**
             * @example aac
             * @example opus
             * @example mp3
             */
            audioCodec?: string;
            audioChannels?: number;
            pageCount?: number;
            fontNames?: string[];
            animated?: boolean;
            /** @description A summary of the EXIF data. GPS data is never included. */
            exif?: {
                [key: string]: unknown;
            };
            /** @description A ThumbHash placeholder (https://evanw.github.io/thumbhash/) of an image other than SVG, in base64, when asked for: its first frame, upright, in sRGB, fitted in 100×100. Missing when the image can't be decoded. */
            thumbhash?: string;
        };
        ProbeRequest: {
            input: components["schemas"]["Input"];
            /**
             * @description Seconds to wait for the result before answering `202` with a job.
             * @default 10
             */
            timeout?: number;
            /**
             * @description Add a SHA-256 of the whole file. It reads all of it, so it can take longer.
             * @default false
             */
            checksum?: boolean;
            /**
             * @description Add a ThumbHash placeholder of an image other than SVG. It decodes the image, so it can take longer.
             * @default false
             */
            thumbhash?: boolean;
        };
        ProbeResult: {
            metadata: components["schemas"]["ProbeMetadata"];
        };
        Upload: {
            id: components["schemas"]["UploadId"];
            /** @description Bytes. */
            size: number;
            /** @description Detected from the content, once the upload is complete. */
            mime?: string;
            /** @description `false` while a resumable upload is in progress. */
            complete?: boolean;
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description With `?probe=1`. */
            metadata?: components["schemas"]["ProbeMetadata"];
        };
        /** @description A project's settings. Every one has a default; limits not set use the server's. */
        ProjectSettings: {
            /**
             * @description Tasks of the project that can run at the same time, over every worker.
             * @default 4
             */
            concurrency?: number;
            /** @description Largest input, in bytes. `ECLAIR_MAX_INPUT_SIZE` when not set. */
            maxInputSize?: number;
            /**
             * @description Largest file sent in the body of `POST /v1/probe` or `POST /v1/uploads`, in bytes.
             * @default 104857600
             */
            maxDirectUpload?: number;
            /** @description Longest a task may run, in milliseconds. `ECLAIR_TASK_TIMEOUT` when not set. */
            taskTimeout?: number;
            /** @description How long temporary files are kept, in milliseconds, at most `ECLAIR_TEMP_MAX_RETENTION`. */
            tempRetention?: number;
            /** @description Operations the project may use, by name. All of them when not set. */
            operations?: string[];
            /** @description Hosts that `url` inputs may come from (`cdn.example.com`, `*.example.com`). Any public host when not set. */
            inputHosts?: string[];
            /** @default 600 */
            probesPerMinute?: number;
            /**
             * @description Sends a `task.completed` webhook for each task, besides the job's.
             * @default false
             */
            taskWebhooks?: boolean;
        };
        AdminProject: {
            id: string;
            slug: string;
            name: string;
            priority: components["schemas"]["Priority"];
            webhookUrl: string | null;
            settings: components["schemas"]["ProjectSettings"];
            disabled: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        AdminProjectList: {
            data: components["schemas"]["AdminProject"][];
        };
        ProjectRequest: {
            slug: string;
            name?: string;
            priority?: components["schemas"]["Priority"];
            webhookUrl?: string;
            /** @description Settings that differ from the defaults (see `ProjectSettings`). */
            settings?: {
                [key: string]: unknown;
            };
        };
        ProjectCreated: {
            project: components["schemas"]["AdminProject"];
            /** @description Verifies the webhooks and signed storage requests. Shown here once; `GET …/webhook-secret` reads it again. */
            webhookSecret: string;
        };
        ProjectPatch: {
            name?: string;
            priority?: components["schemas"]["Priority"];
            /** @description `null` removes it. */
            webhookUrl?: string | null;
            /** @description Merged into the current settings. A setting set to `null` goes back to its default. */
            settings?: {
                [key: string]: unknown;
            };
            /** @description A disabled project's keys are refused. */
            disabled?: boolean;
        };
        WebhookSecret: {
            webhookSecret: string;
            /**
             * Format: date-time
             * @description Set while the previous secret is in its grace period after a rotation: when it expires. Until then, Eclair signs with both secrets.
             */
            previousSecretExpiresAt?: string;
        };
        WebhookSecretRotation: {
            /** @description Seconds the previous secret stays valid, at most 7 days. 86400 (24 hours) when not set; `0` drops it at once. */
            grace?: number;
        };
        /** @enum {string} */
        Scope: "jobs:read" | "jobs:write" | "presets:write";
        ApiKey: {
            id: string;
            name: string;
            /** @description The start of the key, to recognize it. */
            prefix: string;
            scopes: components["schemas"]["Scope"][];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastUsedAt: string | null;
            revoked: boolean;
        };
        ApiKeyList: {
            data: components["schemas"]["ApiKey"][];
        };
        ApiKeyRequest: {
            name?: string;
            /** @description Every scope when not set. */
            scopes?: components["schemas"]["Scope"][];
        };
        ApiKeyCreated: {
            key: components["schemas"]["ApiKey"];
            /** @description The key, shown once: only its hash is kept. */
            token: string;
        };
        /** @description A storage's kind and configuration. `s3`: `bucket`, `region` (`us-east-1`), `endpoint`, `prefix`, `accessKeyId`, `secretAccessKey`, `forcePathStyle`. `http`: `url`. The configuration is encrypted and never shown again. */
        StorageRequest: {
            /** @enum {string} */
            kind: "s3" | "http";
            config: {
                [key: string]: unknown;
            };
        };
        /** @description A storage, without its credentials. */
        Storage: {
            name: components["schemas"]["StorageName"];
            /** @enum {string} */
            kind: "s3" | "http";
            /** @description Where it points: `s3://bucket/prefix (endpoint)` or the URL. */
            location: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        StorageList: {
            data: components["schemas"]["Storage"][];
        };
        UsageLine: {
            /** @description The project's slug. */
            project: string;
            /**
             * Format: date
             * @description UTC day.
             */
            day: string;
            tasks: number;
            /** @description Wall-clock time of the tasks, for now. */
            cpuSeconds: number;
            mediaSeconds: number;
            bytesIn: number;
            bytesOut: number;
            /** @description Bytes written to the temporary storage. */
            bytesStored: number;
        };
        UsageReport: {
            data: components["schemas"]["UsageLine"][];
        };
    };
    responses: {
        /** @description No API key, or an unknown or revoked one. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The key doesn't have the scope, or the project may not use this operation or provider. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Not found in this project. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The `Idempotency-Key` was used with another body. */
        IdempotencyConflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The request is invalid. `errors` lists the messages by JSON pointer. */
        Invalid: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The project reached one of its limits. */
        TooManyRequests: {
            headers: {
                /** @description Seconds to wait before trying again. */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Received. Any other answer is retried. */
        WebhookReceived: {
            headers: {
                [name: string]: unknown;
            };
            content?: never;
        };
        /** @description The file is larger than the project's limit for direct uploads. Use a resumable upload, or a URL or storage input. */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description No admin token, or the wrong one. */
        AdminUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description It conflicts with what exists: a project slug is taken. */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        JobId: components["schemas"]["JobId"];
        /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
        PresetName: components["schemas"]["PresetName"];
        /** @description Makes the request safe to retry. A replay with the same key and body returns the first response. The same key with another body is refused. */
        IdempotencyKey: string;
        /** @description The `nextCursor` of the previous page. */
        Cursor: string;
        /** @description Items per page. */
        Limit: number;
        EclairEvent: components["schemas"]["WebhookEvent"];
        /** @description Id of the delivery. Retries keep it: use it to ignore duplicates. */
        EclairDelivery: string;
        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
        EclairSignature: components["schemas"]["Signature"];
        /** @description Id of the job the file belongs to. */
        EclairJob: components["schemas"]["JobId"];
        /** @description SHA-256 of the body, in hex. */
        EclairContentSha256: string;
        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
        EclairStorageSignature: components["schemas"]["Signature"];
        UploadId: components["schemas"]["UploadId"];
        /** @description tus protocol version. */
        TusResumable: "1.0.0";
        /** @description The project's id or slug. */
        Project: string;
        /** @description Name of one of the project's storages. */
        StorageNameParameter: components["schemas"]["StorageName"];
    };
    requestBodies: never;
    headers: never;
    pathItems: {
        JobWebhook: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            get?: never;
            put?: never;
            /**
             * A job ended
             * @description Sent to the job's webhook URL when it ends. Retried with exponential backoff for 24 hours until the receiver answers `2xx`. Receivers must accept duplicates.
             */
            post: {
                parameters: {
                    query?: never;
                    header: {
                        "Eclair-Event": components["parameters"]["EclairEvent"];
                        /** @description Id of the delivery. Retries keep it: use it to ignore duplicates. */
                        "Eclair-Delivery": components["parameters"]["EclairDelivery"];
                        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
                        "Eclair-Signature": components["parameters"]["EclairSignature"];
                    };
                    path?: never;
                    cookie?: never;
                };
                /** @description The job, as `GET /v1/jobs/{id}` returns it. */
                requestBody: {
                    content: {
                        "application/json": components["schemas"]["Job"];
                    };
                };
                responses: {
                    "2XX": components["responses"]["WebhookReceived"];
                };
            };
            delete?: never;
            options?: never;
            head?: never;
            patch?: never;
            trace?: never;
        };
    };
}
export type $defs = Record<string, never>;
export interface operations {
    listJobs: {
        parameters: {
            query?: {
                /** @description Only jobs with one of these statuses. */
                status?: components["schemas"]["JobStatus"][];
                /** @description Only jobs created after this time. */
                createdAfter?: string;
                /** @description Only jobs whose `metadata` has these top-level values: `metadata[mediaId]=42`. Compares as strings. */
                metadata?: {
                    [key: string]: string;
                };
                /** @description The `nextCursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Items per page. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of jobs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Invalid"];
        };
    };
    createJob: {
        parameters: {
            query?: never;
            header?: {
                /** @description Makes the request safe to retry. A replay with the same key and body returns the first response. The same key with another body is refused. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JobRequest"];
            };
        };
        responses: {
            /** @description The job is accepted. A replay with the same `Idempotency-Key` and body returns the first response. */
            202: {
                headers: {
                    /** @description URL of the job. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["IdempotencyConflict"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The job, its tasks and their outputs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    cancelJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The job. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    retryJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The job, running again. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description The job is still running, or has no failed or canceled task. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    streamJobEvents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An event stream. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listJobFiles: {
        parameters: {
            query?: {
                /** @description Only the files of this task. */
                task?: components["schemas"]["TaskName"];
                /** @description The `nextCursor` of the previous page. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Items per page. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                id: components["parameters"]["JobId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of files. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobFileList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    probe: {
        parameters: {
            query?: {
                /** @description With a file body: seconds to wait before answering `202`. */
                timeout?: number;
                /** @description With a file body: add a SHA-256 of the whole file. */
                checksum?: boolean;
                /** @description With a file body: add a ThumbHash placeholder of an image. */
                thumbhash?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProbeRequest"];
                "multipart/form-data": {
                    file: string;
                };
                "*/*": string;
            };
        };
        responses: {
            /** @description The metadata. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProbeResult"];
                };
            };
            /** @description The probe takes longer than `timeout`. Follow the job: its `probe` task gives the metadata, and its webhook is sent when it ends. */
            202: {
                headers: {
                    /** @description URL of the job. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            /** @description The request is invalid, the file can't be read, or its type isn't supported. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    createUpload: {
        parameters: {
            query?: {
                /** @description Probe the file in the same request and add `metadata` to the upload. Not for resumable uploads. */
                probe?: boolean;
            };
            header?: {
                /** @description For a resumable upload: the tus protocol version. */
                "Tus-Resumable"?: "1.0.0";
                /** @description For a resumable upload: the file's size in bytes. */
                "Upload-Length"?: number;
                /** @description For a resumable upload: tus metadata (`filename`, `filetype`), base64-encoded. Hints only. */
                "Upload-Metadata"?: string;
            };
            path?: never;
            cookie?: never;
        };
        /** @description The file, except for a resumable upload. */
        requestBody?: {
            content: {
                "multipart/form-data": {
                    file: string;
                };
                "*/*": string;
            };
        };
        responses: {
            /** @description The upload is created. For a direct upload, the body is the upload. For a resumable upload, the body is empty and `Location` is where to send the chunks. */
            201: {
                headers: {
                    /** @description URL of the upload. */
                    Location?: string;
                    /** @description For a resumable upload. */
                    "Tus-Resumable"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Upload"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["UploadId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The upload. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Upload"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deleteUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["UploadId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The upload was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getUploadOffset: {
        parameters: {
            query?: never;
            header: {
                /** @description tus protocol version. */
                "Tus-Resumable": components["parameters"]["TusResumable"];
            };
            path: {
                id: components["parameters"]["UploadId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The upload's progress. */
            200: {
                headers: {
                    "Upload-Offset"?: number;
                    "Upload-Length"?: number;
                    "Tus-Resumable"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    appendUpload: {
        parameters: {
            query?: never;
            header: {
                /** @description tus protocol version. */
                "Tus-Resumable": components["parameters"]["TusResumable"];
                /** @description Bytes received so far, as returned by `HEAD`. */
                "Upload-Offset": number;
            };
            path: {
                id: components["parameters"]["UploadId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/offset+octet-stream": string;
            };
        };
        responses: {
            /** @description The chunk is stored. */
            204: {
                headers: {
                    /** @description Bytes received so far. */
                    "Upload-Offset"?: number;
                    "Tus-Resumable"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description `Upload-Offset` doesn't match the bytes received. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
        };
    };
    listPresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every preset the project can use. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getPreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The preset. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preset"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    putPreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PresetRequest"];
            };
        };
        responses: {
            /** @description The preset was replaced. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preset"];
                };
            };
            /** @description The preset was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preset"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Invalid"];
        };
    };
    deletePreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The preset was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listOperations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The operations. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    downloadFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description From the `url` of an `OutputFile`. */
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The file. `Content-Type` is its detected type. */
            200: {
                headers: {
                    /** @description Bytes. */
                    "Content-Length"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "*/*": string;
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    adminListProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The projects, by slug. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProjectList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
        };
    };
    adminCreateProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectRequest"];
            };
        };
        responses: {
            /** @description The project, and its webhook secret. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectCreated"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Invalid"];
        };
    };
    adminGetProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The project. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProject"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminDeleteProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted, with its keys, storages, presets, jobs, uploads and usage. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminUpdateProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectPatch"];
            };
        };
        responses: {
            /** @description The project. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProject"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminGetWebhookSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The secret. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookSecret"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminRotateWebhookSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["WebhookSecretRotation"];
            };
        };
        responses: {
            /** @description The new secret, and when the previous one expires. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookSecret"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminListKeys: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The keys, without the keys themselves. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminCreateKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyRequest"];
            };
        };
        responses: {
            /** @description The key, shown once. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyCreated"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminRevokeKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The key's id. */
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The revoked key. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKey"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminListStorages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The storages, without their credentials. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StorageList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminPutStorage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
                /** @description Name of one of the project's storages. */
                storage: components["parameters"]["StorageNameParameter"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StorageRequest"];
            };
        };
        responses: {
            /** @description The storage. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Storage"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminDeleteStorage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id or slug. */
                project: components["parameters"]["Project"];
                /** @description Name of one of the project's storages. */
                storage: components["parameters"]["StorageNameParameter"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminListPresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The global presets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
        };
    };
    adminPutPreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PresetRequest"];
            };
        };
        responses: {
            /** @description The preset was replaced. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preset"];
                };
            };
            /** @description The preset was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preset"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            422: components["responses"]["Invalid"];
        };
    };
    adminDeletePreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Preset name. A `/` in it is encoded as `%2F`: `/v1/presets/mediatheque%2Fvideo`. */
                name: components["parameters"]["PresetName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminUsage: {
        parameters: {
            query?: {
                /** @description Only this project, by id or slug. */
                project?: string;
                /** @description Days back from now. */
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Usage per project and UTC day, by project then day. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UsageReport"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    taskCompletedWebhook: {
        parameters: {
            query?: never;
            header: {
                "Eclair-Event": components["parameters"]["EclairEvent"];
                /** @description Id of the delivery. Retries keep it: use it to ignore duplicates. */
                "Eclair-Delivery": components["parameters"]["EclairDelivery"];
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
                "Eclair-Signature": components["parameters"]["EclairSignature"];
                /** @description Name of the task that completed. */
                "Eclair-Task": components["schemas"]["TaskName"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Job"];
            };
        };
        responses: {
            "2XX": components["responses"]["WebhookReceived"];
        };
    };
    httpStorageWrite: {
        parameters: {
            query?: never;
            header: {
                /** @description Id of the job the file belongs to. */
                "Eclair-Job": components["parameters"]["EclairJob"];
                /** @description SHA-256 of the body, in hex. */
                "Eclair-Content-Sha256": components["parameters"]["EclairContentSha256"];
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
                "Eclair-Signature": components["parameters"]["EclairStorageSignature"];
            };
            path?: never;
            cookie?: never;
        };
        /** @description The file. `Content-Type` is its detected mime type. */
        requestBody: {
            content: {
                "*/*": string;
            };
        };
        responses: {
            /** @description The file is stored. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    httpStorageRead: {
        parameters: {
            query?: never;
            header: {
                /** @description Id of the job the file belongs to. */
                "Eclair-Job": components["parameters"]["EclairJob"];
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. After a rotation, another `v1` value signs with the previous secret until its grace period ends: accept the request if one `v1` matches. Refuse timestamps older than five minutes. */
                "Eclair-Signature": components["parameters"]["EclairStorageSignature"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "*/*": string;
                };
            };
            /** @description No file at this path. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
