#!/usr/bin/env bash
set -euo pipefail
# Requires Docker; no host ports or network, and never contacts a Supabase project.
repo=$(cd "$(dirname "$0")/../.." && pwd)
container="little-ledger-test-$RANDOM-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --network none --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 >/dev/null
for attempt in {1..30}; do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
 if [[ "$attempt" == 30 ]]; then echo 'Postgres not ready' >&2; exit 1; fi
 sleep 1
done
for sql in "$repo/supabase/tests/bootstrap.sql" "$repo/supabase/migrations/202610110001_cloud_ledger.sql" "$repo/supabase/tests/security.sql"; do
 docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$sql"
done

python3 "$repo/supabase/tests/concurrency.py" "$container"
