---
'@eclair-js/protocol': minor
---

Describe transcripts in the protocol: `Transcript` (the `transcript.json` file of `ai.transcribe`, the same whatever the provider), `TranscribeMetadata` (its task's metadata and usage), and the project settings `aiProviders` and `externalAiProviders`, which choose the transcription providers a project may use and allow the ones that send media to a third party. The credentials of `amazon-transcribe` are documented. `TranscribeOptions` describes the options of `ai.transcribe`. Transcripts accept fields a later version 1 adds, so a client that validates them keeps working, and the rules that refuse a task's provider when its job is created are documented.
