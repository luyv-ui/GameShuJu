#!/usr/bin/env bash
set -euo pipefail

database=/var/lib/game-intelligence/investment.sqlite
backup_dir=/var/backups/game-intelligence
node=/opt/game-intelligence/node/bin/node
script=$(readlink -f /opt/game-intelligence/current/scripts/sqlite-backup.mjs)

mkdir -p "$backup_dir"
destination="$backup_dir/investment-$(date -u +%Y%m%d-%H%M%S).sqlite"
"$node" "$script" backup --database "$database" --output "$destination"
find "$backup_dir" -maxdepth 1 -type f -name 'investment-*.sqlite' -mtime +30 -delete
