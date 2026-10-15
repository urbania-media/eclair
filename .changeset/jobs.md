---
'@eclair-js/server': minor
---

Add jobs and the scheduler. `POST /v1/jobs` resolves the preset and the inline tasks, checks the operations, their options, the graph, the input and the output target, all errors at once, and supports `Idempotency-Key`. `GET /v1/jobs`, `GET /v1/jobs/{id}`, `GET /v1/jobs/{id}/files`, `POST /v1/jobs/{id}/cancel` and `POST /v1/jobs/{id}/retry` follow the protocol. The scheduler enqueues tasks in BullMQ, one queue per capability, with the project's and the job's priority, and propagates failures and skips. The API now needs `REDIS_URL`.
