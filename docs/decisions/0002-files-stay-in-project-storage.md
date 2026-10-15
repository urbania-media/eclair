# 0002: Files stay in the project's storage

- Status: accepted, amended by [0011](0011-temporary-storage.md)
- Date: 2026-10-15

## Context

A shared processing server could also store and serve media. That would centralize storage costs and make Eclair a CDN origin, but it would also make Eclair hold every project's files, take on delivery, and make leaving it hard. Applications already have storage (S3 buckets, or disks through `laravel-mediatheque` sources).

## Decision

- **Eclair doesn't keep media.** It reads inputs from the project's storage or a URL, and writes outputs to the project's storage.
- Projects register storages: `s3` (any S3-compatible service, credentials scoped to a bucket and prefix) or `http` (an endpoint of the application, signed, provided by `laravel-eclair`).
- Local files on workers are temporary and deleted when a task ends.

## Consequences

- Eclair's cost is compute, plus temporary disk.
- Each project keeps control of its files, their URLs and their retention.
- Eclair holds storage credentials, so they are encrypted at rest and scoped as narrowly as possible.
- Applications without S3 need the `http` storage, which moves every output through the application. Whether that is enough is an open question in the roadmap.
