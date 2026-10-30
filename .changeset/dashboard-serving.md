---
'@eclair-js/server': minor
'@eclair-js/dashboard': patch
---

Serve the dashboard at `/dashboard/` when `ECLAIR_ADMIN_TOKEN` is set, with a strict Content Security Policy. `ECLAIR_DASHBOARD=false` turns it off. The server depends on `@eclair-js/dashboard` for its built files, and the image includes them.
