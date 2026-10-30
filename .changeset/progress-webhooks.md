---
'@eclair-js/server': minor
---

Progress webhooks: projects with `progressWebhooks` get a `task.progress` webhook while each task runs, at most once per task every `progressWebhookInterval` milliseconds (5000 by default), counted from the start of the task, only when the progress changed, and never once the task has ended. They are attempted once and not recorded in `webhook_deliveries`. `eclair_webhook_deliveries_total` gains an `event` label, and a `task.progress` that isn't accepted counts as `dropped`.
