---
'@eclair-js/operations-image': minor
'@eclair-js/server': minor
---

Add `@eclair-js/operations-image`, on libvips: `image.convert` (JPEG, PNG, WebP or AVIF within a size, auto-oriented, in sRGB, without EXIF, GPS or other metadata), `image.thumbnail` (thumbnails at given sizes, fitted or cropped, from an image or the first page of a PDF) and `image.palette` (the dominant colors and their share). They read JPEG, PNG, WebP, GIF, AVIF, HEIC, HEIF, TIFF and SVG, with libvips' untrusted loaders blocked except librsvg for SVG. The server loads the package.
