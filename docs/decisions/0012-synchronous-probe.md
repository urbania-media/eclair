# 0012: Synchronous probe for metadata at upload

- Status: accepted
- Date: 2026-10-15

## Context

`laravel-mediatheque` reads a media's type and metadata (dimensions, duration, page count, font name) when the media is created, before the request that uploaded it returns. Applications rely on it: they show or validate the media right away. Jobs are asynchronous, so a `probe` task alone would leave the media without metadata until its pipeline runs.

## Decision

- **`POST /v1/probe` answers synchronously** with the same metadata as the `probe` operation. Its input is a URL, a path on a storage, an upload id, or the file in the request body (up to a size limit).
- It waits up to a timeout (10 seconds by default, 30 at most). When the probe isn't done in time, it answers `202` with a job that the application can poll, and the result comes by webhook as well.
- **Probes are fast by design.** ffprobe and the image readers only read what they need, with HTTP range requests on URLs and storages, so a large video isn't downloaded to read its duration. A full checksum is opt-in, because it reads the whole file.
- Probes run on a dedicated `probe` queue with the highest priority. Every worker serves it by default, with reserved slots, so a backlog of transcodes never delays a probe.
- `POST /v1/uploads` can probe the file it receives in the same request.

## Consequences

- The mediatheque driver can fill the media's type and metadata at upload, as the local readers do today, and the application servers no longer need ffprobe or ImageMagick even for that.
- When Eclair is unreachable, the driver falls back to detecting the mime type locally and lets the pipeline fill the metadata later.
- Probes are rate-limited per project and counted in its usage like other tasks.
- Reserved probe slots take a little capacity away from the other queues.
