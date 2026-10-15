# 0010: Repositories, packages, license and releases

- Status: accepted
- Date: 2026-10-15

## Context

Eclair has a server, a protocol, an operation interface, built-in operations, a JavaScript client and a PHP client. They change together but are installed separately. Composer packages are easier to publish from their own repository.

## Decision

- **`urbania-media/eclair`** is a monorepo with npm workspaces: `@eclair-js/protocol`, `@eclair-js/operation`, `@eclair-js/server` (with the `eclair` CLI), `@eclair-js/client` and the `@eclair-js/operations-*` packages. The Docker image is `ghcr.io/urbania-media/eclair`.
- **`folkloreinc/laravel-eclair`** is a separate repository for `folklore/laravel-eclair`.
- **MIT** license.
- All `@eclair-js/*` packages and the image share one version, managed with changesets. Releases are tagged.
- `main` is the development branch until 1.0. A `v1.x` maintenance branch is created at 1.0.0, as for the other Folklore packages.
- The protocol has its own version (`/v1`), which only changes additively.

## Consequences

- A change to the protocol and its server implementation can be one pull request. The PHP client follows in its own repository.
- The `@eclair-js` npm organization has to be claimed before the first release.
- Eclair is not in scope for on-the-fly image URLs (that stays with `laravel-image`), and ships an API and a CLI before a web dashboard.
