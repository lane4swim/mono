#!/usr/bin/env bash
# Legt für jede Rolle (superadmin, admin, trainer, athlete, referee, parent)
# zusätzliche Testkonten samt Testverein an — gedacht für die Codespace-
# Konsole, NACHDEM scripts/setup-codespace.sh vollständig durchgelaufen ist
# (braucht apps/api/.env, das Datenbankschema und die gebauten Workspaces).
# Die eigentliche Arbeit macht apps/api/scripts/createTestAccounts.ts —
# dort stehen auch die Details zu den angelegten Konten.
#
# Nutzung:
#   bash scripts/create-test-accounts.sh                    # 2 Konten je Rolle
#   bash scripts/create-test-accounts.sh --count=5          # 5 Konten je Rolle (max. 20)
#   bash scripts/create-test-accounts.sh --club="SV Test"   # anderer Vereinsname
#   bash scripts/create-test-accounts.sh --reset-passwords  # vorhandene Testkonten auf neues Passwort setzen
#
# Passwort: zufällig erzeugt und am Ende einmal ausgegeben, oder per
#   TEST_ACCOUNT_PASSWORD='...' bash scripts/create-test-accounts.sh
# vorgegeben (mind. 12 Zeichen, nicht aus bekannten Datenlecks).
# Rückfrage überspringen (z. B. für einen nicht-interaktiven Lauf):
#   TEST_ACCOUNTS_CONFIRM=yes-test-accounts bash scripts/create-test-accounts.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f apps/api/.env ]]; then
  echo "Fehler: apps/api/.env fehlt — bitte zuerst 'bash scripts/setup-codespace.sh' ausführen." >&2
  exit 1
fi
if [[ ! -f packages/shared-types/dist/index.js ]]; then
  echo "Fehler: packages/shared-types ist nicht gebaut — bitte zuerst 'bash scripts/setup-codespace.sh'" >&2
  echo "vollständig durchlaufen lassen (oder 'npm run build --workspace=apps/api')." >&2
  exit 1
fi

if [[ "${TEST_ACCOUNTS_CONFIRM:-}" != "yes-test-accounts" ]]; then
  if [[ "${CODESPACES:-}" != "true" ]]; then
    echo "Warnung: das hier ist offenbar KEIN GitHub Codespace (CODESPACES ist nicht gesetzt)." >&2
  fi
  echo "Es werden Testkonten mit gemeinsamem, bekanntem Passwort (inkl. Superadmin) in der"
  echo "Datenbank aus apps/api/.env angelegt. Nur für Test-/Codespace-Instanzen gedacht."
  read -rp "Fortfahren? [j/N] " answer
  if [[ ! "$answer" =~ ^[jJyY]$ ]]; then
    echo "Abgebrochen."
    exit 1
  fi
fi

TEST_ACCOUNTS_CONFIRM=yes-test-accounts npm run --silent create-test-accounts --workspace=apps/api -- "$@"
