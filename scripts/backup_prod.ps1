<#
.SYNOPSIS
    Backs up the production ERP's database and documents' files now, or restores a backup of the database
    (docker-compose.prod.yml).

.DESCRIPTION
    The database and the files are also backed up each night at 03:00 by the "backup" container
    (deploy/backup_loop.sh, the last 14 days kept), in ERP_DATA\backups.
    Without -Restore: a backup now, erp_manual_<date>.dump and erp_media_manual_<date>.tar.gz.
    The files of an archive are put back by hand: extract it into ERP_DATA\media.
    With -Restore <file name>: the API, the pages and the scheduler are stopped, the database is put
    back as it was in that backup (everything since is lost: a backup is made just before, to undo),
    then they start again.
    Knowledge base: PROJECTS/ERP/hosting_design.md.

.PARAMETER Trial
    The trial on this PC (scripts\deploy_prod.ps1 -Trial) instead of the real production.

.PARAMETER Restore
    The name of a backup file in ERP_DATA\backups, e.g. erp_20261020_0300.dump.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup_prod.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup_prod.ps1 -Restore erp_20261020_0300.dump
#>
param([switch]$Trial, [string]$Restore = "")

$ErrorActionPreference = "Continue"
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

function Stop-WithError([string]$Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Invoke-Compose {
    & docker compose -p $project -f $compose --env-file $envFile @args
}

function Backup-Now([string]$Label) {
    Invoke-Compose exec -T backup sh -c "pg_dump --format=custom --file=/backups/erp_${Label}_`$(date +%Y%m%d_%H%M%S).dump && ls -1t /backups | head -1"
    if ($LASTEXITCODE -ne 0) { Stop-WithError "The backup failed (is the ERP running? scripts\deploy_prod.ps1)." }
}

if (-not (Test-Path $envFile)) { Stop-WithError "No ${envName}: the ERP was never deployed here." }

if (-not $Restore) {
    Write-Host "Backup of the database ($project):"
    Backup-Now "manual"
    Write-Host "Backup of the documents' files:"
    Invoke-Compose exec -T backup sh -c "tar -czf /backups/erp_media_manual_`$(date +%Y%m%d_%H%M%S).tar.gz -C /media . && ls -1t /backups | head -1"
    if ($LASTEXITCODE -ne 0) { Stop-WithError "The backup of the files failed." }
    Write-Host "Done, in the backups folder (ERP_DATA\backups)." -ForegroundColor Green
    exit 0
}

if ($Restore -notmatch '^erp_[A-Za-z0-9_]+\.dump$') { Stop-WithError "Give the name of a backup file, like erp_20261020_0300.dump." }
Invoke-Compose exec -T backup test -f "/backups/$Restore"
if ($LASTEXITCODE -ne 0) { Stop-WithError "No backup named $Restore in ERP_DATA\backups." }

Write-Host "Restoring $Restore ($project). A backup of the current state is made first, to undo:"
Backup-Now "before_restore"
Invoke-Compose stop api web scheduler
Invoke-Compose exec -T backup sh -c "pg_restore --clean --if-exists --no-owner --dbname=`$PGDATABASE /backups/$Restore"
$restored = $LASTEXITCODE
Invoke-Compose start api web scheduler
if ($restored -ne 0) { Stop-WithError "pg_restore reported problems (see above); the API was started again." }
Write-Host "Restored: the ERP is back as it was in $Restore." -ForegroundColor Green
exit 0
