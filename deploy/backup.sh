#!/usr/bin/env bash
# Nightly backup of the accounts database and the encryption secret (photos are temporary and not backed up).
# Suggested cron (root):  15 3 * * * /opt/immoba/deploy/backup.sh
set -euo pipefail
DEST="${1:-/var/backups/immoba}"
install -d -m 700 "$DEST"
STAMP=$(date +%Y%m%d)
sqlite3 /var/lib/immoba/immoba.sqlite ".backup '$DEST/immoba-$STAMP.sqlite'" 2>/dev/null || cp /var/lib/immoba/immoba.sqlite "$DEST/immoba-$STAMP.sqlite"
cp /etc/immoba/env "$DEST/env-$STAMP"
chmod 600 "$DEST"/*
find "$DEST" -type f -mtime +30 -delete
