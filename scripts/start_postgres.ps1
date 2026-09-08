# Start PostgreSQL via Docker Compose and wait until ready
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "==> Starting PostgreSQL (Docker Compose)..." -ForegroundColor Cyan
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose failed. Is Docker Desktop running?"
    exit $LASTEXITCODE
}

Write-Host "==> Waiting for PostgreSQL healthcheck..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(60)
do {
    $status = docker inspect --format='{{.State.Health.Status}}' cobolbank-postgres 2>$null
    if ($status -eq 'healthy') {
        Write-Host "==> PostgreSQL is healthy (cobol@localhost:5432/cobolbank)" -ForegroundColor Green
        exit 0
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

Write-Error "PostgreSQL did not become healthy in time (last status: $status)"
exit 1
