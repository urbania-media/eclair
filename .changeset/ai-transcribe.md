---
'@eclair-js/operations-ai': minor
'@eclair-js/operation': minor
'@eclair-js/server': minor
---

Add `ai.transcribe` in the new `@eclair-js/operations-ai` package. It transcribes the speech of an audio file or of a video's soundtrack through the `transcription` provider, which is `local-whisper` (whisper.cpp on the worker) by default. It writes `transcript.json` (the language, segments and timed words), `transcript.vtt` and `transcript.srt`.

The operation context gains `providers` (each capability's provider and the operator's settings for it), and an operation's result can report `usage.mediaSeconds`, which goes into the project's usage. Workers read `ECLAIR_MODELS_DIR`, `ECLAIR_WHISPER_MODEL`, `ECLAIR_WHISPER_THREADS` and `ECLAIR_TRANSCRIBE_MAX_DURATION`.
