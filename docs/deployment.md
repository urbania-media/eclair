# Deployment

Eclair runs from one Docker image, `ghcr.io/urbania-media/eclair`, next to MySQL or PostgreSQL, and Redis. Start with everything on one server, then add worker servers as the load grows.

## The image

- Node 24, `@eclair-js/server` and the built-in operations.
- Binaries: ffmpeg and ffprobe, ImageMagick (with HEIC, AVIF and WebP), libvips, Ghostscript and poppler, audiowaveform, fonttools (with WOFF2 support), whisper.cpp. Versions are pinned and listed in the release notes.
- Restrictive ImageMagick and Ghostscript policies.
- Runs as a non-root user. The only writable path is the temporary directory (`ECLAIR_TMP_DIR`).
- A `-gpu` variant adds CUDA, ffmpeg with NVENC, and whisper.cpp built for CUDA.

The image takes one argument:

```bash
docker run ghcr.io/urbania-media/eclair api       # API and scheduler
docker run ghcr.io/urbania-media/eclair worker    # worker for ECLAIR_QUEUES
docker run ghcr.io/urbania-media/eclair all       # both, for a single server
docker run ghcr.io/urbania-media/eclair eclair …  # CLI
```

## One server

`docker/compose.yml` runs Eclair in `all` mode with PostgreSQL and Redis. `docker/compose.mysql.yml` does the same with MySQL:

```bash
cp .env.example .env            # set ECLAIR_SECRET_KEY, ECLAIR_ADMIN_TOKEN, ECLAIR_PUBLIC_URL
docker compose up -d
docker compose exec eclair eclair migrate
docker compose exec eclair eclair projects:create my-site
docker compose exec eclair eclair keys:create my-site
```

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
- The database and Redis can be managed services. Use the database you already run: MySQL 8.4+ or PostgreSQL 15+.
- A worker that stops gracefully (`SIGTERM`) finishes its running tasks, up to a timeout, and takes no new ones. A worker that dies has its tasks retried by another worker.

## Configuration

Environment variables, with defaults in `.env.example`:

| Variable                  | Content                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`            | Database connection: `mysql://…` or `postgres://…`                         |
| `REDIS_URL`               | Redis connection                                                           |
| `ECLAIR_SECRET_KEY`       | Key that encrypts storage credentials and provider keys. Keep it safe: losing it means registering storages again. |
| `ECLAIR_ADMIN_TOKEN`      | Token for the admin API and the CLI                                        |
| `ECLAIR_PUBLIC_URL`       | Public URL of the API                                                      |
| `ECLAIR_QUEUES`           | Queues a worker serves, with optional concurrency: `cpu:4,video:1`. Every worker also serves `probe` with reserved slots, unless `probe:0` |
| `ECLAIR_TMP_DIR`          | Temporary directory for tasks                                              |
| `ECLAIR_TEMP_STORAGE`     | Temporary storage backend: a local path (`file:///data/eclair`) on a single server, or an S3-compatible bucket (`s3://…`) when there are several |
| `ECLAIR_TEMP_RETENTION`   | Default retention of temporary files (`24h`), and `ECLAIR_TEMP_MAX_RETENTION` for the per-project maximum |
| `ECLAIR_PLUGINS`          | Extra operation packages to load                                           |
| `ECLAIR_MAX_INPUT_SIZE`   | Default input size limit, overridable per project                          |
| `ECLAIR_TASK_TIMEOUT`     | Default task timeout, overridable per operation and per project            |
| `ECLAIR_JOB_RETENTION`    | How long ended jobs are kept                                               |
| `FFMPEG_BIN`, `MAGICK_BIN`… | Binary paths, when not on `PATH`                                         |

Projects, keys, storages, presets and limits live in the database and are managed with the CLI or the admin API.

## Running without Docker

Supported but not the default: install Node 24, `npm install -g @eclair-js/server`, the binaries listed above, and run `eclair api` and `eclair worker` as services. `eclair doctor` checks that the binaries are there and recent enough.

## Upgrades

- Read the changelog, then pull the new image.
- Run `eclair migrate` once, from one container. Migrations are additive within a major version, so old and new workers can run side by side during a rolling upgrade.
- Restart the API, then the workers.

## Backups and monitoring

- Back up the database. The temporary storage doesn't need backups. Redis only holds queues and can be rebuilt by the scheduler.
- Scrape `/metrics` with Prometheus. Alert on queue wait time, task failure rate per operation, webhook delivery failures and free space in the temporary directory.
