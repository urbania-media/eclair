# 0019: H.264 is encoded for progressive playback on the web, and a web-ready video can be copied

- Status: proposed
- Date: 2026-10-30
- Amends: [0017](0017-mediatheque-2-transcoder-first.md) (the outputs of the `mediatheque/video` preset)

## Context

`video.transcode` took the defaults of laravel-mediatheque 1.x's `H264` job: x264's `fast` preset, Main profile, CRF 26, no maximum bitrate and x264's keyframe interval (250 frames). It always encoded, whatever the input.

The first application on Eclair delivers its videos as progressive MP4 (H.264 and AAC, `faststart`), in 1080p and 720p. Most of its uploads are already H.264 for the web. On a 14 min 40 s 1080p video at 2 Mbit/s (234 MB), the 1080p rendition at CRF 23 came out at 302 MB, larger than its input, and took almost 6 minutes: a second generation of a compressed video costs more bits than the first, and can only lose quality.

We measured on a 2-minute extract of that video (1080p, H.264 High at 1.7 Mbit/s, 23.976 fps), with VMAF (`vmaf_v0.6.1`) against the extract, the 720p renditions scaled back to 1080p:

| 1080p                         | Video bitrate | VMAF | Time (relative) |
| ----------------------------- | ------------- | ---- | --------------- |
| `fast`, Main, CRF 26 (before) | 1738 kbit/s   | 93.6 | 1.0             |
| `fast`, Main, CRF 23          | 2300 kbit/s   | 95.7 | 0.9             |
| `medium`, High, CRF 23        | 2161 kbit/s   | 96.4 | 1.6             |
| `slow`, High, CRF 23          | 2385 kbit/s¹  | 96.5 | 1.7             |
| `medium`, High, CRF 21        | 2888 kbit/s¹  | 97.2 | 1.6             |
| `medium`, High, CRF 25        | 2055 kbit/s¹  | 95.4 | 1.2             |
| `medium`, keyframe every 4 s  | 2266 kbit/s   | 96.4 |                 |
| `medium`, keyframe every 5 s  | 2221 kbit/s   | 96.4 |                 |
| `medium`, keyframe every 2 s  | 2440 kbit/s   | 96.4 |                 |

¹ With a keyframe every 2 seconds.

At 720p, `medium` with a keyframe every 4 seconds gives 1274 kbit/s at VMAF 90.4, against 1246 kbit/s at 89.5 for `fast` and Main. Scaling down to 720p alone costs about 5 points: a near-lossless 720p (CRF 10) scores 95.2.

Sources for what players need:

- Apple's [HLS authoring specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices): H.264 High profile in preference to Main or Baseline (1.4), at most High 4.1 for the widest compatibility (1.3a), no higher level than the resolution needs (1.11), a keyframe every 2 seconds for segments (1.13), a peak at most twice the average (1.30), and a ladder with 720p at 3000 kbit/s and 1080p at 6000 kbit/s (1.25). Stereo AAC from 32 to 160 kbit/s (2.9).
- YouTube's [recommended upload settings](https://support.google.com/youtube/answer/1722171): MP4 with the `moov` atom at the front (fast start), H.264 High profile, 4:2:0, 8 Mbit/s for 1080p and 5 Mbit/s for 720p at up to 30 fps, half again at 48 to 60 fps.
- MDN's [web video codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs): every browser plays H.264 in its Constrained Baseline, Main and High profiles, 8-bit 4:2:0; High 10, 4:2:2 and 4:4:4 are not for the web.

## Decision

**H.264's defaults are for progressive playback on the web**:

- **`medium` preset.** 6 % smaller than `fast` at a higher quality, for 1.6 times the time. `slow` gains nothing more on this content and picks level 5.0 for 1080p, which some phones refuse.
- **High profile**, at the level x264 picks from the size and frame rate (4.0 for 1080p at up to 30 fps).
- **CRF 23**, x264's default and the mediatheque 2 `ffmpeg` driver's. CRF 26 saves a quarter of the bits for 2 points of VMAF less; CRF 21 costs 18 % more for 0.7 more.
- **A maximum bitrate from the output's size**, when `maxBitrate` isn't given: 1000 kbit/s up to 640 × 360, 2000 up to 960 × 540, 3000 up to 1280 × 720, 6000 up to 1920 × 1080, 10 000 up to 2560 × 1440, 16 000 above, and half again above 30 fps. It is Apple's ladder, used as a ceiling: CRF 23 stays under it on most content, and only grain or fast motion reaches it. The buffer is twice the rate, so peaks stay at most twice the average. It follows the output, not the request: a 720p video asked at 1080p gets the 720p ceiling.
- **A keyframe every 4 seconds at most** (`-g`, from the frame rate), against 10 seconds and more by default: a seek reads and decodes at most 4 seconds of video, for 5 % more bits. Two seconds would cost 13 %: they matter to HLS segments, which `video.hls` encodes on its own.
- **AAC at 128 kbit/s in stereo, and `faststart`**, as before.

**`passthrough: true` copies a video that already fits** instead of encoding it. It is opt-in, so a client that sends nothing gets what it got before, and operation version 1 only gains an option. It only applies to H.264 in MP4. The video stream is copied when it is:

- H.264 in 8-bit 4:2:0 (`yuv420p`, or `yuvj420p`), in the Constrained Baseline, Main or High profile, at level 4.2 or lower (1080p at 60 fps);
- upright, progressive, with square pixels: a copy would keep a rotation or an aspect ratio that some players ignore;
- within `maxWidth` and `maxHeight`;
- at or under the maximum bitrate (`maxBitrate`, or the default above for its size), as an average over the file.

The audio is copied when it is AAC, mono or stereo, at most twice `audioBitrate`. Otherwise it is encoded as usual, and the video still copied. The file is written with `faststart`, without the input's global metadata.

**The task's metadata says what happened**: `video` is `copied` or `encoded`, and `audio`, when there is audio, too.

The other codecs keep their defaults. The `mediatheque/video` preset gets the new H.264 defaults: its outputs are still H.264 MP4 at the size of the video, but no longer encoded as 1.x's `H264` job did, which [0017](0017-mediatheque-2-transcoder-first.md) promised. The 1.x driver doesn't exist yet, and the mediatheque 2 `ffmpeg` driver takes the same defaults.

## Consequences

- A web-ready upload takes seconds instead of minutes, and keeps its quality and size. Applications that want a rendition of every video turn `passthrough` on.
- A copied video keeps its encoder's choices: its keyframe interval in particular, which can be longer than 4 seconds. Seeking in it reads more.
- Encoding takes about 1.6 times as long as before, for smaller files at a higher quality.
- A source of 720p or smaller asked at 1080p and at 720p gives the same file twice: copied twice when it fits, encoded twice when it doesn't. A condition on the size of the input would avoid it; it is not in the protocol's `when`, and an application can test the probe's size before it sends the job.
- The mediatheque 2 `ffmpeg` driver has the same option and defaults ([folkloreinc/laravel-mediatheque#152](https://github.com/folkloreinc/laravel-mediatheque/issues/152)), so a pipeline gives the same renditions on both.
