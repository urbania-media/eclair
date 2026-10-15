# 0015: TypeBox for options schemas, Ajv to validate

- Status: accepted
- Date: 2026-10-15

## Context

Every operation declares the JSON Schema of its options ([0005](0005-operations-as-plugins.md)). The API validates each task's options against it when a job is created, `GET /v1/operations` publishes it, and clients (the PHP one included) validate or build forms from it. The operation's `run(ctx, options)` should get typed options from the same declaration, without writing the type twice. Third-party plugins declare their schemas the same way.

What the server validates must be exactly what it publishes. A library whose own validator does more than the JSON Schema it exports (refinements, transforms) would accept or refuse things that clients can't predict.

Options considered:

- **TypeBox** (`typebox` 1.x). Builders that return plain JSON Schema objects, with the TypeScript type inferred by `Static<typeof schema>`. The schema needs no conversion: what the operation declares is what is published and what Ajv validates. Fastify has a type provider for it.
- **Zod 4.** Used by `@panneau/protocol`, so the team knows it. Its JSON Schema comes from a conversion (`z.toJSONSchema()`) that drops refinements and transforms, and validation would run through Zod rather than the published schema. Two sources that can disagree.
- **Valibot.** Same model as Zod, smaller, with the same conversion problem.
- **Plain JSON Schema** with `json-schema-to-ts` for the types. No library at run time, but schemas are verbose to write, and inferring types from large `as const` schemas is slow for the compiler.

## Decision

- Operations declare their options with **TypeBox**. `defineOperation()` in `@eclair-js/operation` takes the schema and types `run()`'s options with `Static<>`. It also accepts a plain JSON Schema object, for plugins that don't use TypeBox, with untyped options.
- **Ajv** with the **JSON Schema 2020-12** dialect is the only validator in the server: for operation options, for the protocol schemas in Fastify routes ([0013](0013-fastify.md)), and for the server's configuration. It runs with `useDefaults`, so defaults in a schema are applied, and with `allErrors`, so a client gets every error at once.
- Option schemas are restricted to what both Ajv and a PHP validator handle: no custom keywords, no `format` beyond the standard ones, `additionalProperties: false` on objects.
- **The protocol itself stays hand-written** OpenAPI 3.1 and JSON Schema in `@eclair-js/protocol`. It's the contract read by clients in other languages, so it's reviewed as data, not generated from TypeScript. Its TypeScript types are generated from it.

## Consequences

- One validator and one schema language from the HTTP request to the operation.
- The options schema published by `GET /v1/operations` is the one validated, so a client that validates locally gets the same result.
- Eclair uses TypeBox where `panneau-js` uses Zod. The reason is the target: Eclair's schemas are a published JSON contract, Panneau's are mostly read by its own TypeScript code.
- TypeBox becomes a dependency of `@eclair-js/operation`, so a plugin author gets it with the interface.
