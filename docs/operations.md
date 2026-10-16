# Operations

An operation does one thing to one input: probe it, transcode it, extract its palette, transcribe it. Every operation, built-in or not, is a plugin that implements the interface from `@eclair-js/operation`.

## The interface (draft)

```ts
import { defineOperation } from '@eclair-js/operation';

export default defineOperation({
    name: 'image.palette',
    version: 1,
    description: 'Extract the dominant colors of an image.',
    accepts: { kinds: ['image', 'video'] },
    capability: 'cpu',
    binaries: ['magick'],
    options: {
        type: 'object',
        properties: {
            count: { type: 'integer', minimum: 1, maximum: 16, default: 5 },
        },
        additionalProperties: false,
    },
    outputs: { metadata: true, files: false },

    async run(ctx, options) {
        const colors = await extractPalette(ctx, ctx.input.path, options.count);
        return { metadata: { colors } };
    },
});
```

| Member       | Role                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `name`       | `<domain>.<action>`, unique on the server. `probe` is the only name without a domain.                      |
| `version`    | Major version. A change to options or outputs that breaks clients is a new version, and the old one stays. |
| `accepts`    | Kinds and mime types it can read. The scheduler skips or refuses other inputs before running anything.     |
| `capability` | Queue it runs on: `cpu`, `video`, `gpu` or `ai`.                                                           |
| `binaries`   | Binaries it calls. `eclair doctor` and `/ready` check them; a worker without them doesn't take the task.   |
| `options`    | JSON Schema of the options. It's validated when the job is created, and published in `GET /v1/operations`. |
| `outputs`    | Whether it produces files, metadata or both.                                                               |
| `run`        | Does the work. Gets a context and validated options, returns files and metadata.                           |

The **context** gives the operation:

- `input`: the local path, the detected kind and mime, and the result of `probe` when the job has one;
- `workdir`: a temporary directory that the worker deletes afterwards;
- `exec(binary, args, limits)`: runs a configured binary with argument arrays, a timeout and the abort signal;
- `progress(ratio)`, `log`, `signal` (an `AbortSignal` for cancel and timeout);
- `providers`: the AI providers configured for the project;
- `output(name, path, { mime, role })`: declares an output file, which the worker uploads.

An operation never reads environment variables, the database or another project's data, and never uploads files itself. Operations are tested with `@eclair-js/operation/testing`, which runs `run()` on a fixture with a real context.

### Plugins

A plugin is an npm package that exports one or more operations. The server loads the built-in packages and the ones listed in `ECLAIR_PLUGINS`. Operations can also be restricted per project. The Docker image includes the built-in operations and their binaries. Adding a plugin with new binaries means extending the image.

## Built-in operations

**1.0** marks what ships in 1.0. The others come in 1.x, in the order of the [roadmap](roadmap.md).

### Probe (`@eclair-js/operations-core`)

| Operation | Output                                                                                                                                                                       | 1.0 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `probe`   | Kind, mime, extension, size, checksum; width, height, rotation; duration, frame rate, bitrate, codecs, audio channels; page count; font names; EXIF summary; animated or not | ✓   |

### Image (`@eclair-js/operations-image`)

| Operation         | Output                                                                                           | 1.0 |
| ----------------- | ------------------------------------------------------------------------------------------------ | --- |
| `image.convert`   | Resized or converted image (JPEG, PNG, WebP, AVIF), with auto-orientation and EXIF/GPS stripping | ✓   |
| `image.thumbnail` | Thumbnails at given sizes, from any image or the first page of a document                        | ✓   |
| `image.palette`   | Dominant colors                                                                                  | ✓   |
| `image.blurhash`  | BlurHash or ThumbHash placeholder                                                                |     |
| `image.focus`     | Focal point and regions of interest (faces, saliency), through an AI provider                    |     |
| `image.describe`  | Alt text, through an AI provider                                                                 |     |

HEIC and HEIF inputs are converted by the same operations.

### Video (`@eclair-js/operations-video`)

| Operation          | Output                                                                                    | 1.0 |
| ------------------ | ----------------------------------------------------------------------------------------- | --- |
| `video.transcode`  | MP4 (H.264, H.265) or WebM (VP9, AV1), with size, bitrate and quality limits              | ✓   |
| `video.hls`        | HLS with several renditions, `master.m3u8`                                                | ✓   |
| `video.thumbnails` | Frames at given times, at even intervals, or by scene changes                             | ✓   |
| `video.poster`     | One representative frame                                                                  | ✓   |
| `video.animated`   | Short animated preview (WebP, GIF or a silent MP4)                                        |     |
| `video.storyboard` | Sprite sheet and its WebVTT map, for scrubbing previews                                   |     |
| `video.clip`       | An extract: start, end, optional crop                                                     |     |
| `video.reframe`    | Vertical (9:16) or square version that follows the subject, using `image.focus` per scene |     |
| `video.scenes`     | Scene changes, as metadata                                                                |     |

The options of each operation are published in `GET /v1/operations`. In short:

- `video.transcode`: `codec` (`h264` by default, `h265`, `vp9`, `av1`), `format` (`mp4` or `webm`, from the codec by default), `maxWidth` and `maxHeight` (never enlarged), `quality` (CRF), `maxBitrate`, `audio` and `audioBitrate` (AAC in MP4, Opus in WebM). Writes `video.mp4` or `video.webm`. The defaults are those of the mediatheque's `H264`, `HEVC` and `WebM` jobs: `fast` preset, main profile, 8-bit 4:2:0, CRF 26 for H.264 and VP9 and 30 for H.265.
- `video.thumbnails`: `count` frames at even intervals (5 by default), centered with `inMiddle` as in the mediatheque, or at given `times`, every `interval` seconds, or at the clearest `scenes` changes. `maxWidth`, `maxHeight`, `format` (`jpeg`, `png`, `webp`) and `quality`. Writes `0.jpg`, `1.jpg`…, with the role `thumbnail`.
- `video.poster`: the frame at `time`, or by default the most representative frame of a few seconds near the start. Writes `poster.jpg`, with the role `poster`.
- `video.hls`: `renditions` by short side (`size`), with their `bitrate` and `audioBitrate`, and `segmentDuration`. By default, the renditions of the mediatheque's `HLS` job: 360p, 720p and 1080p at 800, 2000 and 4000 kbit/s, in 5-second segments. Renditions larger than the video are left out. Writes `master.m3u8` (role `main`), a playlist per rendition (`720p.m3u8`, role `playlist`) and their segments (`720p_000.ts`, role `segment`), which the job lists as a `count` on `master.m3u8`.

They also return the size of what they wrote as metadata. ffmpeg only opens local files with audio and video demuxers (`ffmpegInput()` of `@eclair-js/operation`), never playlists, so an input can't make it read another file.

### Audio (`@eclair-js/operations-audio`)

| Operation         | Output                                             | 1.0 |
| ----------------- | -------------------------------------------------- | --- |
| `audio.transcode` | MP3, AAC or Opus, with loudness normalization      | ✓   |
| `audio.waveform`  | Waveform data (JSON) and image, with audiowaveform | ✓   |
| `audio.clip`      | An extract between two times                       |     |

Both read audio files and the soundtrack of videos.

- `audio.transcode`: `codec` (`mp3` by default, `aac` in M4A, `opus` in Ogg), `bitrate` (192 kbit/s for MP3, as the mediatheque's `Mp3` job), `channels`, `sampleRate`, and `normalize` to a `loudness` in LUFS (-16 by default), in two passes. Writes `audio.mp3`, `audio.m4a` or `audio.opus`.
- `audio.waveform`: `waveform.png` (role `main`) with the size and colors of the mediatheque's audio `Thumbnails` job by default (1200×400, transparent background, black waveform, no axis labels), and `waveform.json` (role `data`), audiowaveform's JSON with `pixelsPerSecond` points a second. `zoom` is `auto` by default, which fits the whole file in the width; the mediatheque's 600 samples per pixel only showed the first seconds of a long file. `image` and `data` turn each file off.

### Document (`@eclair-js/operations-document`)

| Operation             | Output                                | 1.0 |
| --------------------- | ------------------------------------- | --- |
| `document.thumbnails` | One image per page, or for some pages | ✓   |
| `document.text`       | Extracted text, per page              |     |
| `document.pdf`        | PDF from office documents             |     |

`document.thumbnails` reads PDFs, with poppler's `pdftoppm`: never ImageMagick and Ghostscript, whose policy in the image only allows raster formats. By default it renders every page at 150 dpi in JPEG at quality 100 on a white background, like the mediatheque's document `Thumbnails` job, into `0.jpg`, `1.jpg`… (role `thumbnail`). `count` renders the first pages, `pages` a list of pages numbered from 1; `resolution`, `maxWidth` and `maxHeight` (the resolution is lowered to fit), `format` (`jpeg` or `png`) and `quality`. Up to 1000 pages a task. Office documents come with `document.pdf`.

### Font (`@eclair-js/operations-font`)

| Operation      | Output                                   | 1.0 |
| -------------- | ---------------------------------------- | --- |
| `font.convert` | WOFF and WOFF2, with optional subsetting | ✓   |

### AI (`@eclair-js/operations-ai`)

| Operation       | Output                                                                           | 1.0 |
| --------------- | -------------------------------------------------------------------------------- | --- |
| `ai.transcribe` | Transcript with timings: WebVTT, SRT, and JSON with words and speakers           | ✓   |
| `ai.highlights` | Suggested extracts (start, end, title, score) from the transcript and the scenes |     |

`image.focus`, `image.describe` and `video.reframe` also use AI providers.

## AI providers

An AI operation asks for a provider by capability (`transcription`, `vision`, `language`). The project's configuration says which provider answers:

| Provider        | Runs                                            | Default |
| --------------- | ----------------------------------------------- | ------- |
| `local-whisper` | whisper.cpp on the worker (CPU, or GPU)         | ✓       |
| `local-vision`  | ONNX models for faces and saliency              | ✓       |
| External APIs   | Hosted transcription, vision or language models | Opt-in  |

- Local providers run on workers with the `ai` or `gpu` capability. Models are downloaded at startup or baked into the image, never at task time.
- External providers are enabled per project, with the project's own API key stored encrypted. They send media to a third party: the project's configuration has to say so explicitly.
- Each provider reports its usage (media seconds, tokens, cost when known), which goes into the project's usage.

## Presets

Presets combine operations into pipelines. The built-in ones:

| Preset                 | Tasks                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `web-video`            | `probe`, `h264` (1080p), `hls` (1080p, 720p, 360p), `poster`, `thumbnails` (5)                        |
| `web-audio`            | `probe`, `mp3`, `waveform`                                                                            |
| `web-image`            | `probe`, `palette`, `webp`                                                                            |
| `mediatheque/video`    | The `laravel-mediatheque` video pipeline: `probe`, `h264`, `webm`, `hevc`, `thumbnails` (5, centered) |
| `mediatheque/audio`    | `probe`, `thumbnails` (waveform image, as in the mediatheque)                                         |
| `mediatheque/document` | `probe`, `thumbnails` (every page)                                                                    |
| `mediatheque/font`     | `probe`, `webfonts`                                                                                   |

The `mediatheque/*` presets produce the same handles and formats as the jobs of `laravel-mediatheque` 1.x, for its driver. With mediatheque 2, renditions are declared in the application and sent as inline tasks. See [mediatheque.md](mediatheque.md).
