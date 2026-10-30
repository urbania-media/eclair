---
'@eclair-js/operations-video': minor
---

`video.transcode` writes H.264 for progressive playback on the web (decision 0019): `medium` preset instead of `fast`, High profile instead of Main, CRF 23 instead of 26, a keyframe every 4 seconds, and a maximum bitrate from the output's size when `maxBitrate` isn't given (3000 kbit/s for 720p, 6000 for 1080p, half again above 30 fps). A new `passthrough` option copies an H.264 video that already fits (8-bit 4:2:0, a web profile up to level 4.2, upright, within the maximum size and bitrate) instead of encoding it, and its audio when it is AAC in mono or stereo. The task's metadata says whether the `video` and the `audio` were `copied` or `encoded`.
