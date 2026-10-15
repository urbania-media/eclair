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
         * @description Name of one of the project's storages.
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
        Metadata: Record<string, never>;
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
        /** @description The file to process: a URL, or a path in one of the project's storages. */
        Input: components["schemas"]["UrlInput"] | components["schemas"]["StorageInput"];
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
            options?: Record<string, never>;
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
         * @description Stable error code: `input_unreadable`, `unsupported_input`, `timeout`, `limit_exceeded`, `operation_failed`, `storage_failed`, `provider_failed`. New codes can be added: treat unknown ones as `operation_failed`.
         * @example input_unreadable
         * @example unsupported_input
         * @example timeout
         * @example limit_exceeded
         * @example operation_failed
         * @example storage_failed
         * @example provider_failed
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
        };
        TaskOutputs: {
            /** @description Data extracted by the task. Its shape depends on the operation. */
            metadata?: Record<string, never>;
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
            options: Record<string, never>;
        };
        OperationList: {
            data: components["schemas"]["Operation"][];
        };
        /** @enum {string} */
        WebhookEvent: "job.completed" | "job.failed" | "job.canceled" | "task.completed";
        /** @description `t=<unix time>,v1=<hex HMAC-SHA256>`. Several `v1` values can follow: the signature is valid if one of them matches. */
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
        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
        EclairSignature: components["schemas"]["Signature"];
        /** @description Id of the job the file belongs to. */
        EclairJob: components["schemas"]["JobId"];
        /** @description SHA-256 of the body, in hex. */
        EclairContentSha256: string;
        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
        EclairStorageSignature: components["schemas"]["Signature"];
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
                        /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
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
    taskCompletedWebhook: {
        parameters: {
            query?: never;
            header: {
                "Eclair-Event": components["parameters"]["EclairEvent"];
                /** @description Id of the delivery. Retries keep it: use it to ignore duplicates. */
                "Eclair-Delivery": components["parameters"]["EclairDelivery"];
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
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
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
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
                /** @description `t=<unix time>,v1=<hex>`: the HMAC-SHA256 of `{t}.{path}.{sha256 of the body}` with the project's webhook secret. Refuse timestamps older than five minutes. */
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
