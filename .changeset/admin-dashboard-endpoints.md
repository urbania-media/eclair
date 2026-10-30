---
'@eclair-js/server': minor
---

The admin API serves what the operations dashboard needs: the jobs of every project (`GET /admin/v1/jobs`, `GET /admin/v1/jobs/{id}`) with cancel and retry, a job's webhook deliveries, the install's status (`GET /admin/v1/status`: the checks of `/ready`, the live hosts with their version and queues, each queue's waiting, active and slots, the temporary storage), stats over a period (`GET /admin/v1/stats`) and a storage check (`POST /admin/v1/projects/{project}/storages/{storage}/check`). Hosts now register their version and the queues their workers serve. The `0004-admin-dashboard` migration records the task of `task.*` webhooks and adds the indexes the stats read. `task.completed` webhooks now send the `Eclair-Task` header that the protocol describes.
