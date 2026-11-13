---
'@eclair-js/operation': minor
'@eclair-js/operations-embed': minor
'@eclair-js/server': minor
---

`embed.probe` (decision 0022): add `@eclair-js/operations-embed`, which reads the metadata of a video or audio on YouTube, Vimeo, Dailymotion, SoundCloud, Spotify, TikTok or Instagram from its page URL, through the provider's API or oEmbed, never the page itself, and keeps an answer for an hour per project. The server loads it, takes `{ "embed": … }` inputs for the providers in a project's `embedProviders`, runs `embed.probe` for them in `POST /v1/probe`, and never fetches them. Projects' provider credentials are stored encrypted, set with `PUT /admin/v1/projects/{project}/credentials/{provider}` or `eclair credentials:set`, and fall back on the operator's `ECLAIR_PROVIDER_<PROVIDER>_<KEY>` variables. `@eclair-js/operation` gains `defineEmbedOperation()`, `defineEmbedProvider()`, plugins with `embedProviders`, the `provider_unavailable` and `provider_refused` error codes, and `runEmbedOperation()` for tests.
