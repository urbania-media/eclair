---
'@eclair-js/protocol': minor
'@eclair-js/operation': minor
'@eclair-js/server': minor
'@eclair-js/operations-ai': minor
---

A task reports what it used at a paid provider when it fails or is canceled, not only when it succeeds:

- **Protocol:** a task can have a `usage` (`TaskUsage`: `mediaSeconds`, and `cost` with `amount` and `currency`), on any end, `completed`, `failed` or `canceled`, once its provider may bill it. It's absent for the operations that use no paid provider and for a task that ended before reaching one.
- **Operations:** the context gains `reportUsage({ mediaSeconds, cost })`, which an operation calls as soon as a provider bills it. The worker counts it in the project's usage report (seconds and cost) and shows it on the task, whatever the end of the task. A result's `usage` can now carry a `cost` too. `runOperation()` takes a `reportUsage` callback.
- **`ai.transcribe` with `amazon-transcribe`:** once `StartTranscriptionJob` has succeeded, or the job of an earlier attempt or one whose start got no answer was found, every end of the task reports the audio Amazon received and its cost when `pricePerMinute` is configured, with Amazon's 15-second minimum: success, failure, timeout or cancel. A task refused before, or whose upload failed, reports nothing.
- **Cancel:** a canceled job is `canceled` at once, but gets its `endedAt` and sends its `job.canceled` webhook once its running tasks have stopped, so that the webhook shows how they ended and what they used. Retrying it answers 409 until then. A running task whose worker stopped while its job was canceled ends as `canceled` when the queue gives it back.
- **Database:** migration `0006-task-usage` adds a `usage` column to `tasks`. Run `eclair migrate`.
