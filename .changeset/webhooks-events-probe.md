---
'@eclair-js/server': minor
---

Add webhooks, job events, the synchronous probe and downloads. Jobs that end send a signed webhook through the SSRF guard, retried with backoff for 24 hours (`task.completed` too, with the `taskWebhooks` setting). `GET /v1/jobs/{id}/events` streams status and progress changes. `POST /v1/probe` and `POST /v1/uploads?probe=1` answer with a file's metadata, within `probesPerMinute`. Files in the temporary storage get a signed `url`: the bucket's presigned URL, or `GET /v1/files/{token}` on `ECLAIR_PUBLIC_URL` with a local directory.
