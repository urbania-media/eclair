# 0008: AI operations go through providers, local by default

- Status: accepted
- Date: 2026-10-15

## Context

Transcription, focal points, reframing and highlights need models. Local models keep media on the server and make costs predictable, but need CPU time or a GPU. External APIs are simple and often better, but cost per use and send media to a third party.

## Decision

- AI operations ask for a **provider** by capability (`transcription`, `vision`, `language`), not for a specific model or API.
- Local providers are the default: `local-whisper` (whisper.cpp) and `local-vision` (ONNX models for faces and saliency). They run on `ai` or `gpu` workers, with models baked into the image or downloaded at startup.
- External providers are opt-in per project, with the project's own key, stored encrypted. Enabling one is an explicit choice, because media leaves the server.
- Providers report their usage and cost, which goes into the project's usage.

## Consequences

- A project can switch providers without changing its pipelines.
- The default setup sends nothing outside the server.
- Local models make the image and the workers bigger. Whether GPU workers pay off is measured in phase 4.
