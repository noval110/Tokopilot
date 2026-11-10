# Starts the full local stack: Go API (:8080) + AI service (:8000, scripted provider) + Vite (:5173).
# Prerequisite: `docker compose up -d postgres`. Logs go to .dev/logs (gitignored).
# A fresh random AI_SERVICE_TOKEN is generated per run and shared by both processes; nothing secret is printed.
# Stop with Ctrl+C, or: scripts/dev-stack.ps1 -Stop
param([switch]$Stop, [string]$Provider = 'scripted')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $root '.dev'
$logs = Join-Path $state 'logs'
$pidFile = Join-Path $state 'pids.txt'

function Stop-Stack {
  foreach ($port in 8080, 8000, 5173) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  if (Test-Path $pidFile) { Remove-Item $pidFile }
}
if ($Stop) { Stop-Stack; Write-Host 'stack stopped'; return }

New-Item -ItemType Directory -Force $logs | Out-Null
foreach ($line in Get-Content (Join-Path $root '.env')) {
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process') }
}
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:AI_SERVICE_TOKEN = [Convert]::ToBase64String($bytes)
$env:LLM_PROVIDER = $Provider
Stop-Stack

Push-Location (Join-Path $root 'backend')
try {
  go run ./cmd/api migrate up *> (Join-Path $logs 'migrate.log')
  if ($LASTEXITCODE -ne 0) { throw 'migration failed - see .dev/logs/migrate.log' }
  go build -o (Join-Path $state 'api.exe') ./cmd/api
} finally { Pop-Location }

$api = Start-Process -PassThru -NoNewWindow -FilePath (Join-Path $state 'api.exe') -WorkingDirectory (Join-Path $root 'backend') `
  -RedirectStandardOutput (Join-Path $logs 'api.out') -RedirectStandardError (Join-Path $logs 'api.err')
$ai = Start-Process -PassThru -NoNewWindow -FilePath (Join-Path $root 'ai-service\.venv\Scripts\uvicorn.exe') `
  -ArgumentList 'app.main:app', '--port', '8000' -WorkingDirectory (Join-Path $root 'ai-service') `
  -RedirectStandardOutput (Join-Path $logs 'ai.out') -RedirectStandardError (Join-Path $logs 'ai.err')
$web = Start-Process -PassThru -NoNewWindow -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm dev --port 5173 --strictPort' `
  -WorkingDirectory (Join-Path $root 'frontend') -RedirectStandardOutput (Join-Path $logs 'web.out') -RedirectStandardError (Join-Path $logs 'web.err')
"$($api.Id) $($ai.Id) $($web.Id)" | Set-Content $pidFile

$deadline = (Get-Date).AddSeconds(60)
$ready = $false
while ((Get-Date) -lt $deadline -and -not $ready) {
  Start-Sleep -Milliseconds 500
  try {
    $ready = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/readyz -TimeoutSec 2).StatusCode -eq 200 -and
             (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/healthz -TimeoutSec 2).StatusCode -eq 200 -and
             (Invoke-WebRequest -UseBasicParsing http://localhost:5173/ -TimeoutSec 2).StatusCode -eq 200
  } catch { $ready = $false }
}
if (-not $ready) { Stop-Stack; throw 'stack did not become ready in 60s - see .dev/logs' }
Write-Host "TokoPilot ready: http://localhost:5173  (API :8080, AI :8000, provider=$Provider)" -ForegroundColor Green
Wait-Process -Id $api.Id, $ai.Id
