# 0011: Temporary storage for uploads and outputs

- Status: accepted
- Date: 2026-10-15
- Amends: [0002](0002-files-stay-in-project-storage.md)

## Context

[0002](0002-files-stay-in-project-storage.md) keeps every file in the project's storage. Applications that keep their files on their own disk would then depend on the `http` storage alone: every output goes through the application, and the application must be reachable from the workers. Workers on different servers also need a way to pass intermediate files to each other, and a synchronous probe ([0012](0012-synchronous-probe.md)) needs somewhere to put a file that the application sends directly.

## Decision

- Eclair has a **temporary storage**, available to every project under the reserved name `eclair`, next to the project's own `s3` and `http` storages. The project picks one per job, for inputs and for outputs.
- **Uploads.** An application can send a file directly to Eclair (`POST /v1/uploads`) and use it as a job input or probe it. Large files use resumable uploads.
- **Outputs.** A job can write its outputs to the temporary storage. The job and the webhook then give a signed download URL for each file, valid until the files expire. The application downloads what it keeps.
- **Retention.** Files expire after a retention period: 24 hours by default, configurable per project up to a maximum set by the operator. Expired files are deleted, and the job records that they are gone.
- **Backend.** The operator chooses it: a local directory for a single server, or an S3-compatible bucket when there are several servers.
- **Intermediate files** (`"keep": false`) and files passed between workers on different servers go through the temporary storage.
- Files are stored under the project's id. Downloads need a signed URL or the project's key, and the storage can't be listed.

## Consequences

- Applications without S3 have two options: `http` push to the application, or pickup from the temporary storage. Both stay supported.
- Eclair holds media for a short time. Its disk or bucket has to be sized for the retention period, and the bytes kept are added to the project's usage.
- The rule from 0002 becomes: Eclair doesn't keep media **beyond the retention period**. The project's storage remains the only durable place.
- The temporary storage is never a CDN origin. Its URLs are for the application's servers, not for end users.
