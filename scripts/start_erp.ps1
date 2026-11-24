<#
.SYNOPSIS
    Starts the ERP on this PC in one command, for daily use or a presentation:
    http://localhost:3000 (this PC only: no other computer can reach it), or, with -Network, an
    address that the devices on the same network (Wi-Fi, box) can open too, or, with -Tailscale, one
    that the people this PC is shared with on Tailscale open from anywhere.

.DESCRIPTION
    1. Docker: starts Docker Desktop if needed, then the PostgreSQL and Redis containers
       (docker compose up -d), and waits until they are healthy.
    2. Database: applies the migrations. With -Demo, also resets the demo data (fictitious
       people, projects, tasks, purchases, stock: backend\apps\projects\management\commands\seed_demo.py).
    3. Web pages: production build (next build), only when the frontend or the address changed since the last one.
    4. API (Django, 127.0.0.1:8000) in its own window, "ERP - API": the e-mails that are not really
       sent are printed there, with their sign-in codes. Without scripts\set_email.ps1, none is
       sent; with it, only those of the demo's fictitious people stay there.
    5. Web pages (next start, localhost:3000) in their own window, "ERP - Web".
    6. Opens the ERP in the default browser.
    Stop everything with scripts\stop_erp.ps1.

.PARAMETER Network
    Opens the ERP to the devices on this PC's network (the same Wi-Fi or box): the members open
    http://<this PC's address>:3000 on their phone or computer, and sign in with the code e-mailed to
    them (scripts\set_email.ps1 first). On a trusted network only, such as the team's hotspot or the
    club's box: it is the same ERP as on this PC, in plain HTTP. The database stays reachable from this
    PC only. The first time, Windows asks whether Python and Node.js may accept connections: allow it.

.PARAMETER Tailscale
    Like -Network, but on this PC's Tailscale address (100.x.y.z) instead of the Wi-Fi's: the people this PC
    is shared with on Tailscale open the ERP from anywhere, through an encrypted link that nobody else on the
    Internet can use, even when this PC reaches the Internet through a phone's 4G. Tailscale must be installed
    and signed in on this PC and on theirs (knowledge base: PROJECTS/ERP/guide_lancement.md, section 4 bis).

.PARAMETER Demo
    Reset the demo data first: the demo purchases, stock, tasks... go back to their initial state
    (what was changed on them during an earlier presentation is lost). Real members keep their data.

.PARAMETER Rebuild
    Build the web pages again even if the frontend did not change.

.PARAMETER NoBrowser
    Do not open the browser.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_erp.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_erp.ps1 -Demo
    scripts\start_erp.cmd -Network
    scripts\start_erp.cmd -Tailscale
#>
param([switch]$Demo, [switch]$Rebuild, [switch]$NoBrowser, [switch]$Network, [switch]$Tailscale)
if ($Tailscale) { $Network = $true }  # the network mode, on the Tailscale address

# Native tools (docker, Django, npm) write to stderr; that must not stop the script: their exit
# codes are checked instead.
$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"          # accents and Arabic in the Python output (see check_all.ps1)
$env:PGCONNECT_TIMEOUT = "5"   # give up after 5 s when PostgreSQL does not answer
$env:NEXT_TELEMETRY_DISABLED = "1"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$npm = "npm.cmd"  # not npm.ps1, which the PowerShell execution policy may block
$containers = @("enp_racing_team_db", "enp_redis")  # container_name in docker-compose.yml
$apiPort = 8000
$webPort = 3000
$apiUrl = "http://localhost:$apiPort"  # where the web pages send their requests (built into them)
$webUrl = "http://localhost:$webPort"
# The windows opened below, so that scripts\stop_erp.ps1 can close them again.
$windowsFile = Join-Path $env:TEMP "enp-racing-erp-windows.txt"

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

function Test-Http([string]$Url) {
    try {
        return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Wait-Http([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Http $Url) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

# This PC on the network it reaches the Internet through (the default route with the lowest metric):
# its address there, the network's name and its type for Windows (Public or Private). $null if none.
function Get-LocalNetwork {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
    if (-not $route) { return $null }
    $ip = Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1
    if (-not $ip) { return $null }
    $connection = Get-NetConnectionProfile -InterfaceIndex $route.ifIndex -ErrorAction SilentlyContinue | Select-Object -First 1
    return [pscustomobject]@{ Address = $ip.IPAddress; Name = $connection.Name; Category = "$($connection.NetworkCategory)" }
}

# This PC on its Tailscale network: its address there (100.x.y.z) and that network's type for Windows.
# $null when Tailscale is not installed or not connected.
function Get-TailscaleNetwork {
    $ip = Get-NetIPAddress -InterfaceAlias "Tailscale" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "100.*" } | Select-Object -First 1
    if (-not $ip) { return $null }
    $connection = Get-NetConnectionProfile -InterfaceAlias "Tailscale" -ErrorAction SilentlyContinue | Select-Object -First 1
    return [pscustomobject]@{ Address = $ip.IPAddress; Name = "Tailscale"; Category = "$($connection.NetworkCategory)" }
}

# The programs among $Programs (name = path) that the Windows firewall stops from accepting
# connections on this type of network (Public, Private, DomainAuthenticated): a rule blocks them.
# Without any rule, Windows asks the first time instead. Reading the rules takes a few seconds.
function Get-BlockedPrograms([hashtable]$Programs, [string]$Category) {
    $type = if ($Category -eq "DomainAuthenticated") { "Domain" } else { $Category }
    $filters = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue)
    foreach ($name in $Programs.Keys) {
        $rules = @($filters | Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $Programs[$name] } |
            Get-NetFirewallRule -ErrorAction SilentlyContinue |
            Where-Object { "$($_.Enabled)" -eq "True" -and "$($_.Direction)" -eq "Inbound" -and "$($_.Action)" -eq "Block" -and
                ("$($_.Profile)" -eq "Any" -or "$($_.Profile)" -match $type) })
        if ($rules.Count -gt 0) { $name }
    }
}

# The account the sign-in codes are e-mailed from (scripts\set_email.ps1), read in the .env at the
# root of the project; "" when they are only printed in the API window.
function Get-EmailSender {
    $values = @{}
    foreach ($line in Get-Content (Join-Path (Split-Path -Parent $backend) ".env") -ErrorAction SilentlyContinue) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$' -and -not $values.ContainsKey($Matches[1])) {
            $values[$Matches[1]] = $Matches[2].Trim()
        }
    }
    if ($values["EMAIL_BACKEND"] -match "smtp" -and $values["EMAIL_HOST_USER"]) { return $values["EMAIL_HOST_USER"] }
    return ""
}

# A new PowerShell window titled $Title, running $Command in $Folder. It stays open when the
# command stops, to read its last messages. Its process id and start time are saved: a recycled
# process id is then never mistaken for it.
function Start-Window([string]$Title, [string]$Folder, [string]$Command) {
    $folderQuoted = $Folder -replace "'", "''"
    $script = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$folderQuoted'; $Command"
    $window = Start-Process powershell.exe -ArgumentList "-NoExit", "-NoProfile", "-Command", $script -PassThru
    Add-Content -Path $windowsFile -Value "$($window.Id) $($window.StartTime.Ticks)"
}

Write-Host "ENP Racing Team ERP: starting on this PC" -ForegroundColor Cyan

# --- What the ERP needs ---
if (-not (Test-Path $python)) {
    Stop-WithError "Python virtual environment not found: $python" "Create it first (see backend\README.md)."
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Stop-WithError "The frontend packages are not installed." "Run 'npm.cmd install' in the frontend folder."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-WithError "Docker not found." "Install Docker Desktop (see README.md)."
}
if ($Tailscale) {
    $lan = Get-TailscaleNetwork
    if (-not $lan) {
        Stop-WithError "Tailscale is not connected on this PC." "Open Tailscale (its icon near the clock), sign in, then run this script again."
    }
}
elseif ($Network) {
    $lan = Get-LocalNetwork
    if (-not $lan) {
        Stop-WithError "This PC is connected to no network." "Connect it to the Wi-Fi or the box of the team, then run this script again."
    }
}
if ($Network) {
    $apiUrl = "http://$($lan.Address):$apiPort"
    $webUrl = "http://$($lan.Address):$webPort"
    Write-Host ""
    Write-Host "Network mode: the devices on the network '$($lan.Name)' will open the ERP at $webUrl" -ForegroundColor Cyan
    Write-Host "  Checking the Windows firewall..."
    $pythonHome = ""  # the Python that the virtual environment runs, the one that accepts the connections
    foreach ($line in Get-Content (Join-Path $backend ".venv\pyvenv.cfg")) {
        if ($line -match '^\s*home\s*=\s*(.+)$') { $pythonHome = $Matches[1].Trim(); break }
    }
    $servers = @{ "Python" = (Join-Path $pythonHome "python.exe"); "Node.js" = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
    $blocked = @(Get-BlockedPrograms $servers $lan.Category)
    if ($blocked.Count -eq 0) {
        Write-Host "  Windows may ask whether Python and Node.js may accept connections on this network ($($lan.Category)"
        Write-Host "  for Windows): tick it and click 'Allow access' (administrator), or the other devices cannot reach the ERP."
    }
    else {
        Write-Host "  The Windows firewall blocks $($blocked -join ' and ') on $($lan.Category) networks: the other devices cannot reach the ERP." -ForegroundColor Yellow
        if ($lan.Category -eq "Public") {
            Write-Host "  On the team's hotspot or the club's box, make this network Private (Windows settings > Network &" -ForegroundColor Yellow
            Write-Host "  internet > Wi-Fi > '$($lan.Name)' > Private network), start again, and allow Python if Windows asks." -ForegroundColor Yellow
        }
        else {
            Write-Host "  Allow them (administrator): control /name Microsoft.WindowsFirewall /page pageConfigureApps," -ForegroundColor Yellow
            Write-Host "  then 'Change settings', and tick $($lan.Category) for python.exe and Node.js." -ForegroundColor Yellow
        }
    }
}
foreach ($port in @($apiPort, $webPort)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        Stop-WithError "Port $port is already in use ($($owner.ProcessName), process $($listener.OwningProcess)): the ERP or a development server is already running." `
            "Open $webUrl, or stop it first: scripts\stop_erp.ps1"
    }
}

# --- 1. Docker ---
Write-Step "Docker: database and Redis"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path $desktop)) {
        Stop-WithError "Docker is not running." "Start Docker Desktop, then run this script again."
    }
    Write-Host "  Starting Docker Desktop (up to 3 minutes)..."
    Start-Process $desktop
    $deadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 5
        docker info *> $null
    } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "Docker Desktop did not start." "Open Docker Desktop and read its message, then run this script again."
    }
}
Push-Location $root
docker compose up -d
$exitCode = $LASTEXITCODE
Pop-Location
if ($exitCode -ne 0) { Stop-WithError "The containers could not be started (see above)." }
foreach ($name in $containers) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $health = docker inspect --format "{{.State.Health.Status}}" $name 2>$null
        if ($health -eq "healthy") { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    Write-Host "  $name : $health"
    if ($health -ne "healthy") { Stop-WithError "The container $name is not ready." "Read its log: docker logs $name" }
}

# --- 2. Database ---
if ($Demo) { Write-Step "Database: migrations and demo data" } else { Write-Step "Database: migrations" }
Push-Location $backend
& $python manage.py migrate --noinput
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0 -and $Demo) {
    & $python manage.py seed_demo
    $exitCode = $LASTEXITCODE
}
Pop-Location
if ($exitCode -ne 0) { Stop-WithError "The database could not be prepared (see above)." }

# --- 3. Web pages: production build ---
# The API address is built into the pages, and the network mode builds them with another one (the end-to-end
# tests build theirs into .next-e2e): the address and the build id of the last build made here are kept next to it.
Write-Step "Web pages: production build"
$buildId = Join-Path $frontend ".next\BUILD_ID"
$stamp = Join-Path $frontend ".next\erp-start.txt"
$reason = ""
if ($Rebuild) { $reason = "-Rebuild" }
elseif (-not (Test-Path $buildId) -or -not (Test-Path $stamp)) { $reason = "no build made by this script yet" }
elseif ((Get-Content $stamp -Raw).Trim() -ne "$apiUrl $((Get-Content $buildId -Raw).Trim())") {
    $reason = "the last build was made for another API address (network mode, another network, end-to-end tests)"
}
else {
    $built = (Get-Item $buildId).LastWriteTime
    $sources = @("src", "messages") | ForEach-Object { Join-Path $frontend $_ }
    $changed = @(Get-ChildItem -Path $sources -Recurse -File | Where-Object { $_.LastWriteTime -gt $built })
    $changed += @("package.json", "package-lock.json", "next.config.ts") |
        ForEach-Object { Get-Item (Join-Path $frontend $_) } | Where-Object { $_.LastWriteTime -gt $built }
    if ($changed.Count -gt 0) { $reason = "$($changed.Count) file(s) changed since the last build" }
}
if ($reason) {
    Write-Host "  Building ($reason): 1 to 3 minutes..."
    $env:NEXT_PUBLIC_API_URL = $apiUrl
    Push-Location $frontend
    & $npm run --silent build
    $exitCode = $LASTEXITCODE
    Pop-Location
    if ($exitCode -ne 0) { Stop-WithError "The build of the web pages failed (see above)." }
    Set-Content -Path $stamp -Value "$apiUrl $((Get-Content $buildId -Raw).Trim())" -Encoding ascii
}
else {
    Write-Host "  Nothing changed since the last build: it is used as it is."
}

# --- 4. API ---
$apiBind = "127.0.0.1:$apiPort"
$apiSettings = ""
if ($Network) {
    # Reachable from the network, for the pages at $webUrl, whose address goes in the links of the
    # e-mails: settings.py takes these variables before the lines of the .env file.
    $apiBind = "0.0.0.0:$apiPort"
    $apiSettings = "`$env:ALLOWED_HOSTS = 'localhost,127.0.0.1,$($lan.Address)'; `$env:CORS_ALLOWED_ORIGINS = '$webUrl'; " +
        "`$env:CSRF_TRUSTED_ORIGINS = '$webUrl'; `$env:FRONTEND_URL = '$webUrl'; "
}
Write-Step "API (Django) on $apiBind"
$pythonQuoted = $python -replace "'", "''"
Start-Window "ERP - API - sign-in codes" $backend "$apiSettings& '$pythonQuoted' manage.py runserver $apiBind --noreload"
if (-not (Wait-Http "http://127.0.0.1:$apiPort/api/health/" 60)) {
    Stop-WithError "The API did not answer within 60 s." "Read the message in the 'ERP - API' window, then run scripts\stop_erp.ps1."
}
Write-Host "  Ready."

# --- 5. Web pages ---
$webCommand = "& $npm run start"
if ($Network) { $webCommand = "& npx.cmd next start --hostname 0.0.0.0 --port $webPort" }  # not only localhost
Write-Step "Web pages on $webUrl"
Start-Window "ERP - Web" $frontend $webCommand
if (-not (Wait-Http "$webUrl/fr/login" 60)) {
    Stop-WithError "The web pages did not answer within 60 s." "Read the message in the 'ERP - Web' window, then run scripts\stop_erp.ps1."
}
Write-Host "  Ready."

# --- 6. Browser ---
$sender = Get-EmailSender
Write-Host ""
Write-Host "The ERP is running: $webUrl" -ForegroundColor Green
if ($Tailscale) {
    Write-Host "  The people this PC is shared with on Tailscale open $webUrl, from anywhere, with Tailscale on."
}
elseif ($Network) {
    Write-Host "  The members on the network '$($lan.Name)' open $webUrl on their phone or computer."
}
if ($sender) {
    Write-Host "  Sign in with your e-mail address: the 6-digit code is e-mailed to it, from $sender."
    Write-Host "  Demo people (fictitious, codes in the 'ERP - API' window): first name + .demo@example.invalid"
}
else {
    Write-Host "  Sign in with your e-mail address: the 6-digit code is printed in the 'ERP - API' window."
    Write-Host "  Demo people (fictitious): first name + .demo@example.invalid, e.g. lina.demo@example.invalid"
    if ($Network) {
        Write-Host "  The members cannot receive their codes yet: e-mail them with scripts\set_email.ps1" -ForegroundColor Yellow
    }
    else {
        Write-Host "  To e-mail the codes to the members: scripts\set_email.ps1"
    }
}
Write-Host "  Stop it: scripts\stop_erp.ps1"
if (-not $NoBrowser) { Start-Process "$webUrl/fr" }
exit 0
