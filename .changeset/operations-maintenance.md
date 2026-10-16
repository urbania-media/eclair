---
'@eclair-js/server': minor
---

Add maintenance, metrics, usage reports and the single-machine guard of SQLite. One API process deletes expired uploads and temporary files, intermediate files of ended jobs and jobs older than `ECLAIR_JOB_RETENTION`, and requeues tasks that Redis lost. `/metrics` serves Prometheus metrics. `eclair usage` sums each project's usage per day. With SQLite, Eclair refuses to start, and `/ready` fails, when another machine runs it on the same Redis. The compose files run the migrations in a `migrate` service and check `/ready`.
