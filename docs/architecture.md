# Architecture

## Overview

```
                    ┌──────────────────────────── Eclair ─────────────────────────────┐
                    │                                                                  │
 Application ──────▶│  API ──────── MySQL or PostgreSQL (projects, jobs, usage)        │
  (REST, key)       │   │                                                              │
                    │   └─ scheduler ── Redis / BullMQ ──┬──▶ worker [cpu]            │
 Application ◀──────│  webhooks                          ├──▶ worker [cpu, video]     │
  (signed POST)     │                                    └──▶ worker [gpu, ai]        │
                    │                                              │                   │
                    └──────────────────────────────────────────────┼───────────────────┘
                                                                   │
                                       reads inputs / writes outputs
                                                                   ▼
                                        Project storage (S3-compatible, HTTP)
```

All processes come from one package (`@eclair-js/server`) and one Docker image. A process runs as `api`, `worker` or `all`.

| Component     | Role                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **API**       | Authenticates projects, validates jobs against the protocol, stores them, reports status, serves metrics.   |
| **Scheduler** | Resolves presets, builds the task graph, enqueues tasks whose dependencies are done, ends jobs, sends webhooks. It runs inside the API processes, with a lock in Redis so only one acts on a given job at a time. |
| **Worker**    | Pulls tasks from the queues it is configured for, downloads inputs, runs the operation, uploads outputs, records usage. |
| **CLI**       | `eclair`: migrations, projects, keys, storages, presets, jobs (list, inspect, retry, cancel), `doctor`.      |
| **Database**  | MySQL or PostgreSQL. Durable state: projects, hashed keys, encrypted credentials, presets, jobs, tasks, outputs, usage.            |
| **Redis**     | BullMQ queues, progress, locks and rate limits. Losing Redis loses queued work, not jobs: the scheduler re-enqueues from the database. |

## Life of a job

1. The application calls `POST /v1/jobs` with its API key. The API validates the body (protocol schema, then each task's options against its operation's schema), checks that the operations exist and that the project may use them, and stores the job and its tasks as `pending`. It answers `202` with the job id. An `Idempotency-Key` header makes the call safe to retry.
2. The scheduler enqueues the tasks that have no pending dependency in their operation's queue (`cpu`, `gpu`, `ai`…), with the project's priority.
3. A worker takes a task:
    - It downloads the task's input (the job input, or the output of the task named in `from`) to a temporary directory. It keeps a small local cache, so tasks of the same job on the same worker don't download the original twice.
    - It detects the input's real type from its content.
    - It runs the operation with a timeout, an abort signal and resource limits, and reports progress.
    - It uploads each output file to the project's storage under the job's prefix, at a deterministic path, then records the outputs and the usage (CPU seconds, media duration, bytes in and out).
    - It deletes the temporary directory.
4. When a task ends, the scheduler enqueues the tasks that were waiting for it. A failed task fails the tasks that depend on it. Independent tasks continue unless the job asks to stop on the first failure.
5. When every task has ended, the job is `completed` (or `failed`). The scheduler sends the webhook with the outputs and metadata, and retries it with backoff until the application answers `2xx`.

Applications can also poll `GET /v1/jobs/{id}`, or follow progress with server-sent events.

## Storage

Eclair never keeps media. A project registers one or more **storages**:

| Kind   | Read inputs | Write outputs | Notes                                                                                     |
| ------ | ----------- | ------------- | ----------------------------------------------------------------------------------------- |
| `s3`   | yes         | yes           | Any S3-compatible service. Credentials scoped to a bucket and prefix, encrypted at rest. |
| `http` | yes         | yes           | Outputs are uploaded to an endpoint of the application, signed like webhooks. For applications that store files on their own disk. `laravel-eclair` provides this endpoint. |

An input can also be a plain `https` URL (for example a presigned URL), fetched through the SSRF guard.

Outputs are written under `{prefix}{task}/{file}` by default (for example `videos/42/hls/master.m3u8`). The job can override the path pattern. Intermediate outputs that the application doesn't need (`"keep": false`) are written under a temporary prefix and deleted when the job ends.

## Queues and scaling

- Each operation declares the **capability** it needs: `cpu` (default), `video` (long transcodes), `gpu`, `ai`. Each capability is a BullMQ queue.
- Each worker lists the capabilities it serves (`ECLAIR_QUEUES=cpu,video`) and its concurrency per queue. Adding capacity means starting another worker with the same configuration on another server.
- Projects have a priority and a concurrency limit, so one project's backlog doesn't starve the others.
- Workers only need Redis, the database and the project storages. They don't need to share a disk.

## Data model

| Table       | Content                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `projects`  | Name, slug, priority, limits, allowed operations and providers, webhook secret                   |
| `api_keys`  | Hashed key, prefix for display, project, scopes, last use, revocation                            |
| `storages`  | Project, name, kind, encrypted configuration                                                     |
| `presets`   | Name, optional project (global presets have none), pipeline definition, version                 |
| `jobs`      | Project, status, input, output, resolved pipeline, webhook, client metadata, timestamps         |
| `tasks`     | Job, name, operation and version, options, dependencies, status, attempts, progress, error      |
| `outputs`   | Task, kind (file or metadata), storage path, mime, size, checksum, data                         |
| `usage`     | Project, task, operation, CPU seconds, media seconds, bytes in and out, provider cost if known   |
| `webhook_deliveries` | Job, attempt, status code, next retry                                                   |

Old jobs are pruned after a configurable retention. Usage is aggregated per project and per day before pruning.

## Security

- **Authentication.** Projects authenticate with bearer API keys. Keys are shown once, stored hashed, and can be scoped (create jobs, read jobs, manage presets). The admin API and the CLI use a separate admin token.
- **Isolation.** Every query is scoped to the project of the key. Each task runs in its own temporary directory, and an operation only receives the paths it needs.
- **Inputs.** The SSRF guard resolves the host and refuses private, loopback, link-local and metadata addresses, limits redirects and checks each redirect again. Projects can restrict input hosts to an allow-list. Size and duration limits are checked before and during download.
- **Binaries.** Called with argument arrays, never through a shell. Each run has a timeout, a memory limit and an output-size limit. ImageMagick and Ghostscript use restrictive policy files. SVG and PDF inputs never load external resources.
- **Secrets.** Storage credentials and provider keys are encrypted with `ECLAIR_SECRET_KEY`. Logs never contain keys, credentials or presigned URLs.
- **Webhooks and HTTP uploads** are signed with HMAC-SHA256 over a timestamp and the body, with the project's secret.

## Observability

- Structured JSON logs (pino) with the project, job and task ids on every line.
- Prometheus metrics on `/metrics`: queue depth and wait time per queue, task duration and failures per operation, usage per project.
- `GET /health` (process) and `GET /ready` (database, Redis, binaries).
- `eclair doctor` checks binaries and their versions, models, queues and storages.

## Open choices

To settle in Phase 0, each with a decision record:

- HTTP framework (Fastify is the likely choice: JSON Schema validation and OpenAPI support) and database access (a query builder that supports MySQL and PostgreSQL, such as Kysely, with migrations written with its schema API; see [decision 0007](decisions/0007-sql-database-and-redis.md)).
- Library for options schemas (one that produces JSON Schema, so schemas end up in the OpenAPI document).
- How intermediate files move between workers on different servers when the project storage is `http` only.
