# @eclair-js/protocol

The protocol between [Eclair](https://github.com/urbania-media/eclair) and its clients: the HTTP API, the job format and the webhooks.

- [`schema/openapi.json`](schema/openapi.json): the OpenAPI 3.1 document. It's written by hand and is the reference.
- [`schema/eclair.schema.json`](schema/eclair.schema.json): the same schemas as one JSON Schema (2020-12), for validators that don't read OpenAPI. Reference a definition with `urn:eclair:protocol:v1#/$defs/JobRequest`.
- TypeScript types and a validator, generated from the OpenAPI document.

```ts
import { toProblemErrors, validate } from '@eclair-js/protocol';
import type { JobRequest } from '@eclair-js/protocol';

const result = validate('JobRequest', body);
if (!result.valid) {
    console.log(toProblemErrors(result.errors)); // { "/tasks/h264/op": ["must match pattern …"] }
}
```

The JSON files are also exported: `@eclair-js/protocol/openapi.json` and `@eclair-js/protocol/eclair.schema.json`.

## Changing the protocol

Version 1 only changes additively. Edit `schema/openapi.json`, run `npm run generate -w @eclair-js/protocol` to update the generated files, and open a pull request of its own, reviewed before the code that implements it.
