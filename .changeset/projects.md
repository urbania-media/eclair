---
'@eclair-js/server': minor
---

Add projects, API keys, storages and presets. Storage credentials and webhook secrets are encrypted with `ECLAIR_SECRET_KEY`, and API keys are stored as hashes. The `/v1` API authenticates projects with their keys and scopes, and serves `GET`, `PUT` and `DELETE /v1/presets`. New CLI commands: `projects:*`, `keys:*`, `storages:*` and `presets:*`.
