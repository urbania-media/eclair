# Protocol (draft)

The protocol is the contract between Eclair and its clients. It is published in `@eclair-js/protocol` as an OpenAPI document and JSON Schemas, with generated TypeScript types. The PHP client follows the same documents. This page explains the protocol. The reference is the OpenAPI document, [`packages/protocol/schema/openapi.json`](../packages/protocol/schema/openapi.json), which is still a draft until 1.0.

## Conventions

- Base path `/v1`. Version 1 only changes additively: new fields, endpoints and operations, never removed or renamed ones.
- JSON bodies, `camelCase` keys. Ids are prefixed ULIDs (`job_…`, `tsk_…`, `prj_…`).
- Request bodies refuse unknown fields, so typos are caught. Responses and webhook bodies can gain fields: clients ignore the ones they don't know.
- Authentication: `Authorization: Bearer <key>`.
- Errors use `application/problem+json` (RFC 9457), with an `errors` member for validation errors keyed by JSON pointer.
- `POST` endpoints that create something accept an `Idempotency-Key` header. A replay with the same key and body returns the first response.
- Lists are cursor-paginated: `?cursor=…&limit=…`, with `nextCursor` in the response.

## Jobs

### `POST /v1/jobs`

```json
{
    "input": { "storage": "media", "path": "uploads/interview.mov" },
    "output": { "storage": "media", "prefix": "videos/42/" },
    "preset": "web-video",
    "tasks": {
        "transcript": { "op": "ai.transcribe", "options": { "language": "fr", "formats": ["vtt"] } }
    },
    "webhook": "https://example.com/eclair/webhook",
    "metadata": { "mediaId": 42 },
    "priority": "normal"
}
```

| Field      | Content                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`    | `{ "url": "https://…" }`, `{ "storage": "<name>", "path": "<path>" }` or `{ "upload": "upl_…" }`. Optional `mime` and `size` hints, never trusted.                                 |
| `output`   | `{ "storage": "<name>", "prefix": "<prefix>", "path": "<pattern>" }`. `"storage": "eclair"` writes to the temporary storage. Optional when no task writes files (a `probe` alone). |
| `preset`   | Name of a preset of the project, or of a global preset. Its tasks are merged with `tasks`.                                                                                         |
| `tasks`    | Named tasks. A name is also the output's name, so it is the handle the application reads.                                                                                          |
| `webhook`  | URL called when the job ends. Defaults to the project's webhook.                                                                                                                   |
| `metadata` | Free object, returned as is in the job and the webhook. Used to find the application's record.                                                                                     |
| `priority` | `low`, `normal` or `high`, within the project's limits.                                                                                                                            |
| `failFast` | Cancel the remaining tasks as soon as one fails. Defaults to `false`.                                                                                                              |

A **task**:

```json
{
    "op": "video.hls",
    "from": "h264",
    "options": { "renditions": [{ "height": 1080 }, { "height": 720 }, { "height": 360 }] },
    "after": ["probe"],
    "keep": true,
    "when": { "kind": ["video"] }
}
```

| Field     | Content                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `op`      | Operation name, optionally with a major version (`video.hls@1`).                                                    |
| `from`    | Name of the task whose output is this task's input. Defaults to the job input. `"h264:file"` picks one output file. |
| `options` | Validated against the operation's options schema.                                                                   |
| `after`   | Extra dependencies, for ordering without using an output.                                                           |
| `keep`    | `false` for an intermediate output that is deleted when the job ends. Defaults to `true`.                           |
| `when`    | Run only if the probed input matches (kind, mime, minimum duration…). Otherwise the task is `skipped`.              |

The task graph must be acyclic. The API answers `202` with the job.

### `GET /v1/jobs/{id}`

```json
{
    "id": "job_01JA2Y8C6W4N5V7TQ3H9XK0B2M",
    "status": "completed",
    "createdAt": "2026-10-15T14:00:00Z",
    "endedAt": "2026-10-15T14:03:12Z",
    "metadata": { "mediaId": 42 },
    "tasks": {
        "probe": {
            "status": "completed",
            "op": "probe@1",
            "outputs": {
                "metadata": {
                    "kind": "video",
                    "mime": "video/quicktime",
                    "width": 1920,
                    "height": 1080,
                    "duration": 184.2
                }
            }
        },
        "hls": {
            "status": "completed",
            "op": "video.hls@1",
            "outputs": {
                "files": [
                    {
                        "name": "master",
                        "path": "videos/42/hls/master.m3u8",
                        "mime": "application/vnd.apple.mpegurl",
                        "size": 512,
                        "role": "main"
                    }
                ]
            }
        }
    }
}
```

Job statuses: `pending`, `running`, `completed`, `failed`, `canceled`. Task statuses add `queued` and `skipped`. A failed task has an `error` with a stable `code` (`input_unreadable`, `unsupported_input`, `timeout`, `limit_exceeded`, `operation_failed`, `storage_failed`, `provider_failed`, and `dependency_failed` when a task it depends on failed) and a human `message`. New codes can be added: clients treat unknown ones as `operation_failed`.

Files with many parts (HLS segments, thumbnail series) report their main files and a `count` of the others, not every segment.

The operations that write images (`image.convert`, `image.thumbnail`, `video.poster`, `video.thumbnails`, `audio.waveform`, `document.thumbnails`) take a `thumbhash` option (`false` by default). With `thumbhash: true`, each image file they write has a `thumbhash`: its [ThumbHash](https://evanw.github.io/thumbhash/) placeholder in base64, the one the probe gives the file with `thumbhash: true`. A file that can't be decoded has none, and the task doesn't fail.

Files in the temporary storage also have a signed `url` and an `expiresAt`. An expired file keeps its entry with `"expired": true` and no `url`. `GET /v1/jobs/{id}/files` lists every file of the job, segments included, with fresh signed URLs.

With a bucket as temporary storage, `url` is the bucket's presigned URL. With a local directory, it is `GET /v1/files/{token}` on Eclair: the token is signed by the server and expires with the file, so the download needs no API key. An unknown, expired or changed token is a 404.

### Other job endpoints

- `GET /v1/jobs`: list, filtered by `status`, `createdAfter` and `metadata.*`.
- `POST /v1/jobs/{id}/cancel`: cancel pending and running tasks.
- `POST /v1/jobs/{id}/retry`: run the failed and canceled tasks again.
- `GET /v1/jobs/{id}/events`: server-sent events with status and progress changes.

## Probe

### `POST /v1/probe`

Returns the metadata of a file in the response ([decision 0012](decisions/0012-synchronous-probe.md)).

```json
{
    "input": { "storage": "media", "path": "uploads/interview.mov" },
    "timeout": 10,
    "checksum": false,
    "thumbhash": false
}
```

The input takes the same forms as a job input. The file can also be sent as the request body (`multipart/form-data` or the raw file with its `Content-Type`), up to the project's direct upload limit.

- `200` with `{ "metadata": { … } }`, the same object as the `probe` operation's output.
- `202` with a job when the probe takes longer than `timeout` (10 seconds by default, 30 at most). The result comes with the job and its webhook.
- `422` when the file can't be read or its type isn't supported.

`checksum: true` adds a SHA-256 of the whole file, which reads all of it and can take longer.

`thumbhash: true` adds a [ThumbHash](https://evanw.github.io/thumbhash/) placeholder of an image other than SVG, in base64: its first frame, upright, in sRGB, fitted in 100×100. It decodes the image, so it can take longer. An image that can't be decoded has no `thumbhash`, and the probe doesn't fail.

With a file body, `timeout`, `checksum` and `thumbhash` are query parameters.

## Uploads

### `POST /v1/uploads`

Stores a file in the temporary storage ([decision 0011](decisions/0011-temporary-storage.md)). The body is the file (`multipart/form-data` or raw). Larger files use resumable uploads (`POST /v1/uploads` with `Upload-Length`, then `PATCH` chunks, following the tus protocol).

```json
{
    "id": "upl_01JA2Y9F3K8M2R6T4V7W9X1Z3B",
    "size": 48213904,
    "expiresAt": "2026-10-16T14:00:00Z",
    "metadata": { "kind": "video", "mime": "video/quicktime", "duration": 184.2 }
}
```

`?probe=1` probes the file in the same request and adds `metadata`. The upload id is then used as a job or probe input: `{ "upload": "upl_01JA2Y9F3K8M2R6T4V7W9X1Z3B" }`.

- `GET /v1/uploads/{id}` and `DELETE /v1/uploads/{id}`.

## Presets

- `GET /v1/presets`, `GET /v1/presets/{name}`: the project's presets, the global ones, and the built-in ones that ship with the server (shown as global).
- `PUT /v1/presets/{name}`, `DELETE /v1/presets/{name}`: the project's own presets (key scope `presets:write`).

A preset is a stored `{ "tasks": { … } }` object. A job that uses it records the preset's version.

## Operations

- `GET /v1/operations`: the operations this server provides and this project may use, with their version, accepted inputs, outputs and options schema. Clients can build forms or validate locally from it.

## Webhooks

`POST` to the job's webhook URL when it ends:

```
Content-Type: application/json
Eclair-Event: job.completed
Eclair-Delivery: whd_01J…
Eclair-Signature: t=1760536992,v1=5257a869e7…
```

The body is the job, as returned by `GET /v1/jobs/{id}`. The signature is the HMAC-SHA256 of `{t}.{body}` with the project's webhook secret. Receivers check it and refuse timestamps older than five minutes. After a rotation of the secret, the previous one stays valid for a grace period (24 hours by default, [0018](decisions/0018-webhook-secret-grace-period.md)): until it ends, the header carries one `v1` value per secret (`t=…,v1=<new>,v1=<previous>`), and a receiver accepts the request if one of them matches its secret. Deliveries are retried with exponential backoff for 24 hours. Receivers must accept duplicates, using `Eclair-Delivery` to detect them.

Events: `job.completed`, `job.failed`, `job.canceled`. A project can also subscribe to `task.completed`, to attach outputs as soon as they exist. Its body is also the whole job, and an `Eclair-Task` header names the task that completed.

A project can subscribe to `task.progress` too (`progressWebhooks`), to show how far a task is without holding `GET /v1/jobs/{id}/events` open ([0020](decisions/0020-progress-webhooks.md)). It is sent while a task runs, at most once per task every `progressWebhookInterval` milliseconds (5 seconds by default, at least 1), only when its progress changed, and never once the task has ended. Its body is the whole job, and `Eclair-Task` names the task. A `task.progress` delivery is attempted once and not retried: the next one, or the task's completion, supersedes it. Deliveries can arrive out of order, after `task.completed` included: receivers keep the highest progress they saw for a task, and ignore progress for a task that has ended.

## HTTP storage uploads

With an `http` storage, workers send each output file to the application:

```
PUT {endpoint}/{path}
Content-Type: <mime>
Eclair-Job: job_01J…
Eclair-Signature: t=…,v1=…
```

The signature covers the timestamp, the path and the SHA-256 of the body (sent in `Eclair-Content-Sha256`): the HMAC-SHA256 of `{t}.{path}.{sha256}`, where `path` is the storage path as the job names it, without URL encoding. Inputs are read with a signed `GET` on the same endpoint, where the body's SHA-256 is that of an empty body. Like webhooks, these requests carry a `v1` value for the previous secret during the grace period of a rotation.

## Admin API

Under `/admin/v1`, with the server's admin token (`Authorization: Bearer <ECLAIR_ADMIN_TOKEN>`), never with a project's key. It manages projects, keys, storages, global presets and limits, and reads usage, for tools such as a dashboard. The `eclair` CLI does the same directly on the database, where it runs next to the server.

| Endpoint                                                                          | What it does                                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`, `POST /admin/v1/projects`                                                  | List, create (the response has the webhook secret, once)                                         |
| `GET`, `PATCH`, `DELETE /admin/v1/projects/{project}`                             | Read, change (settings are merged; `null` restores a default), delete with everything it owns    |
| `GET`, `POST /admin/v1/projects/{project}/webhook-secret`                         | Read, replace (`{ "grace": <seconds> }` keeps the previous secret valid, 24 hours by default)    |
| `GET`, `POST /admin/v1/projects/{project}/keys`                                   | List, create (the key is shown once)                                                             |
| `POST /admin/v1/keys/{key}/revoke`                                                | Revoke a key                                                                                     |
| `GET /admin/v1/projects/{project}/storages`, `PUT`, `DELETE …/storages/{storage}` | List without credentials, create or replace, remove                                              |
| `GET /admin/v1/presets`, `PUT`, `DELETE …/presets/{name}`                         | Global presets, built-in ones included. A global preset replaces a built-in one of the same name |
| `GET /admin/v1/usage?project=…&days=30`                                           | Usage per project and UTC day                                                                    |

`{project}` is a project's id or slug.
