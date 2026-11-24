<#
.SYNOPSIS
    Stops the ERP started by scripts\start_erp.ps1.

.DESCRIPTION
    1. Closes the "ERP - API" and "ERP - Web" windows, with what runs in them.
    2. Stops what still listens on the ports of the ERP (8000: API, 3000: web pages), such as the
       development servers, when it is Python or Node.js; anything else is left running and named.
    The PostgreSQL and Redis containers keep running (the checks and the development servers use
    them too); with -Docker they are stopped as well (docker compose stop: the data is kept).

.PARAMETER Docker
    Also stop the database and Redis containers.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop_erp.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop_erp.ps1 -Docker
#>
param([switch]$Docker)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$windowsFile = Join-Path $env:TEMP "enp-racing-erp-windows.txt"  # written by start_erp.ps1
$stopped = 0

# 1. The windows opened by start_erp.ps1: a window is recognised by its process id and its start
#    time, so a process id recycled by Windows since then is never stopped by mistake.
if (Test-Path $windowsFile) {
    foreach ($line in Get-Content $windowsFile) {
        $id, $ticks = $line -split " "
        $window = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
        if ($window -and $window.StartTime.Ticks -eq [long]$ticks) {
            Write-Host "  Closing an ERP window (process $id)"
            taskkill.exe /PID $id /T /F | Out-Null
            $stopped++
        }
    }
    Remove-Item $windowsFile
}

# 2. What still listens on the ports of the ERP.
foreach ($port in @(8000, 3000)) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($id in $owners) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        if ($process.ProcessName -in @("python", "node")) {
            Write-Host "  Stopping $($process.ProcessName) on port $port (process $id)"
            Stop-Process -Id $id -Force
            $stopped++
        }
        else {
            Write-Host "  Port $port is used by $($process.ProcessName) (process $id): not the ERP, left running." -ForegroundColor Yellow
        }
    }
}

# 3. The containers, on request.
if ($Docker) {
    Push-Location $root
    docker compose stop
    Pop-Location
}

if ($stopped -gt 0) {
    Write-Host "The ERP is stopped." -ForegroundColor Green
}
else {
    Write-Host "The ERP was not running."
}
exit 0
