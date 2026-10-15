import { Type } from 'typebox';
import type { Static } from 'typebox';

/**
 * Settings of a project, stored as JSON on the project. Every setting has a default, so a project
 * created without settings works. Limits that are not set use the server's defaults
 * (`ECLAIR_MAX_INPUT_SIZE`, `ECLAIR_TASK_TIMEOUT`, `ECLAIR_TEMP_RETENTION`).
 */
export const ProjectSettingsSchema = Type.Object(
    {
        /** Tasks of the project that can run at the same time, over every worker. */
        concurrency: Type.Integer({ minimum: 1, maximum: 1000, default: 4 }),
        /** Largest input, in bytes. */
        maxInputSize: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Largest file sent in the body of `POST /v1/probe` or `POST /v1/uploads`, in bytes. */
        maxDirectUpload: Type.Integer({ minimum: 1, default: 100 * 1024 * 1024 }),
        /** Longest a task may run, in milliseconds. */
        taskTimeout: Type.Optional(Type.Integer({ minimum: 1000 })),
        /** How long temporary files are kept, in milliseconds. At most `ECLAIR_TEMP_MAX_RETENTION`. */
        tempRetention: Type.Optional(Type.Integer({ minimum: 60_000 })),
        /** Operations the project may use. All of them when not set. */
        operations: Type.Optional(
            Type.Array(Type.String({ pattern: '^(probe|[a-z][a-z0-9]*\\.[a-z][a-zA-Z0-9]*)$' }), {
                uniqueItems: true,
            }),
        ),
        /** Hosts that `url` inputs may come from (`cdn.example.com`, `*.example.com`). Any public host when not set. */
        inputHosts: Type.Optional(
            Type.Array(
                Type.String({
                    pattern:
                        '^(\\*\\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$',
                }),
                { uniqueItems: true },
            ),
        ),
        /** Probes per minute, synchronous or not. */
        probesPerMinute: Type.Integer({ minimum: 1, default: 600 }),
        /** Sends a `task.completed` webhook for each task, besides the job's. */
        taskWebhooks: Type.Boolean({ default: false }),
    },
    { additionalProperties: false },
);

export type ProjectSettings = Static<typeof ProjectSettingsSchema>;
