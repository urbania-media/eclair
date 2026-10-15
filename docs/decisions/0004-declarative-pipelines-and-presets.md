# 0004: Declarative pipelines and presets

- Status: accepted
- Date: 2026-10-15

## Context

`laravel-mediatheque` describes processing as pipelines of named jobs, where a job can read another job's output (`from_file`) and its output is attached under the job's name. Eclair needs the same flexibility, plus reusable definitions that projects don't have to repeat.

## Decision

- A job carries a **pipeline**: named tasks, each with an operation, options, and an optional `from` (the task whose output it reads) and `after` (extra dependencies). The graph is acyclic.
- A task's name is also its output's name, so it is the handle the application reads.
- A job can reference a **preset**, a stored pipeline, global or per project, and add or override tasks.
- Options are validated against each operation's JSON Schema when the job is created, not when it runs.
- Tasks can be conditional on the probed input (`when`).

## Consequences

- The mediatheque's pipelines translate directly into Eclair jobs, with the same handles.
- Clients can build pipelines dynamically, while most use presets.
- A job records the preset version it used, so changing a preset doesn't change jobs already created.
