<#
.SYNOPSIS
    Runs a manage.py command in the production ERP (or the trial): seed_all, grant_admin...

.DESCRIPTION
    The command runs in the "api" container of docker-compose.prod.yml, with the production
    settings (backend\.env.prod; -Trial: backend\.env.trial). Interactive commands work too
    (grant_admin asks for a password, which is never written on the command line).
    Knowledge base: PROJECTS/ERP/guide_hebergement.md.

.PARAMETER Trial
    The trial on this PC (scripts\deploy_prod.ps1 -Trial) instead of the real production.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage_prod.ps1 seed_all
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage_prod.ps1 grant_admin first.last@g.enp.edu.dz
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage_prod.ps1 sendtestemail first.last@g.enp.edu.dz
#>
param(
    [switch]$Trial,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Command
)

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.prod.yml"
if ($Trial) {
    $envName = "backend\.env.trial"
    $project = "enp_erp_trial"
}
else {
    $envName = "backend\.env.prod"
    $project = "enp_erp_prod"
}
$envFile = Join-Path $root $envName
$env:ERP_ENV_FILE = $envName.Replace("\", "/")

if (-not $Command) {
    Write-Host "Give a manage.py command, e.g.: scripts\manage_prod.ps1 seed_all" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $envFile)) {
    Write-Host "No ${envName}: the ERP was never deployed here (scripts\deploy_prod.ps1)." -ForegroundColor Red
    exit 1
}
& docker compose -p $project -f $compose --env-file $envFile exec api python manage.py @Command
exit $LASTEXITCODE
