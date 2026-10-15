# 0009: laravel-eclair and an opt-in driver in laravel-mediatheque 1.x

- Status: accepted
- Date: 2026-10-15

## Context

The applications that will share Eclair first run `laravel-mediatheque` 1.1, and process media on their own servers. Mediatheque 2.0 plans a `Transcoder` contract, but waiting for 2.0 would delay the savings by the whole migration of every application.

## Decision

- **`folklore/laravel-eclair`**, in its own repository (`folkloreinc/laravel-eclair`), is the PHP client: API client, verified webhooks, the endpoint for `http` storages, a fake for tests. It supports the same PHP and Laravel versions as mediatheque 1.x.
- **A minor release of `laravel-mediatheque` 1.x** adds an opt-in `eclair` pipeline driver. It sends a pipeline as one Eclair job whose tasks are named after the mediatheque handles, and attaches outputs under those handles when the webhooks arrive.
- `laravel-eclair` is a suggested dependency of the mediatheque, not a required one.
- Eclair provides `mediatheque/*` presets with the same outputs as the mediatheque's local jobs.
- In mediatheque 2.0, Eclair becomes one implementation of the `Transcoder` contract.

## Consequences

- Applications move to Eclair with configuration, one media type at a time, and nothing changes for code that reads files by handle.
- The driver must follow the mediatheque's 1.x rules: additive, opt-in, no change to existing behavior when it is off.
- Custom jobs without an Eclair equivalent keep running locally.
