# 0007: MySQL or PostgreSQL for state, Redis and BullMQ for queues

- Status: accepted
- Date: 2026-10-15

## Context

Eclair needs durable state (projects, keys, credentials, jobs, usage history) and a fast queue with retries, priorities, delays and progress. Redis alone would lose history and accounting. SQLite would tie the API to one server.

The servers that will run Eclair already run MySQL or PostgreSQL, depending on their history. Requiring one of them would mean installing and backing up a second database server just for Eclair.

## Decision

- **A SQL database holds the durable state**: projects, keys, storages, presets, jobs, tasks, outputs, usage and webhook deliveries. Eclair supports **MySQL 8.4 or later** and **PostgreSQL 15 or later**, chosen with `DATABASE_URL` (`mysql://…` or `postgres://…`). Both are first-class: same features, same tests.
- **Redis with BullMQ** holds the queues, progress, locks and rate limits.
- The database is the source of truth. If Redis loses its data, the scheduler enqueues the tasks again from the database.
- Ended jobs are pruned after a retention period. Usage is aggregated per project and per day first.

To keep both databases working:

- **Database access goes through a query builder that supports both dialects** (Kysely is the likely choice, to confirm in Phase 0). No ORM, no raw SQL outside a small dialect module.
- **Migrations use the query builder's schema API**, not dialect SQL. Each migration runs on both databases in CI.
- **Portable types only:**
    - ids are prefixed ULIDs in `varchar` columns, with a binary collation on MySQL;
    - JSON in `json` columns (not `jsonb`), queried through helpers in the dialect module;
    - timestamps in UTC with millisecond precision;
    - booleans, enums and limits that both databases store the same way. Status values are `varchar`, not native enums.
- **Indexed text columns stay short** (255 characters at most), within MySQL's index limits with `utf8mb4`.
- **Concurrency uses `SELECT … FOR UPDATE SKIP LOCKED`** and transactions, which both databases support. No advisory locks, `LISTEN/NOTIFY` or other dialect-only features: Redis handles notifications and locks.
- CI runs the test suite against both databases.

## Consequences

- An operator uses the database they already run, managed or not.
- Some PostgreSQL features (`jsonb` indexes, partial indexes, `RETURNING` everywhere) are off the table, or hidden behind the dialect module with an equivalent on MySQL.
- Filtering jobs by client `metadata` needs a JSON query per dialect. It stays limited to equality on top-level keys.
- MariaDB is not supported at first: its JSON type and locking differ from MySQL's. It can be added later if it passes the same tests.
- Backups only concern the database.
