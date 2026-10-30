---
'@eclair-js/operations-core': minor
'@eclair-js/operations-image': minor
'@eclair-js/server': minor
---

`probe` takes a `thumbhash` option (`false` by default, `thumbhash` in `POST /v1/probe`) that adds a ThumbHash placeholder of images other than SVG: their first frame, upright, in sRGB, fitted in 100×100 by libvips. HEIC and HEIF sequences (`image/heic-sequence`, `image/heif-sequence`) are read at their primary image by `probe` and by `image.convert`, `image.thumbnail` and `image.palette`, which refused them.
