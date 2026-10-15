#!/bin/sh
# Entry point of the Eclair image. `api`, `worker` and `all` start the server in that role,
# `eclair …` runs the CLI, and any other command runs as is (`sh`, `ffmpeg -version`…).
set -eu

usage() {
    cat <<'EOF'
Usage: docker run ghcr.io/urbania-media/eclair <command>

Commands:
  api        the API and the scheduler
  worker     a worker for the queues in ECLAIR_QUEUES
  all        the API, the scheduler and a worker, for a single server
  eclair …   the eclair CLI
EOF
}

# Every binary writes its temporary files to ECLAIR_TMP_DIR, the only writable path for tasks.
tmp_dir="${ECLAIR_TMP_DIR:-/tmp/eclair}"
mkdir -p "$tmp_dir" 2>/dev/null || true
export ECLAIR_TMP_DIR="$tmp_dir" TMPDIR="$tmp_dir" MAGICK_TEMPORARY_PATH="$tmp_dir"

case "${1:-}" in
    '')
        usage >&2
        exit 64
        ;;
    -h | --help | help)
        usage
        exit 0
        ;;
    api | worker | all)
        set -- eclair "$@"
        ;;
esac

if [ "$1" = eclair ]; then
    if ! command -v eclair >/dev/null 2>&1; then
        echo "eclair: this image has no eclair CLI yet. The server isn't implemented: the image" \
            "only ships the binaries for now (https://github.com/urbania-media/eclair/issues/1)." >&2
        exit 69
    fi
    if [ ! -d "$tmp_dir" ] || [ ! -w "$tmp_dir" ]; then
        echo "eclair: ECLAIR_TMP_DIR ($tmp_dir) must be a directory writable by $(id -un)." >&2
        exit 73
    fi
fi

exec "$@"
