#!/usr/bin/env bash
# Backup + restore drill (PRD §18.3): dump, restore into a throwaway database,
# prove the copy is identical and consistent, then drop it.
#
# Needs only Docker (pg_dump/pg_restore come from the postgres:17 image) and the
# tokopilot-api image (for `verify-ledger` and `migrate status`).
#
#   SOURCE_URL   database to back up   (default: local compose DB via host.docker.internal:54329)
#   ADMIN_URL    same server, a role allowed to CREATE/DROP DATABASE (default: SOURCE_URL on db "postgres")
#   API_IMAGE    default tokopilot-api:local
#   KEEP_DUMP=1  keep the dump file in ./backups (gitignored); default deletes it after the drill
#
# Credentials are read from the environment / .env and never printed.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
PG_IMAGE=postgres:17-alpine
API_IMAGE=${API_IMAGE:-tokopilot-api:local}

if [ -z "${SOURCE_URL:-}" ]; then
  pw=$(grep '^POSTGRES_PASSWORD=' "$root/.env" | cut -d= -f2- | tr -d '\r')
  SOURCE_URL="postgresql://tokopilot:${pw}@host.docker.internal:54329/tokopilot?sslmode=disable"
fi
ADMIN_URL=${ADMIN_URL:-$(echo "$SOURCE_URL" | sed -E 's#/[^/?]+(\?|$)#/postgres\1#')}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
drill_db="tokopilot_restore_drill_${stamp,,}"
RESTORE_URL=$(echo "$SOURCE_URL" | sed -E "s#/[^/?]+(\?|$)#/${drill_db}\1#")
mkdir -p "$root/backups"
dump="backups/tokopilot-${stamp}.dump"

psql_in() { docker run --rm -i $PG_IMAGE psql "$1" -v ON_ERROR_STOP=1 -X -q -tA "${@:2}"; }
cleanup() { psql_in "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${drill_db}" >/dev/null 2>&1 || true
            [ "${KEEP_DUMP:-0}" = 1 ] || rm -f "$root/$dump"; }
trap cleanup EXIT

# Row count + md5 over every row of every table — identical data gives identical output.
FINGERPRINT=$(cat <<'SQL'
DO $$ BEGIN END $$;
SELECT string_agg(format('%s|%s', table_name, fp), E'\n' ORDER BY table_name)
FROM (
  SELECT c.relname AS table_name,
         (xpath('/row/f/text()', query_to_xml(format(
            'SELECT count(*)::text || '':'' || coalesce(md5(string_agg(t::text, ''|'' ORDER BY t::text)), ''-'') AS f FROM %I.%I t',
            n.nspname, c.relname), false, true, '')))[1]::text AS fp
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
) x;
SQL
)

echo "==> 1. backup (pg_dump custom format)"
t0=$(date +%s)
docker run --rm $PG_IMAGE pg_dump --format=custom --no-owner --no-privileges "$SOURCE_URL" > "$root/$dump"
src_fp=$(psql_in "$SOURCE_URL" -c "$FINGERPRINT")
echo "    $(du -h "$root/$dump" | cut -f1) in $(( $(date +%s) - t0 ))s → $dump"

echo "==> 2. restore into throwaway database ${drill_db}"
t1=$(date +%s)
psql_in "$ADMIN_URL" -c "CREATE DATABASE ${drill_db}" >/dev/null
psql_in "$RESTORE_URL" -c "CREATE EXTENSION IF NOT EXISTS citext" >/dev/null 2>&1 || true
docker run --rm -i $PG_IMAGE pg_restore --no-owner --no-privileges --exit-on-error -d "$RESTORE_URL" < "$root/$dump"
echo "    restored in $(( $(date +%s) - t1 ))s"

echo "==> 3. compare table fingerprints (row count + md5 of all rows)"
dst_fp=$(psql_in "$RESTORE_URL" -c "$FINGERPRINT")
if [ "$src_fp" != "$dst_fp" ]; then
  echo "FAIL: restored data differs"; diff <(echo "$src_fp") <(echo "$dst_fp") | sed 's/|[0-9a-f]\{32\}//' || true; exit 1
fi
echo "$src_fp" | awk -F'|' '{split($2,a,":"); printf "    %-22s %6s rows  ok\n", $1, a[1]}'

echo "==> 4. consistency checks on the restored copy"
status=$(docker run --rm -e APP_ENV=development -e DATABASE_URL="$RESTORE_URL" "$API_IMAGE" migrate status 2>&1)
applied=$(echo "$status" | grep -c 'state=applied' || true)
pending=$(echo "$status" | grep -c 'state=pending' || true)
[ "$pending" = 0 ] && [ "$applied" -gt 0 ] || { echo "FAIL: migrations applied=$applied pending=$pending"; exit 1; }
echo "    migrations: $applied applied, 0 pending (latest: $(echo "$status" | grep -o 'source=[^ ]*' | tail -1 | cut -d= -f2))"
docker run --rm -e APP_ENV=development -e DATABASE_URL="$RESTORE_URL" "$API_IMAGE" verify-ledger > /tmp/verify.$$ 2>&1 \
  || { echo "FAIL: verify-ledger"; tail -20 /tmp/verify.$$; rm -f /tmp/verify.$$; exit 1; }
grep -o '"products": [0-9]*\|"movements": [0-9]*\|"sales": [0-9]*' /tmp/verify.$$ | tr '\n' ' ' | sed 's/^/    ledger reconciled: /'; echo
rm -f /tmp/verify.$$

echo "==> PASS: backup restorable, identical, and consistent (total $(( $(date +%s) - t0 ))s)"
