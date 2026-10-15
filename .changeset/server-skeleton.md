---
'@eclair-js/server': minor
---

Add the server skeleton: configuration from environment variables (validated, with every problem reported at once), prefixed ULID ids, the Fastify app with `problem+json` errors, `GET /health` and `GET /ready`, and the `eclair` CLI (`api`, `all`, `doctor`, `key:generate`). Workers come with the job queue.
