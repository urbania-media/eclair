---
'@eclair-js/server': minor
---

Rotating a project's webhook secret keeps the previous one valid for a grace period, 24 hours by default: until it expires, webhooks and `http` storage requests carry a `v1` signature for each secret, so the application can move to the new secret without refusing any request. `eclair projects:secret <project> --rotate` takes `--grace <duration>` (`0` drops the previous secret at once, at most `7d`), and `POST /admin/v1/projects/{project}/webhook-secret` takes `{ "grace": <seconds> }`. Both say when the previous secret expires. The `0003-previous-webhook-secret` migration adds two nullable columns to `projects`: run `eclair migrate`.
