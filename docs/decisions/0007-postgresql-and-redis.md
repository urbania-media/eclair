# 0007: PostgreSQL for state, Redis and BullMQ for queues

- Status: accepted
- Date: 2026-10-15

## Context

Eclair needs durable state (projects, keys, credentials, jobs, usage history) and a fast queue with retries, priorities, delays and progress. Redis alone would lose history and accounting. SQLite would tie the API to one server.

## Decision

- **PostgreSQL** holds the durable state: projects, keys, storages, presets, jobs, tasks, outputs, usage and webhook deliveries.
- **Redis with BullMQ** holds the queues, progress, locks and rate limits.
- PostgreSQL is the source of truth. If Redis loses its data, the scheduler enqueues the tasks again from PostgreSQL.
- Ended jobs are pruned after a retention period. Usage is aggregated per project and per day first.

## Consequences

- A deployment needs both services, either in the compose file or managed.
- Several API processes and many workers can run at the same time.
- Backups only concern PostgreSQL.
