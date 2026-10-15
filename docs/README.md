# Eclair

Eclair is a self-hosted media processing server shared by several applications. These documents describe what it does, how it is built and why. They are the reference for the work tracked in [#1](https://github.com/urbania-media/eclair/issues/1).

## Goals

Eclair must be:

- **Shared.** One deployment serves many applications (projects), each with its own keys, storage, presets, limits and usage reports.
- **Simple to deploy.** One Docker image, MySQL or PostgreSQL (or SQLite on one server), and Redis. One server is enough to start; more workers are added without changing anything else.
- **Efficient.** Workers are tuned for media work. Heavy and GPU operations go to the servers that can run them. Applications no longer pay for idle processing capacity.
- **Extensible.** Every operation is a typed plugin with a declared options schema. Adding a conversion or an extraction doesn't touch the core.
- **Safe.** Media comes from users. Every input is untrusted, every project is isolated, and every binary runs with limits.
- **Easy to adopt.** Applications built on [`laravel-mediatheque`](https://github.com/folkloreinc/laravel-mediatheque) switch to Eclair with configuration, without changing how they read files.

## Non-goals

- **Storing or serving media.** Files stay in each project's storage, and delivery stays with the project's CDN. Eclair's temporary storage only holds uploads and outputs until the application picks them up.
- **On-the-fly image URLs.** Resizing images per request is the job of [`laravel-image`](https://github.com/folkloreinc/laravel-image) or an image proxy. Eclair runs asynchronous jobs.
- **A media library.** Eclair doesn't know about media items, tags or usages. That's the application's job, for example with `laravel-mediatheque`.

## Vocabulary

| Term          | Meaning                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Project**   | An application that uses Eclair. It has API keys, storages, presets, webhooks, limits and usage.                               |
| **Storage**   | A place where a project's files live (an S3-compatible bucket, or an HTTP endpoint), or Eclair's temporary storage (`eclair`). |
| **Job**       | One request: an input, a destination and a pipeline. It ends `completed`, `failed` or `canceled`.                              |
| **Pipeline**  | A graph of named tasks. A task reads the input or another task's output.                                                       |
| **Task**      | One run of an operation inside a job.                                                                                          |
| **Operation** | A plugin that does one thing (`video.transcode`, `image.palette`…), with an options schema.                                    |
| **Preset**    | A named pipeline stored on the server or on a project (`web-video`, `mediatheque/video`).                                      |
| **Output**    | A file or metadata produced by a task, reported under the task's name.                                                         |
| **Provider**  | A backend for an AI operation: a local model or an external API.                                                               |
| **Worker**    | A process that runs tasks from one or more queues. Each queue maps to a capability (`cpu`, `gpu`, `ai`…).                      |

## Documents

| Document                           | Content                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| [architecture.md](architecture.md) | Components, data flow, storage, queues, security, observability       |
| [protocol.md](protocol.md)         | The HTTP API, the job format and the webhooks (draft)                 |
| [operations.md](operations.md)     | The operation interface, the built-in operations and the AI providers |
| [deployment.md](deployment.md)     | Docker image, configuration, one server or many                       |
| [mediatheque.md](mediatheque.md)   | `laravel-eclair` and the `laravel-mediatheque` integration            |
| [roadmap.md](roadmap.md)           | Phases, what ships in 1.0, open questions                             |
| [decisions/](decisions/README.md)  | Architecture decision records                                         |
