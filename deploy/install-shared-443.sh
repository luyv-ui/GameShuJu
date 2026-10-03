#!/usr/bin/env bash
set -euo pipefail

config=/etc/nginx/sites-available/default
snippet=/etc/nginx/snippets/game-intelligence-443.conf
source_snippet=${1:?Provide the path to nginx-shared-443.conf}
marker='    include /etc/nginx/snippets/game-intelligence-443.conf;'

if grep -Fq "$marker" "$config"; then
  echo 'Shared route already installed'
  exit 0
fi

backup="${config}.game-intelligence-$(date -u +%Y%m%d-%H%M%S).bak"
cp -p "$config" "$backup"
install -m 644 "$source_snippet" "$snippet"
temporary=$(mktemp)
awk -v marker="$marker" '
  { print }
  $0 == "    client_max_body_size 64k;" { print ""; print marker; matches++ }
  END { if (matches != 1) exit 1 }
' "$config" > "$temporary" || { rm -f "$temporary"; exit 1; }
install -m 644 "$temporary" "$config"
rm -f "$temporary"
if ! nginx -t; then
  cp -p "$backup" "$config"
  nginx -t
  exit 1
fi
systemctl reload nginx
echo "Installed shared route; previous config: $backup"
