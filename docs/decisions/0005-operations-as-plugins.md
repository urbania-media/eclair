# 0005: Operations are typed plugins

- Status: accepted
- Date: 2026-10-15

## Context

The list of things to do with media keeps growing: palettes, extracts, vertical versions, focal points, transcription. A closed list in the core would make each new operation a change to the server. Shell commands declared in configuration were considered and rejected: they are hard to validate and to secure.

## Decision

- Every operation implements the `@eclair-js/operation` interface: name, major version, accepted inputs, capability, required binaries, options schema, outputs and `run()`.
- Built-in operations are packages (`@eclair-js/operations-*`) that use the same interface as third-party ones. The server never imports an operation directly.
- Extra plugins are npm packages listed in `ECLAIR_PLUGINS`.
- Operations only use the context they are given: they don't read the environment, the database or other projects' data, and they don't upload files themselves.
- Breaking changes to an operation's options or outputs make a new major version, and the old one keeps working.

## Consequences

- The interface is public API from 1.0, and changes only in a major version.
- Plugins that need new binaries require a custom image built from the official one.
- `GET /v1/operations` publishes every operation's schema, so clients can validate and build forms.
