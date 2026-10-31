---
'@eclair-js/dashboard': patch
---

Use Panneau `5.0.0-alpha.9`, which fixes the last limits the dashboard worked around. The jobs list pages with the admin API's cursors, without a made-up total. A job's page is at `/dashboard/pages/job/{id}`. The pages use Panneau's page header, and the edit pages show their actions in it. Statuses are options with a tone. The S3 secret key is typed in a password field.
