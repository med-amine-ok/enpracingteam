<#
.SYNOPSIS
    Real e-mails: the sign-in codes and the notifications of the ERP reach the members' inboxes,
    sent from a Google account (Gmail, or a school account such as @g.enp.edu.dz).

.DESCRIPTION
    Before: signed in with the sending account, create an app password at
    https://myaccount.google.com/apppasswords (2-Step Verification must be on). Google shows it
    once: 16 letters. Never send it to anyone, not even in a chat.

    This script runs backend\manage.py setup_email
    (backend\apps\communication\management\commands\setup_email.py):
    1. it asks for the sending address and the app password (typed hidden);
    2. it sends a test e-mail to that address with them;
    3. only if it went out, it saves them in the .env at the root of the project, a file that stays on
       this PC (.gitignore).
    The demo's fictitious people (@example.invalid) never receive e-mails: their codes stay printed
    in the "ERP - API" window. Then restart the ERP: scripts\stop_erp.ps1, then scripts\start_erp.ps1.

.PARAMETER Off
    No more real e-mails: the codes are printed in the "ERP - API" window again. The account stays saved.

.PARAMETER On
    Real e-mails again with the saved account, after a test e-mail.

.PARAMETER EnvFile
    Another settings file than backend\.env, such as backend\.env.prod for the server
    (knowledge base: PROJECTS/ERP/guide_hebergement.md).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set_email.ps1
    scripts\set_email.cmd -Off
    scripts\set_email.cmd -EnvFile backend\.env.prod
#>
param([switch]$On, [switch]$Off, [string]$EnvFile = "")

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"  # accents in the Python output (see check_all.ps1)

$backend = Join-Path (Split-Path -Parent $PSScriptRoot) "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Python virtual environment not found: $python" -ForegroundColor Red
    Write-Host "  -> Create it first (see backend\README.md)." -ForegroundColor Yellow
    exit 1
}
if ($On -and $Off) {
    Write-Host "Choose -On or -Off, not both." -ForegroundColor Red
    exit 1
}
$arguments = @()
if ($On) { $arguments += "--on" }
if ($Off) { $arguments += "--off" }
if ($EnvFile) {
    if (-not (Test-Path $EnvFile -PathType Leaf)) {
        Write-Host "Settings file not found: $EnvFile" -ForegroundColor Red
        exit 1
    }
    $arguments += "--env-file", (Resolve-Path $EnvFile).Path  # before moving to the backend folder
}

Push-Location $backend
& $python manage.py setup_email @arguments
$exitCode = $LASTEXITCODE
Pop-Location
exit $exitCode
