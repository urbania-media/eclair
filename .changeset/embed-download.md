---
'@eclair-js/operation': minor
'@eclair-js/operations-embed': minor
'@eclair-js/server': minor
'@eclair-js/protocol': patch
---

`embed.download` (decision 0022): the file of an embed, for the other tasks of a job (`"from": "download"`), from the providers of a project's `embedDownload` only, within its `maxInputSize` and `embedMaxDuration` (`ECLAIR_EMBED_MAX_DURATION`, 2 hours by default). Vimeo videos download through the API with the owner's token, the original included; the other providers come with yt-dlp. A new `network` capability and queue (2 slots by default, served when `ECLAIR_QUEUES` lists it) runs downloads without holding CPU or video slots. Embed operations get a work directory, `output()`, `download()` through the SSRF guard, and the project's `limits`; an embed operation that `downloads` needs the provider in `embedDownload`.
