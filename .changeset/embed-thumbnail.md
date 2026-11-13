---
'@eclair-js/operations-embed': minor
---

`embed.thumbnail`: the thumbnail an embed's provider gives, downloaded through the SSRF guard on the `network` queue, as a JPEG, PNG, WebP or GIF detected from its content, for the other tasks of the job. An `image.convert` task with `"from": "thumbnail"` makes a poster of it. It reads the provider's answer from `embed.probe`'s cache (`refresh: true` asks again), and doesn't need the project's `embedDownload`.
