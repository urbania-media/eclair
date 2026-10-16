#!/bin/sh
# End-to-end test of a compose file with a built image: start Eclair with its database and Redis,
# create a project and a key with the CLI, then probe an image and run a job over HTTP.
#
#   docker tag <image> ghcr.io/urbania-media/eclair:e2e
#   ECLAIR_VERSION=e2e sh docker/e2e.sh compose.yml
#
# It uses its own compose project (eclair-e2e) and env file, and removes both when it ends.

set -eu

cd "$(dirname "$0")"
file=${1:-compose.yml}
project=eclair-e2e
port=${E2E_PORT:-18080}
fixture=../packages/operations-core/fixtures/image.png
env_file=.env.e2e

export ECLAIR_VERSION="${ECLAIR_VERSION:-e2e}" ECLAIR_ENV_FILE="$env_file"

cat >"$env_file" <<ENV
ECLAIR_VERSION=$ECLAIR_VERSION
ECLAIR_SECRET_KEY=$(openssl rand -base64 32)
ECLAIR_ADMIN_TOKEN=$(openssl rand -hex 32)
ECLAIR_PUBLIC_URL=http://127.0.0.1:$port
ECLAIR_PORT=$port
DATABASE_PASSWORD=$(openssl rand -hex 24)
ECLAIR_QUEUES=cpu:2,video:1
ECLAIR_LOG_LEVEL=warn
ENV

compose() {
    docker compose --project-name "$project" --file "$file" --env-file "$env_file" "$@"
}

cleanup() {
    status=$?
    if [ "$status" != 0 ]; then
        compose logs --no-color --tail 100 eclair migrate >&2 || true
    fi
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -f "$env_file"
    exit "$status"
}
trap cleanup EXIT

fail() {
    echo "e2e ($file): $*" >&2
    exit 1
}

echo "== $file: starting" >&2
compose up --detach --no-build --wait --wait-timeout 180

base=http://127.0.0.1:$port
compose exec -T eclair eclair projects:create e2e >/dev/null
token=$(compose exec -T eclair eclair keys:create e2e | tail -n 1)
case "$token" in ek_*) ;; *) fail "no API key: $token" ;; esac

echo "== $file: synchronous probe" >&2
probe=$(curl -fsS -X POST "$base/v1/probe" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/octet-stream' --data-binary "@$fixture")
echo "$probe" | grep -q '"kind":"image"' || fail "unexpected probe: $probe"
echo "$probe" | grep -q '"width":64' || fail "unexpected probe: $probe"

echo "== $file: upload and job" >&2
upload=$(curl -fsS -X POST "$base/v1/uploads" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/octet-stream' --data-binary "@$fixture")
upload_id=$(echo "$upload" | sed -n 's/.*"id":"\(upl_[0-9A-Z]*\)".*/\1/p')
[ -n "$upload_id" ] || fail "no upload: $upload"

job=$(curl -fsS -X POST "$base/v1/jobs" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "{\"input\":{\"upload\":\"$upload_id\"},\"tasks\":{\"probe\":{\"op\":\"probe\",\"options\":{\"checksum\":true}}}}")
job_id=$(echo "$job" | sed -n 's/.*"id":"\(job_[0-9A-Z]*\)".*/\1/p')
[ -n "$job_id" ] || fail "no job: $job"

attempt=0
while :; do
    job=$(curl -fsS "$base/v1/jobs/$job_id" -H "Authorization: Bearer $token")
    case "$job" in
        *'"status":"completed"'*) break ;;
        *'"status":"failed"'* | *'"status":"canceled"'*) fail "the job did not complete: $job" ;;
    esac
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || fail "the job is still running: $job"
    sleep 1
done
echo "$job" | grep -q '"checksum":"[0-9a-f]\{64\}"' || fail "no checksum: $job"

echo "== $file: metrics and doctor" >&2
curl -fsS "$base/metrics" | grep -q '^eclair_tasks_total' || fail 'no task metrics'
compose exec -T eclair eclair doctor >&2 || true

echo "ok    $file end to end" >&2
