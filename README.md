# Eclair

Eclair is a self-hosted media processing server. It converts media files and extracts their metadata: video transcoding and HLS, thumbnails, audio waveforms, document previews, web fonts, color palettes, focal points, vertical reframing, transcription and more.

Applications send it a job over HTTP. Eclair reads the original file from the application's own storage, runs a pipeline of operations on dedicated workers, writes the results back to that storage and calls a webhook when it is done.

> **Status: design phase.** Nothing is published yet. The architecture and the plan are in [`docs/`](docs/README.md) and the roadmap is tracked in [#1](https://github.com/urbania-media/eclair/issues/1).

## Why

Media processing needs heavy binaries (ffmpeg, ImageMagick, audiowaveform…), lots of CPU, sometimes a GPU, and careful operations. When every application does it on its own web servers, each one is sized for its peaks, installs and patches the same binaries, and pays for idle capacity.

Eclair moves this work to one service that several applications share:

- **One place to optimize.** Workers are sized and tuned for media work, and scale out by adding servers.
- **Lighter applications.** Web servers no longer need ffmpeg or ImageMagick.
- **Files stay where they are.** Eclair reads from and writes to each application's storage. Applications without one can upload files to Eclair and pick up outputs from its temporary storage before they expire.
- **Metadata right away.** A synchronous probe returns a file's type, dimensions and duration in seconds, so applications have them at upload time.
- **Extensible.** Every operation is a typed plugin. New conversions and extractions are added as npm packages.

## How it works

```
 Application                       Eclair                                  Storage
 ───────────                       ──────                                  ───────
 POST /v1/jobs  ─────────────────▶ API ── queue ──▶ worker ◀─── reads ──── original
   pipeline or preset                │               │  runs operations
                                     │               └──── writes ───────▶ outputs
 webhook  ◀──────── job completed ───┘
   outputs + metadata
```

A job names an input, a destination and either a preset or an inline pipeline:

```json
{
    "input": { "url": "https://example.com/uploads/interview.mov" },
    "output": { "storage": "media", "prefix": "videos/42/" },
    "tasks": {
        "probe": { "op": "probe" },
        "h264": { "op": "video.transcode", "options": { "codec": "h264", "maxHeight": 1080 } },
        "hls": { "op": "video.hls", "from": "h264" },
        "thumbnails": { "op": "video.thumbnails", "options": { "count": 5 } }
    },
    "webhook": "https://example.com/eclair/webhook"
}
```

See [`docs/protocol.md`](docs/protocol.md) for the API and [`docs/operations.md`](docs/operations.md) for the operations.

## Packages

| Package                                                   | Content                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@eclair-js/server`                                       | API, workers and the `eclair` CLI                                       |
| `@eclair-js/protocol`                                     | OpenAPI document, JSON Schemas and TypeScript types                     |
| `@eclair-js/operation`                                    | Interface and helpers to write operations                               |
| `@eclair-js/operations-*`                                 | Built-in operations: `image`, `video`, `audio`, `document`, `font`, `ai` |
| `@eclair-js/client`                                       | JavaScript client and webhook verification                              |
| [`folklore/laravel-eclair`](docs/mediatheque.md)          | PHP client for Laravel, and the bridge to `laravel-mediatheque`          |
| `ghcr.io/urbania-media/eclair`                            | Docker image with every binary the built-in operations need             |

## Deploying

Eclair ships as one Docker image that runs as `api`, `worker` or both. It needs MySQL or PostgreSQL, and Redis. A single server runs everything. To scale out, add worker servers, and route heavy or GPU operations to the workers that can run them. See [`docs/deployment.md`](docs/deployment.md).

## Laravel and laravel-mediatheque

[`laravel-mediatheque`](https://github.com/folkloreinc/laravel-mediatheque) can hand its pipelines to Eclair instead of running ffmpeg on the application's servers. The integration is opt-in and keeps the same file handles, so existing applications don't change. See [`docs/mediatheque.md`](docs/mediatheque.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/README.md) first. Report security problems privately through a [GitHub security advisory](https://github.com/urbania-media/eclair/security/advisories/new), never in a public issue.

## License

[MIT](LICENSE)
