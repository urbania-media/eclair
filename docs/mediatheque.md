# Laravel and laravel-mediatheque

Most applications that will use Eclair at first are Laravel sites built on [`laravel-mediatheque`](https://github.com/folkloreinc/laravel-mediatheque) (directly or through `laravel-folklore`). They run ffmpeg, ImageMagick and audiowaveform on their own servers today. The goal is to move that work to a shared Eclair without changing how these applications read their files.

The integration comes in two steps ([decision 0017](decisions/0017-mediatheque-2-transcoder-first.md)):

1. `laravel-eclair` implements the `Transcoder` contract of `laravel-mediatheque` 2.x. Niche, the pilot application, moves to Eclair through it.
2. An opt-in driver in a `laravel-mediatheque` 1.x minor release follows, for applications that stay on 1.x for a while. It reuses the same client.

## laravel-eclair

`folklore/laravel-eclair` is the PHP client, in its own repository (`folkloreinc/laravel-eclair`). It follows the protocol published in `@eclair-js/protocol`, and supports the same PHP and Laravel versions as `laravel-mediatheque` 2: **PHP 8.3+ and Laravel 12+**.

It provides:

- a client for the API: `Eclair::jobs()->create(...)`, `find()`, `cancel()`, `retry()`, and presets;
- a webhook route that verifies the signature, ignores deliveries it already handled (`Eclair-Delivery`), and dispatches `JobCompleted`, `JobFailed`, `JobCanceled` and `TaskCompleted` events;
- the endpoint for `http` storages: it serves inputs and receives outputs on a Laravel disk, with signed requests, for applications that keep files on their own disk;
- downloading outputs from Eclair's temporary storage to a Laravel disk, for applications that would rather pull than receive;
- `Eclair::probe()`, the synchronous probe;
- the `eclair` transcoder and prober of `laravel-mediatheque` 2.x (below);
- `Eclair::fake()` with assertions, to test applications without a server;
- an `eclair:status` command that checks the connection, the key and the storages.

`laravel-mediatheque` is a suggested dependency: the client works without it.

Configuration: `ECLAIR_URL`, `ECLAIR_KEY`, `ECLAIR_WEBHOOK_SECRET`, and the name of the Eclair storage to use for each Laravel disk.

## The mediatheque 2.x transcoder

Mediatheque 2.0 runs pipelines through an asynchronous `Transcoder` contract: a driver receives a whole pipeline run, starts it, and reports each rendition to a `Recorder` (`started`, `progress`, `completed`, `skipped`, `failed`). Renditions are declarative, and their operations and options follow Eclair's vocabulary. The contract is drafted in [folkloreinc/laravel-mediatheque#24](https://github.com/folkloreinc/laravel-mediatheque/pull/24) (`docs/architecture.md`, decisions 0004 and 0005).

An application picks Eclair per pipeline:

```php
// config/mediatheque.php
'pipelines' => [
    'video' => [
        'transcoder' => 'eclair',
        'renditions' => [
            'h264' => ['op' => 'video.transcode', 'codec' => 'h264', 'max_width' => 1920],
            'poster' => ['op' => 'video.poster', 'role' => 'poster'],
            'thumbnails' => ['op' => 'video.thumbnails', 'count' => 5, 'role' => 'thumbnail'],
        ],
    ],
],
```

The same pipeline runs on the mediatheque's `ffmpeg` driver: switching is configuration, and handles, paths and URLs stay the same.

### Probe

The mediatheque probes a media in a queued job before its pipeline runs. The Eclair prober calls `POST /v1/probe` ([decision 0012](decisions/0012-synchronous-probe.md)) and fills the media's metadata from the result. When the probe takes longer than its timeout, Eclair answers `202` with a job: the prober records the job's id, and the media stays `pending` until the job's webhook brings the metadata. Applications that let Eclair probe and process their media no longer need ffprobe or ImageMagick on their own servers.

### How a pipeline run goes

1. **Submit.** `submit(PipelineRun)` sends one Eclair job for the whole run and returns its id, which the mediatheque stores as the run's `external_id`. The request has an `Idempotency-Key` derived from the run and its attempt, so a retried queue job doesn't create a second job.
    - The input is the media's original, as a path on the Eclair storage that maps to the original's disk (see [Disks and storages](#disks-and-storages)).
    - Each rendition becomes a task with the same name. Rendition names follow the mediatheque's handle rule (letters, digits, `_` and `-`, no dots), which Eclair's task names accept. `op`, `from`, `when` and `keep` map directly; the other keys become the task's `options`.
    - When a rendition has a duration condition, the driver adds a `probe` task that the conditional tasks run after, because Eclair evaluates `minDuration` and `maxDuration` on the job's own probe.
    - The output prefix comes from the mediatheque's path formatter, and the path pattern places each task's files under it.
    - `metadata` holds the media's `uid` and the run's id. The webhook is `laravel-eclair`'s route.
2. **Webhooks.** Every webhook body is the whole job. The driver checks the signature, drops deliveries it already handled, finds the run by the job id, and reconciles every task with the `Recorder`. Deliveries can arrive more than once or out of order: the `Recorder` ignores a call that would move a rendition back to an earlier status, so reconciling an old snapshot changes nothing.
3. **Recorder calls.** For each task of the job:

    | Eclair task                          | Recorder call                                                                                         |
    | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
    | `running`, or ended with `startedAt` | `started`                                                                                             |
    | `completed`                          | `completed`, with the task's files and its `metadata` output (palette, blurhash, scenes…)             |
    | `skipped`                            | `skipped`: its `when` didn't match, or the task it reads from was skipped                             |
    | `failed`                             | `failed`, with the task's error code and message. `dependency_failed` marks a task whose input failed |
    | `canceled`                           | the rendition is canceled. The `Recorder` has no call for it yet (see [Open points](#open-points))    |

4. **End.** On `job.completed`, `job.failed` or `job.canceled`, the run ends with the same events and statuses as a local run.

`cancel(PipelineRun)` calls `POST /v1/jobs/{id}/cancel`. Progress comes from `GET /v1/jobs/{id}` or its server-sent events: webhooks are only sent when a task completes and when the job ends.

### Disks and storages

Eclair reads inputs from and writes outputs to storages registered on the project. `laravel-eclair` maps each Laravel disk to one of them:

- **S3-compatible disks** map to an `s3` storage on the same bucket. Paths are relative to the same root on both sides: the disk's `root` and the storage's prefix must match.
- **Local disks** map to an `http` storage served by `laravel-eclair`'s endpoint, or use Eclair's temporary storage (`eclair`), from which `laravel-eclair` downloads the outputs to the disk before recording them.

`eclair:status` and `mediatheque:doctor` check that every disk a pipeline uses has a storage.

### Open points

The review of the contract from Eclair's side is on [folkloreinc/laravel-mediatheque#24](https://github.com/folkloreinc/laravel-mediatheque/pull/24). The points that need additive changes to the protocol each get their own protocol pull request:

- output files with their own dimensions, duration and bitrate, so the mediatheque doesn't probe each rendition again;
- an explicit index for the files of a group (thumbnails, document pages), listed in the job and its webhook;
- a reason on skipped tasks;
- a `canceled` call on the mediatheque's `Recorder`, for tasks that Eclair cancels on its own (`failFast`, an operator);
- a visibility for output files, so they follow the media's visibility on S3-compatible storages;
- a task input other than the job's input, for a run that only produces the renditions that are missing;
- `metadata` on probe requests, so a probe that answers `202` can be matched to its media without a lookup.

## The mediatheque 1.x driver (later)

After the 2.x transcoder, a minor release of `laravel-mediatheque` 1.x adds an opt-in driver that sends pipelines to Eclair instead of dispatching its own jobs. It is additive: nothing changes for applications that don't enable it, and `laravel-eclair` is a suggested dependency, not a required one. It runs on the PHP and Laravel versions of the applications that need it, within those of 1.x ([decision 0017](decisions/0017-mediatheque-2-transcoder-first.md)).

```php
// config/mediatheque.php
'pipelines' => [
    'video' => [
        'driver' => 'eclair',
        'preset' => 'mediatheque/video',
    ],
],
```

It works like the 2.x transcoder, with the 1.x model:

- the mediatheque creates the `Pipeline` and `PipelineJob` rows as usual, then sends one Eclair job, whose tasks are named after the mediatheque jobs' handles (`h264`, `webm`, `thumbnails`…) and use the `mediatheque/*` presets;
- on `task.completed`, the driver attaches each output file to the media under the task's name, as the local jobs do, and marks the `PipelineJob` as ended. Thumbnails are attached as `thumbnails.0`, `thumbnails.1`…;
- on the job's end, the pipeline ends, with the same events and statuses as a local run.

Handles, file paths, sources and URLs stay the same, so `laravel-folklore` and the applications that read `$media->files->h264` see no difference.

| Mediatheque 1.x job          | Eclair task                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `Video\H264`, `WebM`, `HEVC` | `video.transcode` with the same codec, size and bitrate            |
| `Video\Thumbnails`           | `video.thumbnails` with `count` and `inMiddle`                     |
| `Video\HLS`                  | `video.hls` with the same renditions and segment duration          |
| `Video\MediaConvert`         | Not needed: Eclair replaces it                                     |
| `Audio\Mp3`                  | `audio.transcode` with `codec: mp3` and the same bitrate           |
| `Audio\Thumbnails`           | `audio.waveform`, image output with the same size and colors       |
| `Document\Thumbnails`        | `document.thumbnails` with the same resolution, quality and format |
| `Font\WebFonts`              | `font.convert`                                                     |
| Metadata readers             | `probe`                                                            |

WebM outputs are VP9 and Opus, where the mediatheque's `WebM` job writes VP8 and Vorbis: same container and handle, with codecs that every browser that plays WebM reads.

Each mediatheque job's options are translated by the driver, so an application's custom pipeline options keep working. A job class that has no Eclair equivalent (a custom job in an application) keeps running locally, and the driver splits the pipeline between Eclair and the local queue.

## Moving an application to Eclair

1. Register the application as a project in Eclair, with a key and a storage that points to its bucket. Applications that keep files on their own disk use an `http` storage served by `laravel-eclair`, or Eclair's temporary storage, from which `laravel-eclair` downloads the outputs.
2. Install `folklore/laravel-eclair` with `laravel-mediatheque` 2 (or, later, the 1.x release with the driver).
3. Set the transcoder of one pipeline to `eclair` (audio or documents first), compare outputs with the `ffmpeg` driver, then move the others.
4. Once every type runs on Eclair, remove the binaries from the application's servers and reduce their size.

## Pilot: Niche

Niche, URBANIA's content platform, is the first application on Eclair. It starts directly on `laravel-mediatheque` 2.0 and moves to Eclair through the 2.x transcoder, one media type at a time. It runs with S3-compatible storage, so it uses an `s3` storage and the synchronous probe. Eclair is deployed in the same region as Niche's data, and external AI providers stay off for it unless Niche enables them.

The other applications follow once Eclair has run Niche in production for a while.
