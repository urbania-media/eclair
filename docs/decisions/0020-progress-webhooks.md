# 0020: Progress webhooks for running tasks

- Status: accepted
- Date: 2026-10-30

## Context

The worker measures the progress of a task, at most once a second, and publishes it as a `task.progress` job event. Applications see it through `GET /v1/jobs/{id}`, by polling, or `GET /v1/jobs/{id}/events`, by holding a server-sent events stream open. Webhooks are only sent when a task completes (`task.completed`, opt-in) and when the job ends.

A server-side client has no long-running process to hold a stream, and polling every running job every few seconds from each application costs more requests than the progress is worth. `laravel-eclair`'s mediatheque transcoder therefore reports no progress: an editor shows nothing until each rendition ends, which for a long video is many minutes of a step that doesn't move.

## Decision

- **A `task.progress` webhook, opt-in per project.** The project setting `progressWebhooks` (default `false`) subscribes to it, like `taskWebhooks` for `task.completed`. Its body is the whole job, as returned by `GET /v1/jobs/{id}`, and `Eclair-Task` names the task. It is signed like every webhook.
- **Throttled per task.** At most one every `progressWebhookInterval` milliseconds (default 5000, at least 1000), only when the task's progress changed since the previous one, and never once the task has ended. A task that ends sooner sends none.
- **Attempted once, not retried, not stored.** A lost progress is superseded by the next one, or by the task's completion. Deliveries are not recorded in `webhook_deliveries`, so a long transcode doesn't fill the table. They are counted in `eclair_webhook_deliveries_total` under `event="task.progress"`, where one that isn't accepted is `dropped`: `failed` stays the outcome of a delivery that gave up after 24 hours, which the operators' alert watches.
- **Receivers are tolerant of order.** A `task.progress` can arrive after another one, or after `task.completed`: receivers keep the highest progress they saw for a task and ignore progress for a task that has ended. `Eclair-Delivery` is still unique per delivery.

## Consequences

- Server-side clients can show progress without polling: `laravel-eclair` can report `ProgressReporting::Pushed` to the mediatheque when the project subscribes.
- A project that subscribes receives about one request per running task every five seconds. The interval is a project setting, so a busy application can make it longer.
- Progress shown from webhooks can lag by up to the interval, and skip values. Applications that need every value still use the events stream.
- The protocol change is additive: a webhook event, a value of `WebhookEvent`, and two optional project settings.
