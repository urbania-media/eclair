# Deployment

Eclair runs from one Docker image, `ghcr.io/urbania-media/eclair`, next to Redis and a SQL database: MySQL or PostgreSQL, or SQLite on a single server. Start with everything on one server, then add worker servers as the load grows.

## The image

- Node 24, `@eclair-js/server` and the built-in operations.
- Binaries: ffmpeg and ffprobe, ImageMagick (with HEIC, AVIF and WebP), libvips, Ghostscript and poppler, audiowaveform, fonttools (with WOFF2 support), whisper.cpp (without models). Versions are pinned and listed in the release notes. Most come from Debian 13, whose stable releases only take security fixes; audiowaveform and whisper.cpp are built from source.
- Restrictive ImageMagick and Ghostscript policies.
- Runs as a non-root user (`eclair`, uid 10001). Tasks can only write to the temporary directory (`ECLAIR_TMP_DIR`, `/tmp/eclair` by default). The only other writable path is `/var/lib/eclair`, the mount point of the data volume for SQLite and the local temporary storage. The image also runs with a read-only root file system, with volumes on these two paths.
- Built for `linux/amd64`. whisper.cpp needs a CPU with AVX2.
- A `-gpu` variant adds CUDA, ffmpeg with NVENC, and whisper.cpp built for CUDA.

Images are tagged with the version (`1.2.3`, `1.2`, `1`) and `latest` from release tags, and `main` from the development branch. [`docker/smoke-test.sh`](../docker/smoke-test.sh) checks every binary of an image, and CI runs it and scans the image before pushing it.

The image takes one argument:

```bash
docker run ghcr.io/urbania-media/eclair api       # API and scheduler
docker run ghcr.io/urbania-media/eclair worker    # worker for ECLAIR_QUEUES
docker run ghcr.io/urbania-media/eclair all       # both, for a single server
docker run ghcr.io/urbania-media/eclair eclair …  # CLI
```

## One server

`docker/compose.yml` runs Eclair in `all` mode with PostgreSQL and Redis. `docker/compose.mysql.yml` does the same with MySQL (`docker compose -f compose.mysql.yml …`):

```bash
cd docker
cp .env.example .env            # set ECLAIR_SECRET_KEY, ECLAIR_ADMIN_TOKEN, ECLAIR_PUBLIC_URL, DATABASE_PASSWORD
docker compose up -d --wait     # runs the migrations, then Eclair, until /ready answers
docker compose exec eclair eclair projects:create my-site
docker compose exec eclair eclair keys:create my-site
```

On one server, SQLite can replace the database server: set `DATABASE_URL=sqlite:///var/lib/eclair/eclair.db`, with that directory on a volume on a local disk (not a network file system), and leave out the database service. API and worker processes on the same machine can share the file. SQLite suits development, tests and small installs; to grow beyond one server, move to MySQL or PostgreSQL first (see [decision 0016](decisions/0016-sqlite-for-single-machine-installs.md)).

The `migrate` service runs `eclair migrate` before Eclair starts, at every `up`: it does nothing when the schema is up to date. `docker/e2e.sh` runs both compose files end to end with a built image, as the image's CI does.

Put a reverse proxy with TLS in front of the API. The temporary directory should be on a fast local disk with room for the largest input and its outputs, times the worker concurrency.

## Many servers

```
 server A: api (×2) + MySQL or PostgreSQL + Redis
 server B: worker  ECLAIR_QUEUES=cpu,video
 server C: worker  ECLAIR_QUEUES=cpu,video
 server D: worker  ECLAIR_QUEUES=gpu,ai     (image eclair:<version>-gpu)
```

- API processes are stateless. Run several behind the reverse proxy.
- Workers only need the database, Redis, the temporary storage bucket and access to the project storages. They don't share a disk.
- Each operation runs on its capability's queue. A server without a GPU never serves `gpu`, so GPU work waits for a GPU worker instead of failing.
- The database and Redis can be managed services. Use the database you already run: **MySQL 8.4+ or PostgreSQL 15+ is required** with more than one server. SQLite can't be shared between machines, and Eclair refuses to start on SQLite when processes from several hosts use the same Redis.
- A worker that stops gracefully (`SIGTERM`) finishes its running tasks and takes no new ones, until the container's stop timeout. A worker that dies has its tasks retried by another worker.

## Configuration

Environment variables, with defaults in [`docker/.env.example`](../docker/.env.example):

| Variable                                                           | Content                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | Database connection: `mysql://…` or `postgres://…`, or `sqlite:///path/to/eclair.db` on a single server                                                                                                                                                                       |
| `REDIS_URL`                                                        | Redis connection                                                                                                                                                                                                                                                              |
| `ECLAIR_SECRET_KEY`                                                | 32 random bytes in base64 (`eclair key:generate`) that encrypt storage credentials and provider keys. Keep it safe: losing it means registering storages again.                                                                                                               |
| `ECLAIR_ADMIN_TOKEN`                                               | Token for the admin API                                                                                                                                                                                                                                                       |
| `ECLAIR_PUBLIC_URL`                                                | Public URL of the API                                                                                                                                                                                                                                                         |
| `ECLAIR_PORT`                                                      | Port the API listens on (`8080`)                                                                                                                                                                                                                                              |
| `ECLAIR_HOST`                                                      | Address the API listens on (`0.0.0.0`)                                                                                                                                                                                                                                        |
| `ECLAIR_LOG_LEVEL`                                                 | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent`                                                                                                                                                                                                      |
| `ECLAIR_QUEUES`                                                    | Queues a worker serves, with optional concurrency: `cpu:4,video:1`. Every worker also serves `probe` with reserved slots, unless `probe:0`                                                                                                                                    |
| `ECLAIR_TMP_DIR`                                                   | Temporary directory for tasks                                                                                                                                                                                                                                                 |
| `ECLAIR_TEMP_STORAGE`                                              | Temporary storage backend: a local path (`file:///var/lib/eclair/storage`) on a single server, or an S3-compatible bucket when there are several: `s3://bucket/prefix?endpoint=https://tor1.digitaloceanspaces.com&region=tor1` (add `&pathStyle=true` for MinIO and similar) |
| `ECLAIR_TEMP_S3_ACCESS_KEY_ID`, `ECLAIR_TEMP_S3_SECRET_ACCESS_KEY` | Credentials of the bucket of an `s3://` temporary storage. Scope them to that bucket.                                                                                                                                                                                         |
| `ECLAIR_TEMP_RETENTION`                                            | Default retention of temporary files (`24h`), and `ECLAIR_TEMP_MAX_RETENTION` for the per-project maximum                                                                                                                                                                     |
| `ECLAIR_PLUGINS`                                                   | Extra operation packages to load                                                                                                                                                                                                                                              |
| `ECLAIR_MAX_INPUT_SIZE`                                            | Default input size limit (`2GB`; KB, MB, GB and TB are multiples of 1024), overridable per project                                                                                                                                                                            |
| `ECLAIR_TASK_TIMEOUT`                                              | Default task timeout, overridable per operation and per project                                                                                                                                                                                                               |
| `ECLAIR_JOB_RETENTION`                                             | How long ended jobs are kept                                                                                                                                                                                                                                                  |
| `FFMPEG_BIN`, `MAGICK_BIN`…                                        | Binary paths, when not on `PATH`: `FFMPEG_BIN`, `FFPROBE_BIN`, `MAGICK_BIN`, `VIPS_BIN`, `GS_BIN`, `PDFINFO_BIN`, `PDFTOPPM_BIN`, `AUDIOWAVEFORM_BIN`, `FONTTOOLS_BIN`, `WHISPER_BIN`                                                                                         |

Empty variables count as unset. Durations use `ms`, `s`, `m`, `h` or `d` (`1h`, `7d`). An invalid configuration stops the process with the list of every problem, and `eclair doctor` reports them too.

Projects, keys, storages, presets and limits live in the database and are managed with the CLI or the admin API. The CLI runs next to the server, with the same `DATABASE_URL` and `ECLAIR_SECRET_KEY`:

```bash
eclair projects:create niche --name Niche --webhook-url https://niche.example.com/eclair/webhook
eclair projects:update niche --set concurrency=8 --set 'operations=["probe","video.transcode"]'
eclair projects:secret niche            # the webhook secret; --rotate replaces it
eclair keys:create niche --name website --scopes jobs:read,jobs:write
eclair storages:set niche media --kind s3 --config @media-storage.json
eclair presets:set web-video --file web-video.json          # global; --project for a project's own
```

Secrets given on the command line end up in the shell history: pass storage configurations as a file (`@file`) or on standard input (`-`). `eclair --help` lists every command.

## Running without Docker

Supported but not the default: install Node 24, `npm install -g @eclair-js/server`, the binaries listed above, and run `eclair api` and `eclair worker` as services. `eclair doctor` checks that the binaries are there and recent enough.

## Upgrades

See [running.md](running.md#upgrades) for rolling upgrades and rollbacks.

- Read the changelog, then pull the new image.
- Run `eclair migrate` once, from one container (the compose files do it with their `migrate` service). Migrations are additive within a major version, so old and new workers can run side by side during a rolling upgrade.
- Restart the API, then the workers.

## Backups and monitoring

See [running.md](running.md#monitoring) for the alerts to set up and what they mean.

- Back up the database. With SQLite, use `VACUUM INTO` or the SQLite backup API, not a copy of the file while Eclair runs. The temporary storage doesn't need backups. Redis only holds queues and can be rebuilt by the scheduler.
- Scrape `/metrics` with Prometheus: `eclair_queue_tasks` (by queue and state), `eclair_tasks_total` and `eclair_task_duration_seconds` (by operation and outcome), `eclair_jobs_created_total`, `eclair_webhook_deliveries_total`, and the process metrics. Keep `/metrics` off the public internet: let the reverse proxy refuse it from outside. Alert on queue wait time, task failure rate per operation, webhook delivery failures and free space in the temporary directory.
- `GET /ready` checks the database and Redis, and with SQLite that no other machine runs Eclair on the same Redis.

## Maintenance

Every minute, one API process (whichever takes a lock in Redis) cleans up:

- uploads and files of the temporary storage past their expiry;
- the intermediate files (`keep: false`) of the jobs that ended;
- the jobs that ended more than `ECLAIR_JOB_RETENTION` ago, with their files. Their usage stays;
- tasks that are queued in the database but missing from Redis (Redis lost its data, for example): they go back to their queue.

## Usage and costs

`eclair usage` sums the usage of each project per day: tasks, task time, media duration, bytes read, written and kept in the temporary storage. `--project` keeps one project, `--days` sets the period (30 by default), `--json` gives it to a spreadsheet or a script.

```bash
eclair usage --days 31
```

Task time is the wall-clock time of each task; the CPU time of its binaries isn't measured yet.
