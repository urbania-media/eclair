# Decisions

Architecture decision records for Eclair. Each record is short: context, decision, consequences. A decision is changed by a new record that supersedes it, not by editing the old one.

| #                                                  | Decision                                                           | Status                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [0001](0001-typescript-on-node.md)                 | TypeScript on Node 24                                              | Accepted                                                                |
| [0002](0002-files-stay-in-project-storage.md)      | Files stay in the project's storage                                | Accepted, amended by [0011](0011-temporary-storage.md)                  |
| [0003](0003-projects-and-api-keys.md)              | Projects with their own keys, storages and limits                  | Accepted                                                                |
| [0004](0004-declarative-pipelines-and-presets.md)  | Declarative pipelines and presets                                  | Accepted                                                                |
| [0005](0005-operations-as-plugins.md)              | Operations are typed plugins                                       | Accepted                                                                |
| [0006](0006-docker-image-and-roles.md)             | One Docker image with api and worker roles, queues per capability  | Accepted                                                                |
| [0007](0007-sql-database-and-redis.md)             | MySQL or PostgreSQL for state, Redis and BullMQ for queues         | Accepted, amended by [0016](0016-sqlite-for-single-machine-installs.md) |
| [0008](0008-ai-providers.md)                       | AI operations go through providers, local by default               | Accepted                                                                |
| [0009](0009-laravel-mediatheque-integration.md)    | `laravel-eclair` and an opt-in driver in `laravel-mediatheque` 1.x | Superseded by [0017](0017-mediatheque-2-transcoder-first.md)            |
| [0010](0010-repositories-packages-and-releases.md) | Repositories, packages, license and releases                       | Accepted                                                                |
| [0011](0011-temporary-storage.md)                  | Temporary storage for uploads and outputs                          | Accepted                                                                |
| [0012](0012-synchronous-probe.md)                  | Synchronous probe for metadata at upload                           | Accepted                                                                |
| [0013](0013-fastify.md)                            | Fastify for the HTTP API                                           | Accepted                                                                |
| [0014](0014-kysely.md)                             | Kysely for database access and migrations                          | Accepted                                                                |
| [0015](0015-typebox-for-options-schemas.md)        | TypeBox for options schemas, Ajv to validate                       | Accepted                                                                |
| [0016](0016-sqlite-for-single-machine-installs.md) | SQLite for development, tests and single-machine installs          | Accepted                                                                |
| [0017](0017-mediatheque-2-transcoder-first.md)     | `laravel-eclair` implements the mediatheque 2.x `Transcoder` first | Accepted, amended by 0019                                               |
| [0018](0018-webhook-secret-grace-period.md)        | The previous webhook secret stays valid for a grace period         | Accepted                                                                |
| [0019](0019-h264-for-the-web-and-passthrough.md)   | H.264 for progressive playback on the web, and `passthrough`       | Proposed                                                                |
| [0020](0020-progress-webhooks.md)                  | Progress webhooks for running tasks                                | Accepted                                                                |
| [0021](0021-dashboard-on-panneau.md)               | The dashboard is a Panneau 5 app, served by Eclair                 | Proposed                                                                |
