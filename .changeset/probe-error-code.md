---
'@eclair-js/protocol': minor
'@eclair-js/server': patch
---

A failed `POST /v1/probe` answers `422` with the probe's error `code` in its problem (`input_unreadable`, `provider_unavailable`, `provider_refused`…), so a client tells a file it can't read from a provider that refused for now. `Problem` gains an optional `code`.
