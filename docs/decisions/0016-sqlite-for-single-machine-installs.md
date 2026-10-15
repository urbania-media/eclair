# 0016: SQLite for development, tests and single-machine installs

- Status: accepted
- Date: 2026-10-15
- Amends: [0007](0007-sql-database-and-redis.md)

## Context

[0007](0007-sql-database-and-redis.md) supports MySQL 8.4+ and PostgreSQL 15+. Both need a database server, even to try Eclair, run its tests or work on it. Many installs will be one machine running `all`, or one API process next to its workers, where a database server is more to install, back up and upgrade than the job history needs.

SQLite is a file. Node 24 ships it as `node:sqlite`, and Kysely has a SQLite dialect ([0014](0014-kysely.md)). But a file can only be shared by the processes of one machine: workers on other servers and API processes on several hosts can't reach it.

## Decision

- **SQLite is a third supported database, for development, tests and single-machine installs**: `all` mode, or API and worker processes on the same machine. **MySQL 8.4+ and PostgreSQL 15+ stay the recommended choices for production, and are required as soon as Eclair runs on more than one machine.**
- It's selected with `DATABASE_URL=sqlite:///var/lib/eclair/eclair.db` (absolute path), `sqlite:data/eclair.db` (relative to the working directory) or `sqlite::memory:` for tests. A URL with a host is refused, so `sqlite://data/eclair.db` can't be read as the wrong path.
- The driver is `node:sqlite` (see [0014](0014-kysely.md)). Every connection sets `journal_mode = WAL`, so readers don't block the writer, `busy_timeout`, so a process waits for the write lock instead of failing, and `foreign_keys = ON`. The database file has to be on a local disk: WAL doesn't work over network file systems.
- **Claiming tasks without `SKIP LOCKED`.** SQLite has no row locks: one writer holds the database at a time. The dialect module provides the claim:
    - on MySQL and PostgreSQL, a transaction with `SELECT … FOR UPDATE SKIP LOCKED`, as 0007 says;
    - on SQLite, a `BEGIN IMMEDIATE` transaction, which takes the write lock before reading, then the same select and update. Claims from several processes run one after the other, which is fast enough on one machine.
    - In both cases the update is conditional (`WHERE status = 'queued'`) and its row count is checked, so a task is never claimed twice.
    - Kysely compiles `forUpdate().skipLocked()` for SQLite anyway, and SQLite rejects it. Only the dialect module builds these queries.
- **Types** are handled in the dialect module, as for the other two:
    - timestamps are UTC ISO 8601 text with milliseconds (`2026-10-15T14:00:00.000Z`), which sorts and compares correctly as text;
    - JSON is text, read with the built-in JSON functions (`json_extract` for the `metadata` filter);
    - booleans are `0` and `1`;
    - SQLite doesn't enforce `varchar` lengths, so lengths are validated before writing, as the protocol schemas already do.
- **Startup and `eclair doctor` check the setup.** Every API and worker process registers its host name in Redis with a heartbeat, which all processes of an install share, whatever the database. With SQLite:
    - a process refuses to start when a live process from another host is registered, and says why: each machine would have its own database file, or share one over the network, which corrupts it;
    - `/ready` fails and `eclair doctor` reports an error if that happens while running;
    - `eclair doctor` also warns that SQLite is for single-machine installs, and shows how to move to MySQL or PostgreSQL.
- Redis is still required: the queues, progress and locks stay in BullMQ.
- CI runs the test suite on SQLite as well as on MySQL and PostgreSQL. A feature that SQLite can't do portably isn't added for the other two either, unless the dialect module gives it an equivalent.

## Consequences

- Trying Eclair, developing it and running its tests only need Node and Redis. `DATABASE_URL=sqlite:///tmp/eclair-test.db npm test` runs the database tests without Docker.
- A small install has one less service to run, and its backup is a file (with `VACUUM INTO` or the SQLite backup API, not a copy of a file being written).
- Write throughput is limited to one writer at a time. That's enough for one machine, and the reason SQLite isn't offered for multi-server setups.
- Moving from SQLite to MySQL or PostgreSQL means exporting and importing the data. `eclair` gets a command for it before 1.0, so that a single-machine install can grow.
- Three dialects to test instead of two. Each migration and dialect helper runs on all three in CI.
