# 0017: laravel-eclair implements the mediatheque 2.x `Transcoder` first, the 1.x driver comes after

- Status: accepted
- Date: 2026-10-15
- Supersedes: [0009](0009-laravel-mediatheque-integration.md)

## Context

[0009](0009-laravel-mediatheque-integration.md) planned the integration in two steps: first an opt-in `eclair` driver in a `laravel-mediatheque` 1.x minor release, then Eclair as one implementation of the 2.0 `Transcoder` contract. The 1.x driver came first so that applications could move to Eclair without waiting for 2.0.

Niche, the pilot application that phase 3 moves to Eclair, now starts directly on `laravel-mediatheque` 2.0 ([folkloreinc/laravel-mediatheque#23](https://github.com/folkloreinc/laravel-mediatheque/issues/23)). With the order of 0009, the 1.x driver would have no pilot, and the pilot would have no Eclair integration.

Mediatheque 2.0 has settled its contract ([folkloreinc/laravel-mediatheque#24](https://github.com/folkloreinc/laravel-mediatheque/pull/24)):

- a `Transcoder` is asynchronous and receives a whole pipeline run, which matches an Eclair job and its task graph;
- drivers report each rendition through an idempotent `Recorder` (`started`, `progress`, `completed`, `skipped`, `failed`);
- renditions are declarative and follow Eclair's vocabulary (`video.transcode`, `video.thumbnails`, `audio.waveform`…);
- the drivers of 2.0.0 are `ffmpeg`, `eclair` (in `laravel-eclair`) and `mediaconvert`. The 2.0.0 release depends on `laravel-eclair` being usable.

## Decision

- **`folklore/laravel-eclair`**, in its own repository (`folkloreinc/laravel-eclair`), is the PHP client: API client, verified webhooks, the endpoint for `http` storages, downloads from the temporary storage, a fake for tests. This part of 0009 doesn't change.
- **It first implements the mediatheque 2.x `Transcoder` contract**, with the `eclair` driver and the Eclair `Prober`:
    - one pipeline run is one Eclair job, and each rendition is one task with the same name;
    - the driver reports tasks to the mediatheque's `Recorder` from the webhooks, whose deliveries it deduplicates;
    - the prober uses the synchronous probe ([0012](0012-synchronous-probe.md)), and follows its job when it answers `202`.
- **It supports the PHP and Laravel versions of `laravel-mediatheque` 2: PHP 8.3+ and Laravel 12+.** The mediatheque is a suggested dependency of `laravel-eclair`, not a required one: the client works on its own.
- **Niche moves to Eclair through the 2.x driver**, one media type at a time.
- **The opt-in 1.x driver comes after**, for applications that stay on `laravel-mediatheque` 1.x for a while. It reuses the same client, so `laravel-eclair` then also supports the PHP and Laravel versions of the applications that need it, within those of mediatheque 1.x (PHP 8.2+, Laravel 9+). Which versions is decided when the driver is built, with those applications.
- Eclair still provides `mediatheque/*` presets with the same outputs as the mediatheque's local jobs, for the 1.x driver. The 2.x driver sends the pipeline's renditions as inline tasks instead: they are declared in the application's config.
- Gaps between the mediatheque's contract and the protocol are fixed on Eclair's side with additive changes to `/v1`, each in its own protocol pull request.

## Consequences

- The pilot and the first integration are the same work, and both target the contract that every new application will use.
- `laravel-eclair` 1.0 follows the mediatheque's 2.0 releases: its driver is tested against the mediatheque's alphas, and the mediatheque's 2.0.0 waits for it.
- Applications on mediatheque 1.x wait longer for Eclair, or upgrade to 2.0 first. Phase 3 of the [roadmap](../roadmap.md) no longer includes the 1.x driver.
- Until the 1.x driver exists, `laravel-eclair` doesn't carry the older PHP and Laravel versions of mediatheque 1.x.
