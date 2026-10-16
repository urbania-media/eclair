---
'@eclair-js/operations-audio': minor
'@eclair-js/server': minor
---

Add `@eclair-js/operations-audio`: `audio.transcode` (MP3, AAC or Opus, with the bitrate, channels, sample rate and a two-pass loudness normalization; MP3 at 192 kbit/s like laravel-mediatheque's `Mp3` job) and `audio.waveform` (the PNG of the mediatheque's audio `Thumbnails` job, with the same size and colors, and audiowaveform's JSON data). Both read audio files and the soundtrack of videos. The server loads the package.
