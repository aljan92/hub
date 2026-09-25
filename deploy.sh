#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
Der frühere NAS-Deploy über Host-Git-Checkout und lokalen Docker-Build wurde abgelöst.
Bitte den Update-Button im Dashboard verwenden. Er lädt das geprüfte Image,
startet den Container neu und stellt bei Fehlern die vorige Version wieder her.
EOF
exit 1
