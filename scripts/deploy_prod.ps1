<#
.SYNOPSIS
    Builds and starts the production ERP on this PC (docker-compose.prod.yml), behind Caddy.

.DESCRIPTION
    Settings: backend\.env.prod (with -Trial: backend\.env.trial), never committed. When missing, it
    is made from backend\.env.prod.example with new secrets (SECRET_KEY, database password); for the
    server, fill in the address, the e-mail for Let's Encrypt and the club's Gmail, then run again.
    1. Checks: Docker running, settings complete, Caddy (C:\ERP\bin\caddy.exe or in PATH).
    2. Data folders: static, media (the documents' files), backups, logs, caddy (in ERP_DATA).
    3. When the database already runs: a backup first.
    4. Builds the images and starts the containers (the API applies the migrations as it starts).
    5. Waits until the API (127.0.0.1:8200) and the pages (127.0.0.1:3200) answer.
    6. Caddy. -Trial: in its own window, https://erp.localhost, this PC only, Caddy's own local
       certificate (the browser warns). On the server, Caddy is a Windows service installed once
       (knowledge base: PROJECTS/ERP/guide_hebergement.md); this script reloads its settings.
    7. Checks https://ERP_DOMAIN/api/health/ through Caddy, from this PC.
    Knowledge base: PROJECTS/ERP/hosting_design.md.

.PARAMETER Trial
    Everything on this PC only, apart from the real production: project enp_erp_trial with its own
    database, data in C:\ERP\trial, https://erp.localhost, e-mails written in the API's log.

.PARAMETER Down
    Stop the containers (and the trial's Caddy). The database and the files stay.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy_prod.ps1 -Trial
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy_prod.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy_prod.ps1 -Trial -Down
#>
param([switch]$Trial, [switch]$Down)

# Native tools (docker, curl) write to stderr; their exit codes are checked instead.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.prod.yml"
$caddyfile = Join-Path $root "deploy\Caddyfile"
$example = Join-Path $root "backend\.env.prod.example"
$caddyHome = "C:\ERP\bin"
if ($Trial) {
    $envName = "backend\.env.trial"
    $project = "enp_erp_trial"
}
else {
    $envName = "backend\.env.prod"
    $project = "enp_erp_prod"
}
$envFile = Join-Path $root $envName
# The API's settings file, for docker-compose.prod.yml (env_file, relative to the repository).
$env:ERP_ENV_FILE = $envName.Replace("\", "/")

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Stop-WithError([string]$Message, [string]$Hint = "") {
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    if ($Hint) { Write-Host "  -> $Hint" -ForegroundColor Yellow }
    exit 1
}

# A random secret, letters, digits, - and _ only (safe in the settings file).
function New-Secret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Read-Settings([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
    }
    return $values
}

function Invoke-Compose {
    & docker compose -p $project -f $compose --env-file $envFile @args
}

# The status code of an HTTPS request to Caddy on this PC (resolved here, so it works without the
# router; -k for the trial's local certificate only).
function Get-CaddyStatus([string]$Domain, [string]$Path) {
    $insecure = if ($Trial) { "-k" } else { "" }
    $arguments = @("-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "10", "--resolve", "${Domain}:443:127.0.0.1")
    if ($insecure) { $arguments += $insecure }
    return (& curl.exe @arguments "https://$Domain$Path")
}

function Wait-Http([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            if ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { return $true }
        }
        catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

$mode = if ($Trial) { "trial on this PC" } else { "production" }
Write-Host "ENP Racing Team ERP: $mode ($project)" -ForegroundColor Cyan

# --- Settings ---
if (-not (Test-Path $envFile)) {
    $text = [System.IO.File]::ReadAllText($example)
    $text = [regex]::Replace($text, '(?m)^SECRET_KEY=[ \t]*$', "SECRET_KEY=$(New-Secret 64)")
    $text = [regex]::Replace($text, '(?m)^DB_PASSWORD=[ \t]*$', "DB_PASSWORD=$(New-Secret 24)")
    if ($Trial) {
        $text = $text.Replace("erp.example.org", "erp.localhost")
        $text = [regex]::Replace($text, '(?m)^ERP_DATA=.*$', "ERP_DATA=C:/ERP/trial")
        $text = [regex]::Replace($text, '(?m)^EMAIL_BACKEND=.*$', "EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend")
    }
    [System.IO.File]::WriteAllText($envFile, $text, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  Settings created with new secrets: $envName (never commit it)."
    if (-not $Trial) {
        Stop-WithError "Fill in ${envName}: ERP_DOMAIN (and the addresses that follow), ERP_ACME_EMAIL and the Gmail lines." `
            "Then run this script again (knowledge base: PROJECTS/ERP/guide_hebergement.md)."
    }
}
$settings = Read-Settings $envFile
$domain = $settings["ERP_DOMAIN"]
$data = $settings["ERP_DATA"]
if (-not $Trial) {
    $missing = @("ERP_DOMAIN", "ERP_DATA", "ERP_ACME_EMAIL", "SECRET_KEY", "DB_PASSWORD", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL") |
        Where-Object { -not $settings[$_] }
    if ($domain -like "*example.org") { $missing += "ERP_DOMAIN (still erp.example.org)" }
    if ($missing.Count -gt 0) {
        Stop-WithError "Settings to fill in, in ${envName}: $($missing -join ', ')." "See PROJECTS/ERP/guide_hebergement.md."
    }
}

# --- Stop ---
if ($Down) {
    Write-Step "Stopping $project"
    Invoke-Compose down
    $pidFile = Join-Path $data "caddy.pid"
    if ($Trial -and (Test-Path $pidFile)) {
        $id, $ticks = (Get-Content $pidFile) -split " "
        $window = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
        if ($window -and $window.StartTime.Ticks -eq [long]$ticks) { taskkill.exe /PID $id /T /F | Out-Null }
        Remove-Item $pidFile
    }
    Write-Host "Stopped (the database and the files stay)." -ForegroundColor Green
    exit 0
}

# --- 1. Checks ---
Write-Step "Checks"
docker info *> $null
if ($LASTEXITCODE -ne 0) { Stop-WithError "Docker is not running." "Start Docker Desktop, then run this script again." }
$caddy = Join-Path $caddyHome "caddy.exe"
if (-not (Test-Path $caddy)) {
    $found = Get-Command caddy.exe -ErrorAction SilentlyContinue
    if (-not $found) { Stop-WithError "Caddy not found ($caddy)." "Install it: PROJECTS/ERP/guide_hebergement.md." }
    $caddy = $found.Source
}
Write-Host "  Docker running; Caddy: $caddy"

# --- 2. Data folders ---
foreach ($folder in "static", "media", "backups", "logs", "caddy") {
    New-Item -ItemType Directory -Force -Path (Join-Path $data $folder) | Out-Null
}
Write-Host "  Data: $data"

# --- 3. Backup first ---
$running = @(Invoke-Compose ps --status running --services 2>$null)
if ($running -contains "backup") {
    Write-Step "Backup of the database first"
    Invoke-Compose exec -T backup sh -c 'pg_dump --format=custom --file=/backups/erp_before_deploy_$(date +%Y%m%d_%H%M%S).dump && ls -1t /backups | head -1'
    if ($LASTEXITCODE -ne 0) { Stop-WithError "The backup failed: nothing was changed." "Read the message above." }
}

# --- 4. Images and containers ---
Write-Step "Building the images and starting the containers (a few minutes the first time)"
Invoke-Compose up -d --build
if ($LASTEXITCODE -ne 0) { Stop-WithError "The containers could not be started (see above)." }

# --- 5. API and pages ---
Write-Step "Waiting for the API and the pages"
if (-not (Wait-Http "http://127.0.0.1:8200/api/health/" 180)) {
    Stop-WithError "The API does not answer." "Read its log: docker compose -p $project -f docker-compose.prod.yml logs api"
}
if (-not (Wait-Http "http://127.0.0.1:3200/fr/login" 120)) {
    Stop-WithError "The pages do not answer." "Read their log: docker compose -p $project -f docker-compose.prod.yml logs web"
}
Write-Host "  API and pages ready."

# --- 6. Caddy ---
Write-Step "Caddy (HTTPS, https://$domain)"
$tls = if ($Trial) { "internal" } else { $settings["ERP_ACME_EMAIL"] }
$bind = if ($Trial) { "127.0.0.1" } else { "0.0.0.0" }
$hsts = if ($settings["SECURE_HSTS_SECONDS"]) { $settings["SECURE_HSTS_SECONDS"] } else { "3600" }
$caddyEnv = Join-Path $data "caddy.env"
$lines = @("ERP_DOMAIN=$domain", "ERP_DATA=$data", "ERP_TLS=$tls", "ERP_BIND=$bind", "ERP_HSTS_SECONDS=$hsts")
[System.IO.File]::WriteAllLines($caddyEnv, $lines, (New-Object System.Text.UTF8Encoding $false))
# The same values for this script's own Caddy commands (caddy reload has no --envfile).
$env:ERP_DOMAIN = $domain
$env:ERP_DATA = $data
$env:ERP_TLS = $tls
$env:ERP_BIND = $bind
$env:ERP_HSTS_SECONDS = $hsts
& $caddy validate --config $caddyfile --adapter caddyfile *> $null
if ($LASTEXITCODE -ne 0) {
    & $caddy validate --config $caddyfile --adapter caddyfile
    Stop-WithError "Caddy refuses its settings (see above)."
}
# A running Caddy answers on its administration port (2019, this PC only).
$caddyRuns = $null -ne (Get-NetTCPConnection -LocalPort 2019 -State Listen -ErrorAction SilentlyContinue)
if ($caddyRuns) {
    & $caddy reload --config $caddyfile --adapter caddyfile
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Caddy runs but refused the new settings (see above)." }
    Write-Host "  Caddy was running: settings reloaded."
}
elseif ($Trial) {
    $quoted = $caddy -replace "'", "''"
    $command = "`$host.UI.RawUI.WindowTitle = 'ERP trial - Caddy'; & '$quoted' run --config '$caddyfile' --adapter caddyfile --envfile '$caddyEnv'"
    $window = Start-Process powershell.exe -ArgumentList "-NoExit", "-NoProfile", "-Command", $command -PassThru
    Set-Content -Path (Join-Path $data "caddy.pid") -Value "$($window.Id) $($window.StartTime.Ticks)" -Encoding ascii
    Write-Host "  Caddy started in its own window, 'ERP trial - Caddy'."
}
else {
    Stop-WithError "Caddy does not run." "Install it as a Windows service: PROJECTS/ERP/guide_hebergement.md, then run this script again."
}

# --- 7. Through Caddy ---
$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Seconds 3
    $status = Get-CaddyStatus $domain "/api/health/"
} until ($status -eq "200" -or (Get-Date) -gt $deadline)
if ($status -ne "200") {
    Stop-WithError "https://$domain/api/health/ answers '$status' through Caddy." "Read $data\logs\caddy.log (certificate, ports 80 and 443)."
}
Write-Host ""
Write-Host "The ERP answers at https://$domain" -ForegroundColor Green
if ($Trial) {
    Write-Host "  Trial: the browser warns about Caddy's local certificate (normal here). Sign-in codes:"
    Write-Host "  docker compose -p $project -f docker-compose.prod.yml logs api"
    Write-Host "  Stop the trial: scripts\deploy_prod.ps1 -Trial -Down"
}
exit 0
