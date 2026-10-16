# @eclair-js/client

The JavaScript client of [Eclair](https://github.com/urbania-media/eclair)'s `/v1` API, and the verification of its webhooks and `http` storage requests. It runs in Node 24+ and in browsers, with `fetch` and Web Crypto only.

```ts
import { EclairClient, EclairError } from '@eclair-js/client';

const eclair = new EclairClient({
    url: 'https://eclair.example.com',
    key: process.env.ECLAIR_KEY!,
});

const job = await eclair.jobs.create(
    {
        input: { storage: 'media', path: 'videos/42/original.mov' },
        preset: 'mediatheque/video',
        metadata: { mediaId: 42 },
    },
    { idempotencyKey: 'media-42-v1' },
);

for await (const event of eclair.jobs.events(job.id)) {
    console.log(event.type, event.progress);
}
const done = await eclair.jobs.wait(job.id);
```

Every method throws an `EclairError` when the API answers with an error, with its `status`, its `problem` (RFC 9457, with `errors` by JSON pointer for a 422) and `retryAfter` in seconds for a 429 or a 503.

## API

- `jobs`: `create`, `get`, `list` (by status, date and `metadata` values), `all` (every page), `cancel`, `retry`, `files`, `events` and `wait`.
- `probe(input | file)`: a file's metadata in the response. When it takes longer than `timeout`, the result is `{ status: 'pending', job }`.
- `uploads`: `create` sends a file at once (`probe: true` adds its metadata), `createResumable` sends it in parts with tus and resumes with an `id`; `get` and `delete`.
- `presets`: `list`, `get`, `put` and `delete`.
- `operations()`: the operations the project may use, with their options schema.

## Webhooks

`readWebhook` checks the signature with the project's webhook secret, and returns the event, the delivery id and the job, or `undefined` for a request that isn't from Eclair. Pass the raw body, before JSON parsing. Deliveries can repeat: use the delivery id to handle each once.

```ts
import { readWebhook } from '@eclair-js/client';

const webhook = await readWebhook(request.headers, await request.text(), secret);
if (webhook === undefined) {
    return new Response(null, { status: 401 });
}
```

An application that serves an `http` storage checks Eclair's requests with `verifyStorageRequest(header, secret, path, await sha256(body))`, with `EMPTY_SHA256` for a `GET`.
