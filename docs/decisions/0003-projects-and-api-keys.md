# 0003: Projects with their own keys, storages and limits

- Status: accepted
- Date: 2026-10-15

## Context

The point of Eclair is to share one deployment between many applications. A single shared secret would give no isolation, no limits and no way to know which application uses what. One instance per application would only share the machine.

## Decision

- Each application is a **project**, with:
    - hashed, scoped API keys;
    - storages, presets and a webhook secret;
    - a priority, a concurrency limit and size and duration limits;
    - the operations and AI providers it may use.
- Every row, queue entry, temporary directory, log line and metric is scoped to a project.
- Usage (CPU seconds, media seconds, bytes, provider cost) is recorded per task and aggregated per project.

## Consequences

- One project's backlog can't starve the others, and one project can't read another's files or results.
- Usage per project makes it possible to split the server's cost between applications.
- Projects are managed by an admin, through the CLI or the admin API. There is no self-service sign-up.
