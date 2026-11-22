---
'@eclair-js/operation': minor
'@eclair-js/operations-ai': minor
'@eclair-js/server': minor
---

Transcriptions that fit their time limit and their queue, and a sturdier Amazon Transcribe:

- An operation can ask for a longer time limit when it knows it needs one (`context.extendTimeout()`), up to `ECLAIR_TASK_MAX_TIMEOUT` (12 hours). `ai.transcribe` asks for the time its provider needs on the recording before it starts, or fails with `limit_exceeded` before a paid job starts.
- An operation can name the queue of its tasks with an external AI provider (`externalQueue`): `ai.transcribe` with Amazon runs on the `network` queue and no longer holds the `ai` slot of a local transcription. whisper-cli is optional: a worker that only sends audio to Amazon can do without.
- A job is refused when it's created when its external provider has no credentials for the project, or when an AI provider can't do what a task asks (`checkOptions`): Amazon refuses a locale it doesn't transcribe, such as `en-CA`.
- `amazon-transcribe` asks again when a status request or the transcript's fails, waits for a running job to end before deleting it (Amazon refuses to delete a running job), cleans up a job whose start a cancel cut, deletes an earlier attempt's files, streams the audio to S3, pads audio shorter than half a second, keeps the project's bucket out of failure reasons, and estimates costs with Amazon's 15-second minimum.
- `local-whisper` keeps a whole 500-character prompt (224 tokens of context with a prompt).
- `text` is joined without spaces in languages written without them.
