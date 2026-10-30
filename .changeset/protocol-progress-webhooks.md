---
'@eclair-js/protocol': minor
---

Progress webhooks: a `task.progress` webhook, sent while a task runs to projects that set `progressWebhooks`, at most once per task every `progressWebhookInterval` milliseconds (5000 by default), attempted once and not retried. `WebhookEvent` gains `task.progress`.
