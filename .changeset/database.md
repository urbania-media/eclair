---
'@eclair-js/server': minor
---

Add the database layer on MySQL, PostgreSQL and SQLite: the first migration (projects, API keys, storages, presets, jobs, tasks, outputs, uploads, usage and webhook deliveries), `eclair migrate` and `eclair migrate --status`. The API refuses to start while a migration is pending, and `/ready` pings the database.
