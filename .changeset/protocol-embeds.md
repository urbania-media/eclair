---
'@eclair-js/protocol': minor
'@eclair-js/server': patch
'@eclair-js/dashboard': patch
---

Embeds (decision 0022): an `embed` input, the `https` URL of a video or audio on a platform, for jobs and probes; an `embed` object in the probe's metadata (provider, id, URLs, title, author, thumbnail, publication, privacy); the `embedProviders`, `embedDownload` and `embedMaxDuration` project settings; the `provider_unavailable` and `provider_refused` error codes; `accepts.embeds` on operations; and admin endpoints for a project's provider credentials. The server refuses embed inputs until the embed operations exist, and the dashboard shows an embed input's URL.
