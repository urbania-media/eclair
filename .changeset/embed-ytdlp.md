---
'@eclair-js/operation': minor
'@eclair-js/operations-embed': minor
'@eclair-js/server': minor
---

yt-dlp for embeds (decision 0022), in the new `-embed` variant of the image: `embed.download` downloads YouTube, Dailymotion, SoundCloud, TikTok and Instagram embeds with it, and `embed.probe` fills what the providers' APIs don't give (durations) with `complete: true`. yt-dlp runs on the provider's canonical URL with its extractor only, without configuration, cookies, cache or account, with the project's limits as filters; its refusals become `provider_refused` and `provider_unavailable`. Operations can declare `optionalBinaries`, which `eclair doctor` doesn't warn about, and embed operations get `exec()` and `available()`. Binaries inherit the worker's `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, so an egress proxy can restrict yt-dlp. `YTDLP_BIN` sets its path.
