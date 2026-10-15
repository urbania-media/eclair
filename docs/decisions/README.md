# Decisions

Architecture decision records for Eclair. Each record is short: context, decision, consequences. A decision is changed by a new record that supersedes it, not by editing the old one.

| #                                                  | Decision                                                           | Status                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| [0001](0001-typescript-on-node.md)                 | TypeScript on Node 24                                              | Accepted                                               |
| [0002](0002-files-stay-in-project-storage.md)      | Files stay in the project's storage                                | Accepted, amended by [0011](0011-temporary-storage.md) |
| [0003](0003-projects-and-api-keys.md)              | Projects with their own keys, storages and limits                  | Accepted                                               |
| [0004](0004-declarative-pipelines-and-presets.md)  | Declarative pipelines and presets                                  | Accepted                                               |
| [0005](0005-operations-as-plugins.md)              | Operations are typed plugins                                       | Accepted                                               |
| [0006](0006-docker-image-and-roles.md)             | One Docker image with api and worker roles, queues per capability  | Accepted                                               |
| [0007](0007-sql-database-and-redis.md)             | MySQL or PostgreSQL for state, Redis and BullMQ for queues         | Accepted                                               |
| [0008](0008-ai-providers.md)                       | AI operations go through providers, local by default               | Accepted                                               |
| [0009](0009-laravel-mediatheque-integration.md)    | `laravel-eclair` and an opt-in driver in `laravel-mediatheque` 1.x | Accepted                                               |
| [0010](0010-repositories-packages-and-releases.md) | Repositories, packages, license and releases                       | Accepted                                               |
| [0011](0011-temporary-storage.md)                  | Temporary storage for uploads and outputs                          | Accepted                                               |
| [0012](0012-synchronous-probe.md)                  | Synchronous probe for metadata at upload                           | Accepted                                               |
