# Runs every format, lint, test and build check. Exits non-zero on first failure.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Step($name, [scriptblock]$block) {
  Write-Host "`n==> $name" -ForegroundColor Cyan
  # Native tools report via exit code. Under 'Stop', Windows PowerShell 5.1 turns any
  # stderr line (e.g. pnpm echoing its command) into a terminating error when output is redirected.
  $ErrorActionPreference = 'Continue'
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name" -ForegroundColor Red; exit $LASTEXITCODE }
}

$textPy = if (Test-Path "$root/ai-service/.venv/Scripts/python.exe") { "$root/ai-service/.venv/Scripts/python.exe" } else { 'python' }
Step 'repo: invisible characters' { & $textPy "$root/scripts/check_text.py" }

Push-Location "$root/backend"
try {
  # Integration tests use the docker compose Postgres when it is reachable.
  if (-not $env:TEST_DATABASE_URL -and (Test-NetConnection localhost -Port 54329 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    $env:TEST_DATABASE_URL = 'postgresql://tokopilot:change-me-local-only@localhost:54329/postgres?sslmode=disable'
  }
  if ($env:TEST_DATABASE_URL) { Write-Host 'Integration tests: ON (PostgreSQL)' -ForegroundColor Green }
  else { Write-Host 'Integration tests: SKIPPED (start: docker compose up -d postgres)' -ForegroundColor Yellow }
  Step 'backend: gofmt' { $out = gofmt -l .; if ($out) { Write-Host $out; $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 } }
  Step 'backend: go vet' { go vet ./... }
  Step 'backend: go test' { go test ./... }
} finally { Pop-Location }

Push-Location "$root/ai-service"
try {
  $py = if (Test-Path .venv/Scripts/python.exe) { '.venv/Scripts/python.exe' } else { 'python' }
  Step 'ai-service: ruff check' { & $py -m ruff check . }
  Step 'ai-service: ruff format' { & $py -m ruff format --check . }
  Step 'ai-service: pytest' { & $py -m pytest }
} finally { Pop-Location }

Push-Location "$root/frontend"
try {
  # Duplicate vitest copies in the lockfile break jest-dom ("failed to find the current suite").
  Step 'frontend: lockfile deduped' { pnpm dedupe --check }
  Step 'frontend: eslint' { pnpm exec eslint . --max-warnings 0 }
  Step 'frontend: vitest' { pnpm exec vitest run }
  Step 'frontend: build (tsc + vite)' { pnpm run build }
} finally { Pop-Location }

Write-Host "`nAll checks passed." -ForegroundColor Green
