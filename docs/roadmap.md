# Roadmap

The plan is tracked in [#1](https://github.com/urbania-media/eclair/issues/1). Each item becomes a sub-issue of #1 when work on it starts. This page explains the phases; the issue is the reference for progress.

## Phase 0: foundation

- Project docs: README, `AGENTS.md`, architecture, protocol, operations, deployment, decisions (this page).
- Tooling: npm workspaces, TypeScript `strict`, Vitest, ESLint and Prettier, changesets, GitHub Actions CI, `.nvmrc`.
- Settle the open choices: HTTP framework, database access, options schema library (one decision record each).
- `@eclair-js/protocol`: first OpenAPI document and JSON Schemas for jobs, tasks, webhooks and errors.
- Docker image with the binaries, built and scanned in CI.
- Claim the `@eclair-js` npm organization.

## Phase 1: core

- PostgreSQL schema and migrations. Projects, API keys, storages and presets, with the CLI and the admin API.
- `POST /v1/jobs`, `GET /v1/jobs/{id}`, list, cancel, retry, server-sent events.
- Scheduler and workers on BullMQ: dependencies, retries, timeouts, capabilities, per-project priority and concurrency.
- Storages: `https` inputs with the SSRF guard, `s3` inputs and outputs, `http` storages.
- Signed webhooks with retries.
- `@eclair-js/operation`: interface, context, plugin loading, test helpers.
- `probe`.
- Usage records, Prometheus metrics, health checks, `eclair doctor`.
- `docker/compose.yml` for a single server.

## Phase 2: mediatheque parity

The operations that `laravel-mediatheque` runs today, with the same outputs:

- `video.transcode`, `video.thumbnails`, `video.poster`, `video.hls`;
- `audio.transcode`, `audio.waveform`;
- `document.thumbnails`;
- `font.convert`;
- `image.convert`, `image.thumbnail`, `image.palette`;
- the `web-*` and `mediatheque/*` presets.

## Phase 3: clients and first application

- `@eclair-js/client` (JavaScript).
- `folklore/laravel-eclair` (PHP), in its own repository.
- The opt-in `eclair` driver in a `laravel-mediatheque` 1.x minor release.
- Deploy a shared Eclair and move a pilot application to it, one type at a time.
- Operations guide: sizing, monitoring, upgrades, incidents.

## Phase 4: AI and advanced operations

- `ai.transcribe` with `local-whisper`, then external providers (opt-in per project).
- `image.focus` with `local-vision`, `image.blurhash`.
- `video.clip`, `audio.clip`, `video.animated`, `video.storyboard`, `video.scenes`.
- `video.reframe` (vertical and square versions).
- `ai.highlights` (suggested extracts).
- GPU image and GPU workers.

## 1.0

Eclair 1.0 ships when:

- phases 0 to 3 are done, and `ai.transcribe` from phase 4;
- the pilot application has run on Eclair in production for at least a month;
- the protocol is frozen at `v1`, and the operation interface is stable;
- the docs cover installing, operating and extending Eclair.

The `v1.x` maintenance branch is created at 1.0.0. The other phase 4 operations can ship in 1.x.

## Later

- Web dashboard: projects, jobs, failures, usage and costs per project.
- More moving applications from local processing to Eclair, then other mediatheque consumers.
- Usage reports per project and per month, to split the server's cost.
- `document.text`, `document.pdf`, `image.describe`.
- Mediatheque 2.0: Eclair as an implementation of the `Transcoder` contract.

## Open questions

- **Applications without S3.** The `http` storage uploads outputs to the application. Is it enough, or does Eclair also need a temporary area where applications pick up their outputs?
- **Metadata on upload.** The mediatheque reads some metadata synchronously when a media is created. With Eclair, it arrives with the pipeline. Which consumers rely on it being there right after upload?
- **Fair scheduling.** Priority and per-project concurrency in BullMQ are enough to start. A busy shared server may need weighted fair queuing between projects.
- **GPU.** Is a GPU worker worth its cost for transcription and NVENC, compared to CPU workers? To measure in phase 4.
- **Pilot application.** Which one goes first.
