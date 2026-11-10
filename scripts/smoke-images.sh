#!/usr/bin/env bash
# Release-image smoke test against the local compose Postgres (localhost:54329).
# Build first: docker build -t tokopilot-api:local backend && docker build -t tokopilot-ai:local ai-service
# Secrets are random per run and never printed. Usage: bash scripts/smoke-images.sh
set -u
pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass+1)); }
ko() { echo "FAIL  $1"; fail=$((fail+1)); }
rnd() { head -c 32 /dev/urandom | base64 | tr -d '=+/\n'; }

root="$(cd "$(dirname "$0")/.." && pwd)"
PGPW=$(grep "^POSTGRES_PASSWORD=" "$root/.env" | cut -d= -f2- | tr -d '\r')
DBURL="postgresql://tokopilot:${PGPW}@host.docker.internal:54329/tokopilot?sslmode=disable"
SESSION=$(rnd)$(rnd); TOKEN=$(rnd)$(rnd)
ORIGIN=https://demo.tokopilot.test
docker rm -f tp-smoke-api tp-smoke-ai >/dev/null 2>&1; docker network rm tp-smoke >/dev/null 2>&1

# 1. Production refuses placeholder secrets (API and AI).
out=$(docker run --rm -e APP_ENV=production -e DATABASE_URL="$DBURL" -e SESSION_SECRET=replace-with-session-secret \
  -e AI_SERVICE_TOKEN=replace-with-service-secret -e FRONTEND_ORIGIN=$ORIGIN tokopilot-api:local 2>&1); code=$?
[ $code -ne 0 ] && echo "$out" | grep -q "SESSION_SECRET must be" && ok "api: production refuses placeholder secrets (exit $code)" || ko "api placeholder secrets: $out"
echo "$out" | grep -q "replace-with" && ko "api error echoes the secret value" || ok "api: error names the variable, not its value"
out=$(timeout 40 docker run --rm --name tp-smoke-ai-bad -e APP_ENV=production -e AI_SERVICE_TOKEN=short tokopilot-ai:local 2>&1); code=$?; docker rm -f tp-smoke-ai-bad >/dev/null 2>&1
[ $code -ne 0 ] && echo "$out" | grep -q "AI_SERVICE_TOKEN must be" && ok "ai: production refuses a short token" || ko "ai short token: $(echo "$out" | tail -2)"
out=$(docker run --rm -e APP_ENV=production -e DATABASE_URL="$DBURL" -e SESSION_SECRET="$SESSION" -e AI_SERVICE_TOKEN="$TOKEN" \
  -e FRONTEND_ORIGIN=http://insecure.test tokopilot-api:local 2>&1)
echo "$out" | grep -q "FRONTEND_ORIGIN must use https" && ok "api: production refuses an http FRONTEND_ORIGIN" || ko "http origin: $out"

# 2. Run the pair on a private network, production mode.
docker network create tp-smoke >/dev/null
docker run -d --name tp-smoke-ai --network tp-smoke -e APP_ENV=production -e AI_SERVICE_TOKEN="$TOKEN" -e LLM_PROVIDER=scripted \
  -p 127.0.0.1:18000:8000 tokopilot-ai:local >/dev/null
mig=$(docker run --rm -e APP_ENV=production -e DATABASE_URL="$DBURL" -e SESSION_SECRET="$SESSION" -e AI_SERVICE_TOKEN="$TOKEN" \
  -e FRONTEND_ORIGIN=$ORIGIN tokopilot-api:local migrate status 2>&1)
echo "$mig" | grep -q '00005_ai.sql' && ok "api image: migrate status runs (embedded migrations up to v5)" || ko "migrate status: $(echo "$mig" | tail -3)"
docker run -d --name tp-smoke-api --network tp-smoke -e APP_ENV=production -e DATABASE_URL="$DBURL" -e SESSION_SECRET="$SESSION" \
  -e AI_SERVICE_TOKEN="$TOKEN" -e AI_SERVICE_URL=http://tp-smoke-ai:8000 -e FRONTEND_ORIGIN=$ORIGIN -p 127.0.0.1:18080:8080 tokopilot-api:local >/dev/null
for i in $(seq 1 30); do curl -sf localhost:18080/readyz >/dev/null && curl -sf localhost:18000/healthz >/dev/null && break; sleep 1; done
[ "$(curl -s localhost:18080/healthz)" = '{"status":"ok"}' ] && ok "api container: /healthz" || ko "api healthz"
curl -sf localhost:18080/readyz >/dev/null && ok "api container: /readyz (database reachable)" || ko "api readyz: $(curl -s localhost:18080/readyz)"
[ "$(docker inspect -f '{{.Config.User}}' tp-smoke-api)" = "nonroot:nonroot" ] && ok "api runs as nonroot" || ko "api user"
[ "$(docker exec tp-smoke-ai id -u)" = "10001" ] && ok "ai runs as uid 10001 (not root)" || ko "ai user"
docker exec tp-smoke-ai python -c "import importlib.util as u,sys; sys.exit(any(u.find_spec(m) for m in ['psycopg','psycopg2','asyncpg','sqlalchemy']))" \
  && ok "ai image contains no database driver" || ko "ai image has a DB driver"
docker exec tp-smoke-ai env | grep -q DATABASE_URL && ko "ai container has DATABASE_URL" || ok "ai container has no DATABASE_URL"
hdr=$(curl -sI localhost:18080/healthz)
echo "$hdr" | grep -qi '^x-content-type-options: nosniff' && ok "security headers present (nosniff)" || ko "security headers: $hdr"

# 3. Full round trip through both containers (cookies are Secure; curl treats localhost as a secure context).
J=$(mktemp); api() { curl -s -b "$J" -c "$J" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $(awk '$6=="tp_csrf"{print $7}' "$J" 2>/dev/null)" -X "$1" "localhost:18080/api/v1$2" ${3:+-d "$3"}; }
email="smoke+$(date +%s)@warung.id"
api POST /auth/register "{\"name\":\"Smoke\",\"email\":\"$email\",\"password\":\"rahasia-toko-123\"}" >/dev/null
api POST /stores '{"name":"Toko Smoke"}' >/dev/null
pid=$(api POST /products '{"name":"Kopi Smoke","unit":"pcs","cost_price":1000,"selling_price":2500,"initial_stock":"10","min_stock":"2"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
api POST /sales "{\"idempotency_key\":\"smoke-sale-$(date +%s)\",\"items\":[{\"product_id\":\"$pid\",\"quantity\":\"2\"}],\"discount_amount\":0,\"payment_method\":\"CASH\"}" >/dev/null
conv=$(api POST /assistant/conversations | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
ans=$(api POST "/assistant/conversations/$conv/messages" '{"content":"Berapa penjualan hari ini?"}')
echo "$ans" | grep -q 'bersih Rp 5.000 dari 1 transaksi' && ok "containers: register → product → sale → AI answer (Rp 5.000 via Go tool)" || ko "round trip: $(echo "$ans" | head -c 300)"
logs=$(docker logs tp-smoke-api 2>&1)
echo "$logs" | grep -q '"level":"INFO"' && ok "api logs are JSON in production" || ko "api log format"
(echo "$logs"; docker logs tp-smoke-ai 2>&1) | grep -qF -e "$TOKEN" -e "$SESSION" -e "rahasia-toko-123" -e "$email" && ko "container logs leak secrets/PII" || ok "container logs contain no token, session secret, password or email"
rm -f "$J"
docker rm -f tp-smoke-api tp-smoke-ai >/dev/null; docker network rm tp-smoke >/dev/null
echo "---- $pass passed, $fail failed"
[ $fail -eq 0 ]
