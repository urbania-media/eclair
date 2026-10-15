---
'@eclair-js/operation': minor
'@eclair-js/operations-core': minor
'@eclair-js/server': minor
'@eclair-js/protocol': patch
---

Add the operation interface: `defineOperation()` with TypeBox or JSON Schema options, the context of a task, `execBinary()` with time and output limits and a minimal environment, operation errors with the protocol's codes, type detection from the content, and `@eclair-js/operation/testing`. Add `probe` in the new `@eclair-js/operations-core` package. The server loads the built-in operations and `ECLAIR_PLUGINS`, serves `GET /v1/operations`, checks the operations and options of presets, and `eclair doctor` lists the operations a machine can run. `probe` is a capability, for its own queue.
