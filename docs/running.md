# Running Eclair

A guide for the operators of a shared Eclair: sizing, monitoring, upgrades, and what to do when something goes wrong. [deployment.md](deployment.md) covers installing it and its configuration.

## Sizing

### Start small, then measure

Start with one server in `all` mode, then size from what Eclair reports: queue wait times, task durations by operation, and the memory and disk used during the heaviest tasks. The numbers below are starting points, not measurements.

| Resource          | What uses it                                                                                                           | Starting point                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CPU               | `cpu` tasks (images, audio, documents, fonts) run one per core by default. ffmpeg uses several cores per `video` task. | 4 cores for a first server. One `video` task per server until you have measured it.                      |
| Memory            | ffmpeg and ImageMagick hold decoded frames and images. 4K video and very large images need the most.                   | 2 GB per concurrent `video` task, plus 1 GB for the API, Redis and the database on the same server.      |
| Temporary disk    | Every task downloads its input to `ECLAIR_TMP_DIR` and writes its outputs there before uploading them.                 | The largest input plus its outputs, times the number of tasks that run at once. A fast local disk.       |
| Temporary storage | Uploads and outputs written to `eclair`, until they expire (`ECLAIR_TEMP_RETENTION`, 24 hours by default).             | What projects upload and leave there in one retention period.                                            |
| Database          | Projects, jobs and their tasks, usage. Ended jobs are deleted after `ECLAIR_JOB_RETENTION` (30 days).                  | Small: a few rows per job. The smallest managed instance is enough to start.                             |
| Redis             | Queue entries, progress events, locks. No media.                                                                       | Small. It must use `maxmemory-policy noeviction`, as the compose files set: BullMQ loses jobs otherwise. |

### Queues and concurrency

Each operation runs on its capability's queue: `cpu`, `video`, `gpu`, `ai`, and `probe` for probes. `ECLAIR_QUEUES` sets the queues a worker serves and how many tasks of each it runs at once:

- `cpu` defaults to the number of cores, other queues to 1. Every worker also serves `probe` with 2 slots, so synchronous probes don't wait behind long tasks (`probe:0` turns it off).
- Concurrency is per worker process. On a server with 16 cores that runs both, `ECLAIR_QUEUES=cpu:8,video:2` leaves room for ffmpeg's own threads.
- A project's `concurrency` (4 by default) caps how many of its tasks run at once over every worker, so one project can't take the whole server. The total of the workers' slots should be above the sum of the concurrency of the projects that are busy at the same time.

### Adding servers

Add workers when tasks wait: one server per capability that is short, with `ECLAIR_QUEUES` set to that capability. Workers don't share a disk. They need the database, Redis, the temporary storage (a bucket, with more than one server) and the projects' storages. Run two API processes behind the reverse proxy for availability. Move from SQLite to MySQL or PostgreSQL before adding a second server ([decision 0016](decisions/0016-sqlite-for-single-machine-installs.md)).

## Monitoring

### Health

- `GET /health` answers `200` while the process runs: use it as a liveness check.
- `GET /ready` checks the database and Redis (and, with SQLite, that no other machine uses the same Redis). It answers `503` with the failed checks, while the reasons go to the logs. Use it as a readiness check and in the load balancer.
- `eclair doctor` checks the configuration, Redis, the database and its schema, and the binaries. Run it after every change to a server.

### Status and stats

The dashboard ([decision 0021](decisions/0021-dashboard-on-panneau.md)) reads the admin API ([protocol](protocol.md#admin-api)), which any tool with the admin token can read too:

- `GET /admin/v1/status` runs the checks of `/ready` and lists the live hosts: every process registers its host in Redis every 10 seconds, with its version and the queues its workers serve, and drops out 30 seconds after it stops. A queue's `waiting` counts the tasks in BullMQ that no worker took, retries waiting for their backoff included; `oldestWaitingAt` comes from the database. `slots` sums the concurrency of the live hosts' workers for the queue: `0` with waiting tasks means that no worker serves it. A local temporary storage gives its files and bytes, unless it holds more than 50,000 files, and the free space of its disk, read at most once a minute. An S3 temporary storage only gives its kind: listing a bucket costs requests, so watch its size at the provider.
- `GET /admin/v1/stats` reads the tasks that ended in the period, by UTC hour (up to 31 days) or day (up to 366 days). The p50 and p95 of an operation are the durations of its completed tasks, from their start to their end. Webhooks and jobs are those created in the period. Jobs older than `ECLAIR_JOB_RETENTION` are gone, with their tasks and webhooks: the stats don't go further back. [Usage](#usage) is kept longer.
- `POST /admin/v1/projects/{project}/storages/{storage}/check` writes a small file under `.eclair/` in an `s3` storage, reads it back and deletes it, with the storage's configuration. An `http` storage is only read: a `GET` of a file that doesn't exist must answer `404`. The message says which step failed and why, never the credentials.

### Metrics

Scrape `/metrics` of every API and worker process with Prometheus, from inside your network only. The alerts to start with:

| Alert                    | Metric                                                                                     | Usually means                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Tasks wait               | `eclair_queue_tasks{state="waiting"}` of a queue stays above zero for 10 minutes and grows | Not enough workers for that queue, or none: see [Tasks don't start](#tasks-dont-start)                                   |
| An operation fails       | The rate of `eclair_tasks_total{outcome="failed"}` for one `operation` against its total   | A missing binary, a bad preset, a project sending files Eclair can't read: see [An operation fails](#an-operation-fails) |
| Tasks slow down          | The 95th percentile of `eclair_task_duration_seconds` for one `operation`                  | Larger inputs, or a server short of CPU, memory or disk speed                                                            |
| Webhooks give up         | `eclair_webhook_deliveries_total{outcome="failed"}` increases                              | An application didn't accept a webhook for 24 hours: see [Webhooks fail](#webhooks-fail)                                 |
| Webhooks are retried     | The rate of `eclair_webhook_deliveries_total{outcome="retried"}`                           | An application's webhook route is down or refuses the signature                                                          |
| Progress is dropped      | The rate of `eclair_webhook_deliveries_total{event="task.progress",outcome="dropped"}`     | An application with `progressWebhooks` refuses them: its route may not know the event yet. Nothing is retried            |
| The temporary disk fills | Free space of `ECLAIR_TMP_DIR` and of the local temporary storage (from the node exporter) | Too many large tasks at once, or a retention too long: see [The disk is full](#the-disk-is-full)                         |
| Eclair is not ready      | `/ready` answers `503`                                                                     | The database or Redis is unreachable                                                                                     |

`eclair_tasks_total` counts outcomes per worker (`completed`, `failed`, `skipped`, `canceled`, `retry`). A task retried after a crash counts once per attempt.

### Logs

Processes log JSON lines to standard output (pino), at `ECLAIR_LOG_LEVEL` (`info` by default). The lines of a task have its `job` and `task` ids and its `operation`: filter on them to follow a job. Eclair doesn't log keys, secrets or storage credentials. The reasons of readiness failures are only in the logs.

### Usage

`eclair usage` sums each project's tasks, task time, media duration and bytes per day ([deployment.md](deployment.md#usage-and-costs)). Look at it before resizing: one project's growth is often the reason.

## Upgrades

Within a major version, upgrades are rolling and need no downtime:

1. Read the changelog. Back up the database.
2. Pull the new image. Pin a version (`1.2` or `1.2.3`) in production, never `latest` or `main`.
3. Run `eclair migrate` once, from one container. Migrations are additive within a major version: the old processes keep working on the new schema.
4. Restart the API processes one at a time, then the workers.

A worker that receives `SIGTERM` stops taking tasks and finishes the ones it runs. Give it as long as your longest task before it is killed: `stop_grace_period` in compose (5 minutes in the provided files), `terminationGracePeriodSeconds` in Kubernetes, `TimeoutStopSec` in systemd. A worker killed earlier leaves its tasks to another worker, which runs them again from the start: the retry is safe, but the time is lost.

To roll back within a major version, run the previous image: its schema is the same or older, and the newer migrations only added to it. Major versions come with an upgrade guide in their release notes.

## Incidents

### Tasks don't start

Jobs stay `pending` and their tasks `queued`.

1. `eclair_queue_tasks{state="waiting"}` by queue says which queue is stuck.
2. Is a worker serving it? Check `ECLAIR_QUEUES` on the workers. A `gpu` or `ai` task waits, without failing, until a worker serves its queue.
3. Is the project at its limit? A project with `concurrency` tasks running waits for one of them to end. `eclair projects:show <project>` shows its settings.
4. Are the workers ready? A worker that can't reach Redis or the database takes nothing.

### An operation fails

1. Find the error code in the failed tasks (`GET /v1/jobs/{id}` or the worker logs): `input_unreadable` and `unsupported_input` come from the files, `timeout` and `limit_exceeded` from the limits, `operation_failed` from the binary, `storage_failed` from a storage.
2. `operation_failed` on every task of an operation, after an upgrade or on a new server: `eclair doctor` on that worker shows a binary that is missing or doesn't run.
3. `timeout`: raise the project's `taskTimeout`, in milliseconds (`eclair projects:update <project> --set taskTimeout=7200000`), or `ECLAIR_TASK_TIMEOUT`, or move the work to a faster server.
4. `storage_failed`: the project's storage refuses Eclair's credentials or is unreachable. Check the storage with the project's owner, then set it again (`eclair storages:set`).

Once fixed, `POST /v1/jobs/{id}/retry` runs the failed tasks of a job again.

### Redis lost its data

Jobs and tasks live in the database, so nothing is lost but queue entries and progress. Within a minute, the maintenance puts every task that is queued in the database but missing from Redis back in its queue. Running tasks finish and report to the database. If Redis restarted without its data, check that it runs with `noeviction` and append-only persistence, as the compose files set.

### The database is down

`/ready` answers `503`, and requests and tasks that need the database fail until it's back. Applications retry their requests, with the same idempotency key for jobs. Check the jobs created around the outage and retry the ones with failed tasks (`POST /v1/jobs/{id}/retry`). Restore from a backup only if its data is lost: jobs created since the backup are then unknown to Eclair, and applications create them again.

### The disk is full

Tasks fail with `operation_failed` or `storage_failed`, and the worker logs say the disk is full.

1. Lower the concurrency of the worker (`ECLAIR_QUEUES`), or give `ECLAIR_TMP_DIR` a larger disk.
2. With the local temporary storage, shorten `ECLAIR_TEMP_RETENTION`, or move it to a bucket.
3. Retry the failed jobs.

A worker deletes a task's local files when the task ends, whether it succeeds or fails. Files left in `ECLAIR_TMP_DIR` after a crash can be deleted while the worker is stopped.

### Webhooks fail

Eclair retries each delivery with exponential backoff for 24 hours, then gives up (`outcome="failed"`).

1. The application's route answers `401`: the application doesn't have the project's current webhook secret (`eclair projects:secret <project>`), or a rotation's grace period ended before it got the new one.
2. It answers `5xx` or times out: the application is down or its listeners fail. Deliveries resume on their own once it answers `2xx`.
3. After 24 hours, the application finds the jobs it missed through the API: `GET /v1/jobs?status=completed&createdAfter=…` (with `laravel-eclair`, `Eclair::jobs()->all([...])`), and handles them as if their webhooks had come.

### A key or a secret leaked

- **An API key:** create a new one (`eclair keys:create`), give it to the application, then revoke the old one (`eclair keys:revoke <key-id>`; `eclair keys:list <project>` lists them).
- **A project's webhook secret:** `eclair projects:secret <project> --rotate` replaces it and prints the new one; give it to the application. The previous secret stays valid for 24 hours ([decision 0018](decisions/0018-webhook-secret-grace-period.md)): until then, Eclair signs webhooks and the requests to the project's `http` storages with both secrets, so nothing is refused while the application is deployed with the new one. A leaked secret stops being a risk as soon as the application only trusts the new one: Eclair never accepts anything signed with it. `--grace 2h` shortens the grace period (at most `7d`), and `--grace 0` drops the previous secret at once, at the cost of refused webhooks and storage requests, which Eclair retries, until the application has the new one.
- **`ECLAIR_SECRET_KEY`:** it decrypts the storages' credentials. Rotate the credentials of every storage with their owners, register them again with a new key, and restart every process with it.
- **`ECLAIR_ADMIN_TOKEN`:** replace it and restart the API processes.

### A project floods the server

One project's tasks fill the queues and the others wait. Lower its `concurrency`, its `probesPerMinute` or its `maxInputSize`, or limit its `operations`, with `eclair projects:update`. Its jobs keep running at the new pace.
