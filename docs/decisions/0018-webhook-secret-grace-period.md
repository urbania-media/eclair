# 0018: The previous webhook secret stays valid for a grace period after a rotation

- Status: accepted
- Date: 2026-10-16

## Context

Each project has one webhook secret ([0003](0003-projects-and-api-keys.md)). It signs the project's webhooks (HMAC-SHA256 over `{t}.{body}`) and the requests to its `http` storages (over `{t}.{path}.{sha256}`). Eclair never verifies anything with it: only the application does.

`eclair projects:secret <project> --rotate` and `POST /admin/v1/projects/{project}/webhook-secret` replace the secret at once. Until the application is deployed with the new one, it refuses every webhook and every storage request: deliveries pile up in retries, and the tasks that read or write an `http` storage fail. A planned rotation therefore means an outage, however short, and a hurried deployment.

The `Signature` format already allows several `v1` values (`t=…,v1=…,v1=…`), valid if one of them matches, and both clients (`@eclair-js/client` and `laravel-eclair`) check them that way.

## Decision

- **A rotation keeps the previous secret for a grace period, 24 hours by default.** `eclair projects:secret <project> --rotate --grace <duration>` (`30m`, `2h`, `3d`) and `POST /admin/v1/projects/{project}/webhook-secret` with `{ "grace": <seconds> }` choose it; `0` drops the previous secret at once, as before. The grace period is at most 7 days.
- **During the grace period, Eclair signs with both secrets**: `Eclair-Signature: t=…,v1=<new>,v1=<previous>`, the new secret first, with the same timestamp. An application with either secret accepts the request, so it can be deployed with the new secret at any time during the grace period. Nothing changes for receivers.
- **At most two secrets.** Rotating again during a grace period makes the current secret the previous one, with the new grace period, and drops the older one.
- **Storage.** The previous secret is stored encrypted with `ECLAIR_SECRET_KEY`, like the current one, in `projects.previous_webhook_secret`, with `projects.previous_webhook_secret_expires_at`. Both columns are added by a new migration, nullable, on MySQL, PostgreSQL and SQLite. The expiry is compared when the secrets are read, so an expired secret is never used, and is cleared at the next rotation.
- **The admin API says when the previous secret expires.** `WebhookSecret`, returned by `GET` and `POST /admin/v1/projects/{project}/webhook-secret`, gets `previousSecretExpiresAt` while a previous secret is valid. The previous secret itself is never returned again: the application already has it.

## Consequences

- A planned rotation has no downtime: rotate, deploy the application with the new secret within the grace period, and webhooks and storage requests keep working throughout.
- The grace period doesn't extend what a leaked secret allows. Eclair only signs with it; the application is what trusts it, and it stops trusting the old secret when it's deployed with the new one. `--grace 0` is for when the old secret must not appear in Eclair's requests any more, at the cost of refused requests until the application is updated.
- Webhook retries sign every attempt with the secrets valid at that time, so a delivery that failed before the rotation succeeds once the application has either secret.
- The grace period can't be ended early, other than by rotating again with `--grace 0`. An option for it can be added later if operators need it.
- The protocol change is additive: an optional request body and an optional response property.
