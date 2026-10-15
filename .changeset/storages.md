---
'@eclair-js/server': minor
---

Add storage access and uploads. URL inputs go through an SSRF guard: `https` only, public addresses only (checked again when connecting, against DNS rebinding), checked redirects and the project's `inputHosts`. Storage drivers read and write `s3` storages, `http` storages with signed requests, and the temporary storage (a local directory, or an S3-compatible bucket with `ECLAIR_TEMP_S3_*` credentials). `POST /v1/uploads` takes a raw or multipart body, or a resumable tus upload (`HEAD`, `PATCH`), and `GET` and `DELETE /v1/uploads/{id}` read and remove uploads, which expire.
