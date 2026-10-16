---
'@eclair-js/protocol': minor
---

Webhook secret rotation with a grace period: `POST /admin/v1/projects/{project}/webhook-secret` takes an optional `{ "grace": <seconds> }` (`WebhookSecretRotation`), `WebhookSecret` gets `previousSecretExpiresAt`, and the `Signature` format says that during the grace period a request carries a `v1` value for the current and the previous secret.
