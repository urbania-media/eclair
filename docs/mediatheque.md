# Laravel and laravel-mediatheque

Most applications that will use Eclair at first are Laravel sites built on [`laravel-mediatheque`](https://github.com/folkloreinc/laravel-mediatheque) (directly or through `laravel-folklore`). They run ffmpeg, ImageMagick and audiowaveform on their own servers today. The goal is to move that work to a shared Eclair without changing how these applications read their files.

## laravel-eclair

`folklore/laravel-eclair` is the PHP client, in its own repository (`folkloreinc/laravel-eclair`). It follows the protocol published in `@eclair-js/protocol`, and supports the same PHP and Laravel versions as `laravel-mediatheque` 1.x.

It provides:

- a client for the API: `Eclair::jobs()->create(...)`, `find()`, `cancel()`, `retry()`, and presets;
- a webhook route that verifies the signature and dispatches `JobCompleted`, `JobFailed` and `TaskCompleted` events;
- the endpoint for `http` storages: it serves inputs and receives outputs on a Laravel disk, with signed requests, for applications that keep files on their own disk;
- downloading outputs from Eclair's temporary storage to a Laravel disk, for applications that would rather pull than receive;
- `Eclair::probe()`, the synchronous probe;
- `Eclair::fake()` with assertions, to test applications without a server;
- an `eclair:status` command that checks the connection, the key and the storages.

Configuration: `ECLAIR_URL`, `ECLAIR_KEY`, `ECLAIR_WEBHOOK_SECRET`, and the name of the Eclair storage to use for each Laravel disk.

## The mediatheque driver

A minor release of `laravel-mediatheque` 1.x adds an opt-in driver that sends pipelines to Eclair instead of dispatching its own jobs. It is additive: nothing changes for applications that don't enable it, and `laravel-eclair` is a suggested dependency, not a required one.

```php
// config/mediatheque.php
'pipelines' => [
    'video' => [
        'driver' => 'eclair',
        'preset' => 'mediatheque/video',
    ],
],
```

### How a pipeline runs

1. A media is created as today: the original is stored on the source. The driver then calls the synchronous probe (`POST /v1/probe`) and saves the type and metadata (dimensions, duration, page count, font name) before the request returns, as the local metadata readers do today. If Eclair doesn't answer in time, the driver detects the mime type locally and the pipeline fills the metadata later.
2. The pipeline starts. With the `eclair` driver, the mediatheque creates the `Pipeline` and `PipelineJob` rows as usual, then sends one Eclair job:
    - the input is the original file, as a path on the Eclair storage that maps to the source's disk (or a temporary signed URL);
    - the output prefix comes from the mediatheque's path formatter;
    - each task is named after the mediatheque job's handle (`h264`, `webm`, `thumbnails`…);
    - `metadata` holds the media id and the pipeline id.
3. On `task.completed`, the driver attaches each output file to the media under the task's name, as the local jobs do, and marks the `PipelineJob` as ended. Thumbnails are attached as `thumbnails.0`, `thumbnails.1`…
4. On `job.completed` or `job.failed`, the pipeline ends, with the same events and statuses as a local run.
5. Applications that let Eclair probe and process their media no longer need ffprobe or ImageMagick on their own servers.

Handles, file paths, sources and URLs stay the same, so `laravel-folklore` and the applications that read `$media->files->h264` see no difference.

### Mapping

| Mediatheque job              | Eclair task                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `Video\H264`, `WebM`, `HEVC` | `video.transcode` with the same codec, size and bitrate                     |
| `Video\Thumbnails`           | `video.thumbnails` with `count` and `inMiddle`                              |
| `Video\MediaConvert`         | Not needed: Eclair replaces it                                              |
| `Audio\Thumbnails`           | `audio.waveform`, image output with the same size and colors                |
| `Document\Thumbnails`        | `document.thumbnails` with the same resolution, quality and format          |
| `Font\WebFonts`              | `font.convert`                                                              |
| Metadata readers             | `probe`                                                                     |

Each mediatheque job's options are translated by the driver, so an application's custom pipeline options keep working. A job class that has no Eclair equivalent (a custom job in an application) keeps running locally, and the driver splits the pipeline between Eclair and the local queue.

## Moving an application to Eclair

1. Register the application as a project in Eclair, with a key and a storage that points to its bucket. Applications that keep files on their own disk use an `http` storage served by `laravel-eclair`, or Eclair's temporary storage, from which `laravel-eclair` downloads the outputs.
2. Install `folklore/laravel-eclair` and the mediatheque release with the driver.
3. Enable the driver for one type (audio or documents first), compare outputs with the local jobs, then enable the others.
4. Once every type runs on Eclair, remove the binaries from the application's servers and reduce their size.

## Pilot: Niche

Niche, URBANIA's content platform, is the first application on Eclair. It runs on `laravel-mediatheque` with S3-compatible storage, so it uses an `s3` storage and the synchronous probe. Eclair is deployed in the same region as Niche's data, and external AI providers stay off for it unless Niche enables them.

The other applications follow once Eclair has run Niche in production for a while.

## laravel-mediatheque 2.0

The mediatheque 2.0 roadmap plans a `Transcoder` contract (local ffmpeg, MediaConvert, Cloudflare Stream) and declarative rendition profiles. Eclair becomes one implementation of that contract, and the 1.x driver is the first version of it.
