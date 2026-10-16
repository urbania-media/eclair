---
'@eclair-js/operation': minor
'@eclair-js/operations-core': patch
'@eclair-js/operations-video': minor
'@eclair-js/server': minor
---

Add `@eclair-js/operations-video`, with the outputs of laravel-mediatheque's video jobs: `video.transcode` (MP4 in H.264 or H.265, WebM in VP9 or AV1, with a maximum size, quality and bitrate), `video.thumbnails` (even intervals with `count` and `inMiddle`, given times, an interval or scene changes), `video.poster` (a representative frame) and `video.hls` (H.264 renditions by short side, `master.m3u8`). The server loads it, and a job lists HLS segments as a `count` on their main file. `exec()` takes an `onStdout` option for progress, `@eclair-js/operation` adds `ffmpegInput()` and `ffmpegProgress()`, and `@eclair-js/operation/testing` adds `missingBinaries()` and `skipWithoutBinaries()`. ffmpeg and ffprobe, in `probe` too, only open local files with audio and video demuxers, never playlists.
