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
#   bash scripts/create-test-accounts.sh --disable-superadmin-mfa
#       # zusätzlich MFA_ENFORCE=false in apps/api/.env setzen und das Backend
#       # (PM2-Prozess lane1-api) neu starten: Superadmins müssen dann bei der
#       # Anmeldung keine Authenticator-App mehr einrichten. Gilt für die ganze
#       # Instanz (auch eine Vereinspflicht für Admins entfällt); TOTP bleibt
#       # freiwillig nutzbar. Rückgängig: MFA_ENFORCE="true" in apps/api/.env
#       # setzen und `cd apps/api && pm2 restart lane1-api`.
#
# Passwort: zufällig erzeugt und am Ende einmal ausgegeben, oder per
#   TEST_ACCOUNT_PASSWORD='...' bash scripts/create-test-accounts.sh
# vorgegeben (mind. 12 Zeichen, nicht aus bekannten Datenlecks).
# Rückfrage überspringen (z. B. für einen nicht-interaktiven Lauf):
#   TEST_ACCOUNTS_CONFIRM=yes-test-accounts bash scripts/create-test-accounts.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --disable-superadmin-mfa wertet nur dieser Wrapper aus (betrifft
# apps/api/.env und PM2, nicht die Datenbank) — alle übrigen Argumente gehen
# unverändert an apps/api/scripts/createTestAccounts.ts.
DISABLE_SUPERADMIN_MFA=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--disable-superadmin-mfa" ]]; then
    DISABLE_SUPERADMIN_MFA=1
  else
    ARGS+=("$arg")
  fi
done

ENV_FILE="apps/api/.env"
if [[ ! -f "$ENV_FILE" ]]; then
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

# Bei --disable-superadmin-mfa schon für diesen Lauf MFA_ENFORCE=false
# vorgeben (hat Vorrang vor apps/api/.env), damit das Skript keinen
# überholten MFA-Hinweis ausgibt. Bricht es ab (z. B. wegen NODE_ENV=production
# außerhalb eines Codespace), endet auch dieser Wrapper (set -e), BEVOR
# apps/api/.env geändert wird.
if [[ "$DISABLE_SUPERADMIN_MFA" == "1" ]]; then
  TEST_ACCOUNTS_CONFIRM=yes-test-accounts MFA_ENFORCE=false npm run --silent create-test-accounts --workspace=apps/api -- ${ARGS[@]+"${ARGS[@]}"}
else
  TEST_ACCOUNTS_CONFIRM=yes-test-accounts npm run --silent create-test-accounts --workspace=apps/api -- ${ARGS[@]+"${ARGS[@]}"}
fi

if [[ "$DISABLE_SUPERADMIN_MFA" == "1" ]]; then
  echo
  if grep -Eq '^MFA_ENFORCE="?false"?[[:space:]]*$' "$ENV_FILE"; then
    echo "MFA_ENFORCE ist in $ENV_FILE bereits \"false\" — Superadmins brauchen keine Zwei-Faktor-Anmeldung."
  else
    # shellcheck source=lib/mfa-env.sh
    source "${REPO_ROOT}/scripts/lib/mfa-env.sh"
    mfa_env_set "$ENV_FILE" MFA_ENFORCE false
    echo "MFA_ENFORCE=\"false\" in $ENV_FILE gesetzt — Superadmins brauchen keine Zwei-Faktor-Anmeldung mehr."
    if command -v pm2 >/dev/null 2>&1 && pm2 describe lane1-api >/dev/null 2>&1; then
      (cd apps/api && pm2 restart lane1-api >/dev/null)
      echo "Backend (PM2-Prozess lane1-api) neu gestartet."
    else
      echo "Kein PM2-Prozess lane1-api gefunden — bitte das Backend neu starten, damit die Änderung wirkt."
    fi
  fi
  echo "Hinweis: Konten, die TOTP bereits eingerichtet haben, werden weiterhin nach dem Code gefragt"
  echo "(freiwillige Nutzung). Zurücksetzen: cd apps/api && npm run reset-mfa -- --email=<email>"
fi
