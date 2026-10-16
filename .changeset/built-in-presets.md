---
'@eclair-js/server': minor
---

Ship the built-in presets: `web-video`, `web-audio`, `web-image`, and the `mediatheque/video`, `mediatheque/audio`, `mediatheque/document` and `mediatheque/font` pipelines of laravel-mediatheque 1.x, with the same task names and outputs. Every project sees them below the global presets of the database: a global preset with the same name replaces one, and they can't be removed.
