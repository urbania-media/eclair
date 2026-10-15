# 0013: Fastify for the HTTP API

- Status: accepted
- Date: 2026-10-15

## Context

The API authenticates projects, validates job bodies against the protocol, answers JSON and `application/problem+json`, streams server-sent events and serves `/metrics`, `/health` and `/ready`. It also receives files: direct and resumable (tus) uploads to the temporary storage ([0011](0011-temporary-storage.md)), and files sent to the synchronous probe, which holds the request open until the probe ends or times out ([0012](0012-synchronous-probe.md)). The admin API sits next to it with another kind of token. The protocol is written first, as OpenAPI 3.1 and JSON Schema in `@eclair-js/protocol` (see `AGENTS.md`), and logs are structured JSON with pino ([architecture](../architecture.md#observability)).

Options considered:

- **Fastify 5.** Validates requests and serializes responses with JSON Schema (Ajv), so routes can use the protocol's schemas as they are. pino is its logger. Encapsulated plugins and hooks give each API its own authentication. Mature, maintained and fast. Its default Ajv targets draft-07, so the protocol's 2020-12 schemas need a custom Ajv instance.
- **Hono.** Small, built on Web-standard `Request` and `Response`, runs on any runtime. That portability is of no use here: Eclair runs on Node in its Docker image. Validation and OpenAPI go through Zod or Valibot adapters rather than JSON Schema.
- **Express 5.** Known by everyone, but has no validation, serialization or logging built in: each would be added by hand.
- **NestJS.** Structure, dependency injection and OpenAPI from decorators. Heavy for one API, and its OpenAPI document comes from the code, while here the code follows the document.

## Decision

- The API and the admin API use **Fastify 5**, in `@eclair-js/server`.
- Routes validate their bodies, parameters and responses with the **schemas of `@eclair-js/protocol`**, registered with `addSchema()` and referenced by id. Fastify's validator is an **Ajv 2020-12** instance, the same one that validates operation options (see [0015](0015-typebox-for-options-schemas.md)).
- Route handlers are typed with the TypeScript types that `@eclair-js/protocol` generates from its OpenAPI document.
- `/v1` and `/admin/v1` are two encapsulated plugins, each with its own authentication hook. One error handler answers `application/problem+json`.
- The OpenAPI document is not generated from the routes (no `@fastify/swagger`). A test checks that every route of the server is in the document, and the reverse.
- Logging uses Fastify's pino logger, with the project, job and task ids bound to each request.

## Consequences

- The protocol stays the only source of the API's shape: changing a body means changing `@eclair-js/protocol` first, as `AGENTS.md` requires.
- Invalid requests are refused before any handler runs.
- Server-sent events write to the raw reply. They need care with Fastify's lifecycle (no serialization, cleanup on disconnect), covered by tests.
- Uploads stream to the temporary storage without buffering the file: `@fastify/multipart` for form uploads, a pass-through content-type parser for raw bodies, and the tus server (`@tus/server`, which works on Node's request and response) mounted under `/v1/uploads` for resumable ones. Body size limits are set per route from the project's limits.
- Fastify is a dependency of `@eclair-js/server` only. Clients and operations don't depend on it.
