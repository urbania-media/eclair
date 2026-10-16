---
'@eclair-js/server': minor
'@eclair-js/protocol': patch
---

Add the admin API (`/admin/v1`), with `ECLAIR_ADMIN_TOKEN`: projects, their webhook secret, API keys, storages, global presets and usage, as the protocol describes. Without an admin token, the admin API isn't served. The protocol package exports TypeScript types for the admin schemas.
