# 0001: TypeScript on Node 24

- Status: accepted
- Date: 2026-10-15

## Context

Eclair spends most of its time waiting on external binaries (ffmpeg, ImageMagick, whisper.cpp). The language of the server matters for orchestration, I/O and maintainability more than for raw speed. The team that maintains it writes TypeScript (`folklore-js`, `panneau-js`) and PHP. Go and Rust were considered for their single binaries, PHP to reuse the `laravel-mediatheque` jobs.

## Decision

- Eclair is written in **TypeScript on Node 24**, ESM only, `strict` with `noUncheckedIndexedAccess`.
- It follows the Node policy of the other Folklore projects: Node 24 now, the next LTS within six months of its release.
- Heavy work stays in native binaries called as subprocesses, never reimplemented in JavaScript.

## Consequences

- The same people can maintain Eclair, its JS client and the operations.
- Operation plugins are npm packages.
- Deployment is simple through the Docker image (see [0006](0006-docker-image-and-roles.md)), even without a single binary.
