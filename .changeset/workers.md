---
'@eclair-js/server': minor
---

Add the workers. `eclair worker` serves the queues of `ECLAIR_QUEUES`, and `eclair all` runs the API and a worker in one process. A task reads its input (the job's, or another task's file), checks its type and its `when` condition, runs its operation within the task's time limit, writes its outputs (to the temporary storage for `keep: false`) and records its usage. Projects run at most `concurrency` tasks at once over every worker. Operation errors fail a task with their code; storage and unexpected errors are retried with backoff. Canceling a job stops its running tasks.
