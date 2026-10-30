---
'@eclair-js/operation': minor
'@eclair-js/operations-core': patch
'@eclair-js/operations-image': minor
'@eclair-js/operations-video': minor
'@eclair-js/operations-audio': minor
'@eclair-js/operations-document': minor
'@eclair-js/server': minor
---

`image.convert`, `image.thumbnail`, `video.poster`, `video.thumbnails`, `audio.waveform` and `document.thumbnails` take a `thumbhash` option: each image file they write gets its ThumbHash placeholder, the one the probe gives it, which the job reports as `OutputFile.thumbhash`. `@eclair-js/operation` exports the `thumbhash()` helper, moved from `@eclair-js/operations-core`, and `output()` takes the file's `thumbhash`. The video, audio and document operations now need `vips`.
