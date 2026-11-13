# 0022: Embeds, probed through providers and downloaded on opt-in

- Status: proposed
- Date: 2026-11-13
- Issues: [#103](https://github.com/urbania-media/eclair/issues/103), [#104](https://github.com/urbania-media/eclair/issues/104)

## Context

Applications keep videos and audio that live on platforms (YouTube, Vimeo, Dailymotion, SoundCloud, Spotify, TikTok, Instagram) next to their own media. They need:

- **Their metadata**: kind, title, author, duration, dimensions and thumbnail. Today each application calls each platform's API with its own keys, or reads oEmbed without a duration.
- **Later, their files**: a creator imports or archives their own video, then processes it like an upload (`video.transcode`, `video.poster`…).

A `{ "url" }` input is a direct file. The worker downloads it before each task, so a page URL is probed as HTML (`kind: other`). Platforms don't give files at their page URLs. Some give them through their API to the owner (Vimeo's download links, Instagram's `media_url`), and others only through tools such as yt-dlp. yt-dlp changes almost every week, makes its own requests outside the SSRF guard, and is often blocked from datacenter addresses.

## Decision

- **An `embed` input**, `{ "embed": "<https page URL>" }`, joins the forms of `Input` for jobs and probes. The worker never fetches it. Only operations that accept embeds (`accepts.embeds`) read it, and other tasks read what `embed.download` wrote, with `from`.
    - Reusing `{ "url" }` with a flag would give one field two meanings.
    - Detecting platform hosts inside `{ "url" }` would change what existing inputs do.
- **Two operations**, in a new built-in package, `@eclair-js/operations-embed`:
    - `embed.probe` writes the probe's metadata, with an `embed` object: provider, id, canonical URL, player URL, title, description, author, thumbnail, publication date, `embeddable`, `live`, privacy, and the provider's oEmbed HTML. It runs on the `probe` queue, and `POST /v1/probe` runs it for an embed input.
    - `embed.download` writes the media file. It runs on a new `network` capability, so a download holds neither the `video` slots nor the CPU's while it waits on the network.
- **Providers come from an allowlist.**
    - Each provider of the server has URL patterns. A project uses those of its `embedProviders`, and none when the setting isn't set.
    - Eclair never requests the URL it is given. It reads the id from it, then calls the provider's API or oEmbed endpoint, through the SSRF guard. There is no oEmbed discovery.
- **Official APIs and oEmbed come first:**
    - YouTube: the Data API, or oEmbed without a key;
    - Vimeo: oEmbed, or the API for private videos;
    - Dailymotion: its public API;
    - Spotify: oEmbed, and the Web API for durations;
    - SoundCloud, TikTok and Instagram: oEmbed.
    - yt-dlp is a later backend for what they don't give: some durations, and the files of YouTube, Dailymotion, SoundCloud, TikTok and Instagram. It runs in an opt-in variant of the image, and its egress is restricted by the deployment.
- **Credentials:**
    - Each project has its own provider credentials, such as a YouTube Data API key or a Vimeo token. They are set through the admin API, encrypted with `ECLAIR_SECRET_KEY`, and never shown again.
    - The operator can set server-wide fallbacks in environment variables (`ECLAIR_PROVIDER_<PROVIDER>_<KEY>`, such as `ECLAIR_PROVIDER_YOUTUBE_API_KEY`), so the server knows no provider by name.
    - Tokens of an application's end users never reach Eclair. The application resolves a direct file URL with them, and sends it as a `{ "url" }` input.
- **Downloads are off by default.**
    - `embedDownload` lists the providers a project may download from, and `embedMaxDuration` limits how long a downloaded embed can be.
    - The project is responsible for its rights to what it downloads, and for the platforms' terms. Downloading is meant for content that the project's users own.
    - `embed.probe` returns the author's id, so that an application can compare it with its user's connected account.
- **Errors:** `provider_unavailable` (private, deleted, or blocked where the server is) and `provider_refused` (a rate limit or a bot check) join the task error codes.
- **Caching:** the results of providers are cached in Redis for a while, per project and per video, so a repeated probe doesn't spend the project's API quota.

## Consequences

- An application probes an embed the way it probes a file, and Eclair holds the API clients of every provider for all of them.
- A downloaded embed is an ordinary file afterwards. It goes through the existing operations, and Eclair still keeps no media (0002).
- The protocol changes additively: an input form, an `embed` object on the probe, three project settings, two error codes, admin endpoints for credentials, and `accepts.embeds` on operations. Until `@eclair-js/operations-embed` exists, the server refuses embed inputs.
- Each provider is code to maintain against an outside API. yt-dlp needs regular updates of the image, and it can stop working from a server's address at any time: downloads through it are best effort.
- Embed probes and downloads count toward the project's rate limits, concurrency and usage like other tasks.
