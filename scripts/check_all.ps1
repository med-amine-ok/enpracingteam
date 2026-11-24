<#
.SYNOPSIS
    Runs every check of the backend and the frontend. Use it before each commit (the Git
    pre-commit hook runs it).

.DESCRIPTION
    Backend:
    1. Docker: the PostgreSQL and Redis containers are healthy
    2. Lint (ruff, rules in backend\ruff.toml)
    3. Django system checks
    4. No model change without its migration
    5. Every migration is applied to the local database
    6. Test suite
    Frontend (skipped until 'npm install' has been run in frontend):
    7. Lint (ESLint) and formatting (Prettier)
    8. TypeScript types
    9. The API types (src\lib\api\schema.d.ts) match the backend
    10. Test suite (Vitest)
    With -E2E only:
    11. End-to-end tests (Playwright): real browser, production build, separate database
    Every step runs even if an earlier one failed, then a summary is printed.
    Exit code: 0 if everything passed, 1 otherwise.

.PARAMETER SkipTests
    Skip both test suites (quick check while working). The pre-commit hook never skips them.

.PARAMETER E2E
    Also run the end-to-end tests (about 1.5 minute: production build of the frontend, test API on
    port 8100 with its own database; $env:E2E_API_PORT and $env:E2E_FRONTEND_PORT choose other ports when
    another program holds 8100 or 3100). Not run by the pre-commit hook.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_all.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_all.ps1 -SkipTests
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_all.ps1 -E2E
#>
param([switch]$SkipTests, [switch]$E2E)

# Native tools (Django, ruff) write to stderr; that must not stop the script.
$ErrorActionPreference = "Continue"
# If PostgreSQL is stopped or still starting, give up after 5 s instead of waiting forever
# (read by libpq, which psycopg uses; only for the commands started by this script).
$env:PGCONNECT_TIMEOUT = "5"
# Python writes UTF-8 even when its output is piped (accents, Arabic, box-drawing characters);
# otherwise Windows uses cp1252 and printing those characters crashes the command.
$env:PYTHONUTF8 = "1"
$previousOutputEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$npm = "npm.cmd"  # not npm.ps1, which the PowerShell execution policy may block
$containers = @("enp_racing_team_db", "enp_redis")  # container_name in docker-compose.yml

if (-not (Test-Path $python)) {
    Write-Host "Python virtual environment not found: $python" -ForegroundColor Red
    Write-Host "Create it first (see backend\README.md)."
    exit 1
}

$results = New-Object System.Collections.Generic.List[object]

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Command,
        [string]$Hint = "",
        [string]$SkipReason = ""
    )
    if ($SkipReason) {
        Write-Host ""
        Write-Host "=== $Name : skipped ($SkipReason) ===" -ForegroundColor DarkGray
        $results.Add([pscustomobject]@{ Name = $Name; Status = "SKIPPED"; Seconds = 0 })
        return
    }
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $global:LASTEXITCODE = 0
    & $Command | Out-Host
    $ok = ($LASTEXITCODE -eq 0)
    $watch.Stop()
    if (-not $ok -and $Hint) { Write-Host "  -> $Hint" -ForegroundColor Yellow }
    $status = if ($ok) { "OK" } else { "FAILED" }
    $results.Add([pscustomobject]@{ Name = $Name; Status = $status; Seconds = $watch.Elapsed.TotalSeconds })
}

Push-Location $backend
try {
    Invoke-Step "Docker containers healthy" {
        $unhealthy = @()
        foreach ($name in $containers) {
            $health = docker inspect --format "{{.State.Health.Status}}" $name 2>$null
            if (-not $health) { $health = "not running" }
            Write-Host "  $name : $health"
            if ($health -ne "healthy") { $unhealthy += $name }
        }
        $global:LASTEXITCODE = [int]($unhealthy.Count -gt 0)
    } -Hint "Start Docker Desktop, then run 'docker compose up -d' in the project folder."
    $dockerOk = ($results[$results.Count - 1].Status -eq "OK")
    $noDb = if ($dockerOk) { "" } else { "the database is not available" }

    Invoke-Step "Lint (ruff)" { & $python -m ruff check . } `
        -Hint "Fix the lines listed above ('ruff check . --fix' fixes the ones marked [*])."

    Invoke-Step "Django system checks" { & $python manage.py check }

    Invoke-Step "Migrations match the models" { & $python manage.py makemigrations --check --dry-run } `
        -Hint "A model changed without its migration: run 'manage.py makemigrations'."

    Invoke-Step "Migrations applied to the local database" { & $python manage.py migrate --check } `
        -Hint "Run 'manage.py migrate'." -SkipReason $noDb

    $testsSkip = if ($SkipTests) { "-SkipTests" } else { $noDb }
    Invoke-Step "Tests" { & $python manage.py test } -SkipReason $testsSkip
}
finally {
    Pop-Location
}

$noFrontend = if (Test-Path (Join-Path $frontend "node_modules")) { "" } else { "run 'npm install' in frontend" }
$frontendTestsSkip = if ($SkipTests) { "-SkipTests" } else { $noFrontend }
Push-Location $frontend
try {
    Invoke-Step "Frontend: lint (ESLint)" { & $npm run --silent lint } `
        -Hint "Fix the lines listed above." -SkipReason $noFrontend

    Invoke-Step "Frontend: formatting (Prettier)" { & $npm run --silent format:check } `
        -Hint "Run 'npm run format' in frontend." -SkipReason $noFrontend

    Invoke-Step "Frontend: types (TypeScript)" { & $npm run --silent typecheck } -SkipReason $noFrontend

    Invoke-Step "Frontend: API types match the backend" { & $npm run --silent api:check } `
        -Hint "The API changed: run 'npm run api:types' in frontend and commit src\lib\api\schema.d.ts." `
        -SkipReason $noFrontend

    Invoke-Step "Frontend: tests (Vitest)" { & $npm run --silent test } -SkipReason $frontendTestsSkip

    if ($E2E) {
        Invoke-Step "Frontend: end-to-end (Playwright)" { & $npm run --silent test:e2e } `
            -Hint "See what failed: 'npm run test:e2e:report' in frontend (screenshots and traces)." `
            -SkipReason $noFrontend
    }
}
finally {
    Pop-Location
    [Console]::OutputEncoding = $previousOutputEncoding
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = switch ($r.Status) { "OK" { "Green" } "FAILED" { "Red" } default { "DarkGray" } }
    Write-Host ("  {0,-8}{1,6:N1} s   {2}" -f $r.Status, $r.Seconds, $r.Name) -ForegroundColor $color
}

$failed = @($results | Where-Object { $_.Status -eq "FAILED" }).Count
$skipped = @($results | Where-Object { $_.Status -eq "SKIPPED" }).Count
Write-Host ""
if ($failed -gt 0) {
    Write-Host "$failed check(s) FAILED." -ForegroundColor Red
    exit 1
}
if ($skipped -gt 0) {
    Write-Host "Checks passed, but $skipped skipped." -ForegroundColor Yellow
}
else {
    Write-Host "All checks passed." -ForegroundColor Green
}
exit 0
