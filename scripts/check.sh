#!/usr/bin/env sh
# Runs every format, lint, test and build check. Exits non-zero on first failure.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"

step() { printf '\n==> %s\n' "$1"; }

step "repo: invisible characters"
if command -v python3 >/dev/null 2>&1; then textpy=python3; else textpy=python; fi
"$textpy" "$root/scripts/check_text.py"

cd "$root/backend"
if [ -z "${TEST_DATABASE_URL:-}" ] && (exec 3<>/dev/tcp/127.0.0.1/54329) 2>/dev/null; then
  export TEST_DATABASE_URL='postgresql://tokopilot:change-me-local-only@localhost:54329/postgres?sslmode=disable'
fi
if [ -n "${TEST_DATABASE_URL:-}" ]; then echo "Integration tests: ON (PostgreSQL)"; else echo "Integration tests: SKIPPED (docker compose up -d postgres)"; fi
step "backend: gofmt"
unformatted="$(gofmt -l .)"
if [ -n "$unformatted" ]; then echo "$unformatted"; exit 1; fi
step "backend: go vet"; go vet ./...
step "backend: go test"; go test ./...

cd "$root/ai-service"
if [ -x .venv/bin/python ]; then py=.venv/bin/python
elif [ -x .venv/Scripts/python.exe ]; then py=.venv/Scripts/python.exe
else py=python3; fi
step "ai-service: ruff check"; "$py" -m ruff check .
step "ai-service: ruff format"; "$py" -m ruff format --check .
step "ai-service: pytest"; "$py" -m pytest

cd "$root/frontend"
step "frontend: lockfile deduped"; pnpm dedupe --check
step "frontend: eslint"; pnpm exec eslint . --max-warnings 0
step "frontend: vitest"; pnpm exec vitest run
step "frontend: build"; pnpm run build

printf '\nAll checks passed.\n'
