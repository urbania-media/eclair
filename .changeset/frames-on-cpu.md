---
'@eclair-js/operations-video': patch
---

`video.thumbnails` and `video.poster` run on the `cpu` queue instead of `video`: a few frames no longer wait until the transcode in progress ends, which kept a client that waits for them, such as laravel-mediatheque 1.1's synchronous `Thumbnails` job at upload, past its timeout.
