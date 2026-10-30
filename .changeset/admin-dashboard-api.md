---
'@eclair-js/protocol': minor
---

The admin API describes what an operations dashboard needs: the jobs of every project (`GET /admin/v1/jobs`, `GET /admin/v1/jobs/{id}`) with cancel and retry, a job's webhook deliveries, the install's status (`GET /admin/v1/status`), stats over a period (`GET /admin/v1/stats`) and a storage check. New types: `AdminJob`, `AdminJobList`, `WebhookDelivery`, `WebhookDeliveryList`, `ServerStatus`, `Stats`, `StorageCheck`.
