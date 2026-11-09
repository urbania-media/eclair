---
'@eclair-js/operations-video': minor
---

`video.transcode` takes `start` and `duration`, in seconds, to keep a span of the video, such as its first 15 seconds for a short preview: from `start` (0 by default) for `duration` (until the end by default). They also work with `passthrough`, where a copied video starts at the keyframe at or before `start`. The `duration` metadata and the progress follow the span. A `start` after the end of the video fails with `unsupported_input`.
