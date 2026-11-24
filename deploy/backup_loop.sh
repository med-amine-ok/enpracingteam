#!/bin/sh
# The ERP's nightly backup (docker-compose.prod.yml, service "backup"): at 03:00 (TZ), a dump of the
# database and an archive of the documents' files (/media) in /backups (ERP_DATA\backups on the PC); the
# last 14 days are kept.
# Backup now or restore: scripts\backup_prod.ps1.
while true; do
  if [ "$(date +%H:%M)" = "03:00" ]; then
    file="/backups/erp_$(date +%Y%m%d_%H%M).dump"
    if pg_dump --format=custom --file="$file.part"; then
      mv "$file.part" "$file" && echo "backup: $file"
    else
      rm -f "$file.part"
      echo "backup FAILED at $(date)" >&2
    fi
    files="/backups/erp_media_$(date +%Y%m%d_%H%M).tar.gz"
    if tar -czf "$files.part" -C /media .; then
      mv "$files.part" "$files" && echo "backup: $files"
    else
      rm -f "$files.part"
      echo "backup of the files FAILED at $(date)" >&2
    fi
    find /backups -name 'erp_*.dump' -mtime +13 -delete
    find /backups -name 'erp_media_*.tar.gz' -mtime +13 -delete
    sleep 60
  fi
  sleep 20
done
