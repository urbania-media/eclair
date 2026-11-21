---
'@eclair-js/operations-ai': patch
---

`amazon-transcribe` also deletes the empty file Amazon writes in the output folder to check its access, and the examples identify the language among `fr-CA,en-US`: Amazon doesn't identify `en-CA`.
