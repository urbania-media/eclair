#!/bin/sh
# Smoke test of the Eclair image. Checks that every binary runs at its expected version and handles
# the formats the operations need, that the ImageMagick and Ghostscript policies apply, and that the
# image user can only write where it should. Run it in the image:
#
#   docker run --rm -v "$PWD/docker/smoke-test.sh:/smoke-test.sh:ro" eclair sh /smoke-test.sh
#
# Prints the checks on stderr and a Markdown table of the versions on stdout. Exits with 1 when a
# check fails.
set -u

# Upstream versions of the binaries. Debian packages are checked on their upstream release, which a
# Debian stable release doesn't change; audiowaveform and whisper.cpp are built at an exact version.
NODE_VERSION=24.
FFMPEG_VERSION=7.1.
IMAGEMAGICK_VERSION=7.1.1-
LIBVIPS_VERSION=8.16.
GHOSTSCRIPT_VERSION=10.05.
POPPLER_VERSION=25.03.
LIBHEIF_VERSION=1.
FONTTOOLS_VERSION=4.57.
BROTLI_VERSION=1.
AUDIOWAVEFORM_VERSION=1.10.3
WHISPER_CPP_VERSION=1.9.5

work=$(mktemp -d "${ECLAIR_TMP_DIR:?ECLAIR_TMP_DIR is not set}/smoke-test.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT
failures=0

pass() {
    echo "ok    $1" >&2
}

fail() {
    echo "FAIL  $1" >&2
    if [ -s "$work/output" ]; then
        tail -n 5 "$work/output" | sed 's/^/      /' >&2
    fi
    failures=$((failures + 1))
}

# check <description> <command…>: the command succeeds.
check() {
    description=$1
    shift
    if "$@" >"$work/output" 2>&1; then pass "$description"; else fail "$description"; fi
}

# refuse <description> <command…>: the command fails.
refuse() {
    description=$1
    shift
    if "$@" >"$work/output" 2>&1; then fail "$description"; else pass "$description"; fi
}

# version <name> <expected prefix> <actual>: records the version for the table.
version() {
    case "$3" in
        "$2"*) pass "$1 $3" ;;
        *) fail "$1 is ${3:-missing}, expected $2*" ;;
    esac
    printf '| %s | %s |\n' "$1" "${3:-missing}" >>"$work/versions.md"
}

# identifies <file> <format>: ImageMagick reads the file as that format.
identifies() {
    [ "$(magick identify -format '%m' "$1")" = "$2" ]
}

# writable <path>: the current user can create a file in that directory.
writable() {
    touch "$1/.smoke-test" && rm "$1/.smoke-test"
}

has_encoder() {
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " $1 "
}

contains() {
    file=$1
    shift
    grep -q "$@" "$file"
}

echo "== Versions" >&2
version Node.js "v$NODE_VERSION" "$(node --version)"
version ffmpeg "$FFMPEG_VERSION" "$(ffmpeg -version | awk 'NR == 1 { print $3 }')"
version ffprobe "$FFMPEG_VERSION" "$(ffprobe -version | awk 'NR == 1 { print $3 }')"
version ImageMagick "$IMAGEMAGICK_VERSION" "$(magick -version | awk 'NR == 1 { print $3 }')"
version libheif "$LIBHEIF_VERSION" "$(dpkg-query -W -f '${Version}' libheif1 2>/dev/null)"
version libvips "$LIBVIPS_VERSION" "$(vips --version | sed 's/^vips-//')"
version Ghostscript "$GHOSTSCRIPT_VERSION" "$(gs --version)"
version poppler "$POPPLER_VERSION" "$(pdftoppm -v 2>&1 | awk 'NR == 1 { print $3 }')"
version audiowaveform "$AUDIOWAVEFORM_VERSION" \
    "$(audiowaveform --version 2>&1 | grep -o '[0-9][0-9.]*' | head -n 1)"
version fonttools "$FONTTOOLS_VERSION" "$(python3 -c 'import fontTools; print(fontTools.version)')"
version 'Brotli (WOFF2)' "$BROTLI_VERSION" "$(python3 -c 'import brotli; print(brotli.__version__)')"
version whisper.cpp "$WHISPER_CPP_VERSION" "$(whisper-cli --version 2>&1 | awk '{ print $3 }')"

echo "== Libraries" >&2
for binary in audiowaveform whisper-cli ffmpeg magick vips gs pdftoppm; do
    path=$(command -v "$binary")
    refuse "$binary finds all its libraries" sh -c "ldd '$path' | grep 'not found'"
done

echo "== ffmpeg" >&2
for encoder in libx264 libx265 libvpx-vp9 libaom-av1 libsvtav1 aac libopus libmp3lame libwebp; do
    check "ffmpeg encodes with $encoder" has_encoder "$encoder"
done
check 'ffmpeg writes HLS' sh -c 'ffmpeg -hide_banner -muxers 2>/dev/null | grep -q " hls "'
check 'ffmpeg encodes H.264 and AAC' ffmpeg -hide_banner -loglevel error \
    -f lavfi -i testsrc2=size=320x240:rate=25:duration=1 -f lavfi -i sine=frequency=440:duration=1 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$work/video.mp4"
check 'ffprobe reads the video' sh -c \
    "ffprobe -v error -show_streams -of json '$work/video.mp4' >'$work/probe.json'"
check 'ffprobe finds H.264 and AAC' sh -c \
    "grep -q '\"codec_name\": \"h264\"' '$work/probe.json' && grep -q '\"codec_name\": \"aac\"' '$work/probe.json'"
check 'ffmpeg extracts a frame' ffmpeg -hide_banner -loglevel error -i "$work/video.mp4" \
    -frames:v 1 "$work/frame.jpg"

echo "== ImageMagick" >&2
check 'ImageMagick loads the Eclair policy' sh -c \
    'magick -list policy | grep -q "/etc/ImageMagick-7/policy.xml"'
check 'ImageMagick creates a PNG' magick -size 64x48 xc:red "$work/image.png"
for format in JPEG GIF TIFF WEBP HEIC AVIF; do
    extension=$(echo "$format" | tr '[:upper:]' '[:lower:]')
    check "ImageMagick writes $format" magick "$work/image.png" "$work/image.$extension"
    check "ImageMagick reads $format" identifies "$work/image.$extension" "$format"
done
printf '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' >"$work/image.svg"
echo "$work/image.png" >"$work/list.txt"
refuse 'ImageMagick refuses SVG' magick "$work/image.svg" "$work/svg.png"
refuse 'ImageMagick refuses PDF' magick "$work/image.png" "$work/image.pdf"
refuse 'ImageMagick refuses PostScript' magick "$work/image.png" "$work/image.ps"
refuse 'ImageMagick refuses text files' magick text:/etc/passwd "$work/passwd.png"
refuse 'ImageMagick refuses @file lists' magick "@$work/list.txt" "$work/list.png"
refuse 'ImageMagick refuses labels' magick -size 64x48 label:Eclair "$work/label.png"
refuse 'ImageMagick refuses images over its limits' magick -size 40000x8 xc:red "$work/wide.png"

echo "== libvips" >&2
for extension in jpg webp heic avif; do
    check "libvips writes .$extension" vips copy "$work/image.png" "$work/vips.$extension"
    check "libvips reads .$extension" vipsheader "$work/vips.$extension"
done
check 'vipsthumbnail makes a thumbnail' vipsthumbnail "$work/image.heic" --size 32 \
    -o "$work/thumbnail.webp"

echo "== Ghostscript and poppler" >&2
check 'Ghostscript writes a PDF' gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -o "$work/document.pdf" \
    -c '/Helvetica findfont 24 scalefont setfont 72 720 moveto (Eclair) show showpage'
check 'Ghostscript renders a PDF' gs -q -dBATCH -dNOPAUSE -sDEVICE=png16m -r36 \
    -o "$work/gs.png" "$work/document.pdf"
gs -q -dNODISPLAY -dBATCH -dNOPAUSE -c '(/etc/passwd) (r) file closefile' >"$work/safer.txt" 2>&1
check 'Ghostscript runs with -dSAFER' contains "$work/safer.txt" invalidfileaccess
check 'pdfinfo reads the PDF' sh -c "pdfinfo '$work/document.pdf' | grep -q '^Pages: *1$'"
check 'pdftoppm renders the PDF' pdftoppm -png -r 36 -singlefile "$work/document.pdf" "$work/poppler"
check 'pdftotext extracts its text' sh -c "pdftotext '$work/document.pdf' - | grep -q Eclair"

echo "== audiowaveform" >&2
check 'ffmpeg encodes WAV and MP3' ffmpeg -hide_banner -loglevel error \
    -f lavfi -i sine=frequency=440:duration=2 "$work/audio.wav" "$work/audio.mp3"
check 'audiowaveform reads WAV' audiowaveform -q -i "$work/audio.wav" -o "$work/wav.json" -b 8
check 'audiowaveform reads MP3' audiowaveform -q -i "$work/audio.mp3" -o "$work/mp3.dat"
check 'audiowaveform draws a PNG' audiowaveform -q -i "$work/audio.wav" -o "$work/audio.png"

echo "== fonttools" >&2
check 'fonttools builds a TrueType font' python3 - "$work/font.ttf" <<'EOF'
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

pen = TTGlyphPen(None)
pen.moveTo((100, 0))
pen.lineTo((300, 700))
pen.lineTo((500, 0))
pen.closePath()
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder([".notdef", "A"])
builder.setupCharacterMap({0x41: "A"})
builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "A": pen.glyph()})
builder.setupHorizontalMetrics({".notdef": (500, 0), "A": (600, 100)})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "Eclair Smoke Test", "styleName": "Regular"})
builder.setupOS2()
builder.setupPost()
builder.save(sys.argv[1])
EOF
for flavor in woff woff2; do
    check "fonttools writes ${flavor}" pyftsubset "$work/font.ttf" --unicodes='*' \
        --flavor="$flavor" --output-file="$work/font.$flavor"
    check "fonttools reads ${flavor}" python3 -c \
        "import sys; from fontTools.ttLib import TTFont; assert TTFont(sys.argv[1]).flavor == '$flavor'" \
        "$work/font.$flavor"
done

echo "== whisper.cpp" >&2
check 'whisper-cli runs' whisper-cli --help

echo "== Entry point and permissions" >&2
refuse 'runs as a non-root user' test "$(id -u)" = 0
check 'TMPDIR is ECLAIR_TMP_DIR' test "${TMPDIR:-}" = "$ECLAIR_TMP_DIR"
check 'ECLAIR_TMP_DIR is writable' writable "$ECLAIR_TMP_DIR"
check '/var/lib/eclair (data volume) is writable' writable /var/lib/eclair
for directory in / /app /app/node_modules /etc/ImageMagick-7 /tmp /var/tmp /usr/local/bin; do
    refuse "$directory is read-only" writable "$directory"
done
check 'the eclair CLI is on PATH' command -v eclair
check 'the entry point runs the eclair CLI' eclair-entrypoint eclair --help
check 'eclair --version runs' eclair --version
# The doctor fails without a database and Redis, but it must find every binary of the image.
eclair doctor >"$work/doctor" 2>&1
check 'eclair doctor runs' grep -Eq '^ok +configuration' "$work/doctor"
refuse 'eclair doctor finds every binary' grep -Eq '^warn +[a-z-]+: (not found|doesn.t run)' "$work/doctor"

printf '| Binary | Version |\n| --- | --- |\n'
cat "$work/versions.md"

if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed." >&2
    exit 1
fi
echo 'All checks passed.' >&2
