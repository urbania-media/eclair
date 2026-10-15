# AGENTS.md

Eclair is a self-hosted media processing server: applications send it jobs over HTTP, workers run pipelines of operations (transcoding, thumbnails, metadata extraction, transcription…) on files read from and written to the application's own storage. Packages are published as `@eclair-js/*`. The PHP client is [`folklore/laravel-eclair`](docs/mediatheque.md), in its own repository.

**Language.** This is a public repository. Everything written here is in **English**: code, comments, docs, commit messages, issues and their comments, pull requests and reviews. Never copy private details from the applications that use Eclair (product plans, infrastructure, hostnames, internal docs, client names). Report security problems privately through a GitHub security advisory, never in a public issue, PR or commit message.

## Status

Eclair is in its design phase. Read [`docs/`](docs/README.md) before writing code:

- **Plan:** [#1](https://github.com/urbania-media/eclair/issues/1). Each item becomes a sub-issue of #1 when work on it starts, and is checked when that sub-issue is closed.
- **Architecture:** [`docs/architecture.md`](docs/architecture.md), [`docs/protocol.md`](docs/protocol.md), [`docs/operations.md`](docs/operations.md) and [`docs/decisions/`](docs/decisions/README.md). Follow the decisions. Changing one means a new decision record that supersedes it.

## Rules

1. **The protocol is the contract.** The HTTP API, the job format and the webhook payloads are defined in `@eclair-js/protocol` (OpenAPI and JSON Schema) before they are implemented. Clients only rely on the protocol. Version 1 of the protocol (`/v1`) only changes additively.
2. **Eclair doesn't keep media beyond a retention period.** Inputs are read from the project's storage, a URL or an upload; outputs are written to the project's storage or to Eclair's temporary storage, where they expire ([0011](docs/decisions/0011-temporary-storage.md)). Local files on workers are deleted when a task ends, whether it succeeds or fails.
3. **Projects are isolated.** Every row, queue entry, temporary directory, log line and metric is scoped to a project. A task never reads another project's files, credentials or results.
4. **Operations are plugins.** Built-in operations implement the same `@eclair-js/operation` interface as third-party ones, and the server never imports an operation directly. An operation declares its options schema, the inputs it accepts, the binaries and capabilities it needs, and what it outputs.
5. **Tasks are safe to retry.** A task can run twice (worker crash, queue retry). It writes outputs to deterministic paths, never duplicates files or webhooks, cleans up its temporary files and reports failure to its job.
6. **Secure by default.**
    - Never trust a file's name, extension or claimed mime type: detect it from the content.
    - Fetching an input URL goes through the SSRF guard (no private, loopback or link-local addresses, a per-project allow-list, limited redirects).
    - Binaries run with argument arrays, never a shell string, with time, memory and output-size limits. ImageMagick and Ghostscript run with restrictive policies.
    - Storage credentials and provider keys are encrypted at rest. API keys are stored hashed. Webhooks are signed.
7. **No hardcoded binaries, URLs or secrets.** Binary paths, limits and credentials come from config and environment variables.
8. **AI goes through providers.** An AI operation (transcription, focal point, highlights…) calls a provider interface. Local models are the default; external APIs are opt-in per project, because they send media to a third party.

## Repository map

`protocol`, `operation`, `server` and `client` exist as empty packages. The rest is planned (see [`docs/architecture.md`](docs/architecture.md)):

```
packages/
  protocol/            @eclair-js/protocol: OpenAPI, JSON Schemas, generated types
  operation/           @eclair-js/operation: operation interface, context, test helpers
  server/              @eclair-js/server: API, scheduler, workers, storage, webhooks, `eclair` CLI
  client/              @eclair-js/client: JS client and webhook verification
  operations-image/    @eclair-js/operations-image (and -video, -audio, -document, -font, -ai)
docker/                Dockerfile and docker compose examples
config/                Shared Vitest config of the packages
docs/                  Architecture, protocol, operations, deployment, decisions
```

## Stack

- Node 24 (`.nvmrc`), npm workspaces, ESM only.
- TypeScript 6, `strict` with `noUncheckedIndexedAccess` (`tsconfig.base.json`). Packages build with `tsc`. Relative imports use the `.ts` extension, which `tsc` rewrites to `.js`.
- Packages import each other by name (`@eclair-js/protocol`). In tests and typechecks, these imports resolve to the sources through the `@eclair-js/source` export condition, so nothing needs to be built first. A new package lists that condition in its `exports` and is added to `workspaces` after the packages it depends on.
- MySQL 8.4+ or PostgreSQL 15+ for projects, jobs and usage, through a query builder. Redis with BullMQ for queues and progress.
- **Both databases are first-class.** Write portable queries and migrations: no raw SQL outside the dialect module, no dialect-only types or features (see [decision 0007](docs/decisions/0007-sql-database-and-redis.md)). Tests run on both.
- Tests use Vitest. Test files sit next to the code: `*.test.ts`. Operation tests run the real binaries on fixtures in the Docker image.
- Lint with ESLint (flat config, typescript-eslint `strict`). Format with Prettier.
- Versions and changelogs with changesets. All `@eclair-js/*` packages and the Docker image share one version.

## Commands

```bash
npm install
npm test            # Vitest, every package
npm run lint        # ESLint
npm run typecheck   # tsc in every package
npm run build       # build every package
npm run format      # Prettier
npx changeset       # describe a change for the changelog
```

Database tests run on the database in `DATABASE_URL` and are skipped without it. CI runs them on MySQL 8.4, PostgreSQL 15 and SQLite. To run them locally:

```bash
DATABASE_URL=sqlite:///tmp/eclair-test.db npm test

docker run --rm -d -p 5432:5432 -e POSTGRES_USER=eclair -e POSTGRES_PASSWORD=eclair postgres:15
DATABASE_URL=postgres://eclair:eclair@127.0.0.1:5432/eclair npm test
```

## Workflow

- `main` is the development branch until 1.0. A `v1.x` maintenance branch is created at 1.0.0.
- Branch from `main`: `feature/<issue>-<slug>`, `fix/…`, `docs/…`, `ci/…`, `refactor/…`, `chore/…`.
- **Every change comes with tests.** A bug fix adds a regression test that fails without the fix. A new operation adds tests on a fixture for each output.
- **Every change to a package comes with a changeset** (`npx changeset`) that says what changed for users.
- Open a pull request to `main` with `Closes #<issue>` or `Part of #<issue>` and the checks you ran. Say what could not run (a missing binary, no GPU). CI checks formatting, lint, types, the build and the changeset, and runs the tests on MySQL and PostgreSQL. **Merge only when CI is green.**
- A change to the protocol is its own pull request, reviewed before the code that implements it.
