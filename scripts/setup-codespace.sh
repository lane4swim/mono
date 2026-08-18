#!/usr/bin/env bash
# scripts/setup-codespace.sh
#
# Automatisiert die Schritte 4–8 aus docs/deployment-github-codespaces.md
# (Software installieren, npm-Abhängigkeiten, apps/api/.env konfigurieren,
# Datenbank-Schema anlegen, Backend bauen) für einen frisch erstellten
# GitHub Codespace. Schritte 1–3 dort (Codespace erstellen, Branch/Maschine
# wählen, Terminal öffnen) sind keine Kommandos — hier geht es erst ab
# Schritt 4 los. Schritte 9+ (PM2 starten, Nginx konfigurieren, Port
# veröffentlichen, Superadmin anlegen, …) sind bewusst NICHT Teil dieses
# Scripts — dafür weiterhin docs/deployment-github-codespaces.md befolgen.
#
# Nutzung:
#   bash scripts/setup-codespace.sh
#
# Wiederholt ausführbar: bereits installierte Software wird übersprungen,
# eine bereits vorhandene apps/api/.env wird NICHT überschrieben (verhindert,
# dass ein erneuter Lauf das DB-Passwort/die JWT-Schlüssel unbemerkt
# austauscht und damit die bereits laufende Konfiguration zerschießt).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

DB_NAME="lane1"
DB_USER="lane1_app"
# Nur relevant, falls die Rolle in diesem Lauf NEU angelegt wird (siehe
# Schritt 4.2) — per DB_PASSWORD=... vorgebbar, sonst zufällig erzeugt.
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"

# --- Schritt 4.1: Node.js ---------------------------------------------------
log "Schritt 4.1: Node.js (v22) installieren"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

sudo apt-get update

# --- Schritt 4.2: PostgreSQL -------------------------------------------------
log "Schritt 4.2: PostgreSQL installieren und Datenbank anlegen"
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get install -y postgresql
fi
sudo service postgresql start

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASSWORD}';"
else
  echo "  Rolle ${DB_USER} existiert bereits — Passwort bleibt unverändert."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
# Seit PostgreSQL 15 zusätzlich nötig, sonst schlägt Schritt 7 (prisma db
# push) mit "permission denied for schema public" fehl (siehe Doku 4.2).
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# --- Schritt 4.3: Nginx ------------------------------------------------------
log "Schritt 4.3: Nginx installieren (Konfiguration folgt erst in Schritt 10)"
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get install -y nginx
fi
sudo service nginx stop || true

# --- Schritt 4.4: PM2 --------------------------------------------------------
log "Schritt 4.4: PM2 installieren"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

# --- Schritt 5: npm-Abhängigkeiten -------------------------------------------
log "Schritt 5: npm-Abhängigkeiten installieren (alle Workspaces)"
npm install

# --- Schritt 6: apps/api/.env konfigurieren ----------------------------------
log "Schritt 6: apps/api/.env konfigurieren"
ENV_FILE="apps/api/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "  $ENV_FILE existiert bereits — wird nicht überschrieben."
else
  if [[ -n "${CODESPACE_NAME:-}" ]]; then
    PUBLIC_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
  else
    PUBLIC_URL="http://localhost:5173"
    echo "  Hinweis: CODESPACE_NAME nicht gesetzt (kein Codespace?) — verwende ${PUBLIC_URL}."
  fi

  JWT_SIGNING_KEY="$(openssl rand -base64 48)"

  TMP_KEY_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_KEY_DIR"' EXIT
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP_KEY_DIR/private.pem"
  openssl pkey -in "$TMP_KEY_DIR/private.pem" -pubout -out "$TMP_KEY_DIR/public.pem"
  JWT_PRIVATE_KEY="$(awk 'BEGIN{ORS="\\n"} {print}' "$TMP_KEY_DIR/private.pem")"
  JWT_PUBLIC_KEY="$(awk 'BEGIN{ORS="\\n"} {print}' "$TMP_KEY_DIR/public.pem")"
  rm -rf "$TMP_KEY_DIR"
  trap - EXIT

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000

DATABASE_URL="${DATABASE_URL}"

JWT_SIGNING_KEY="${JWT_SIGNING_KEY}"

JWT_PRIVATE_KEY="${JWT_PRIVATE_KEY}"
JWT_PUBLIC_KEY="${JWT_PUBLIC_KEY}"

JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_DAYS=30

CORS_ORIGIN="${PUBLIC_URL}"
FRONTEND_BASE_URL="${PUBLIC_URL}"

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL="noreply@lane1.example.org"
SMTP_FROM_NAME="Lane 1"

DATA_ERASURE_RETENTION_DAYS=30
EOF

  echo "  $ENV_FILE geschrieben. Öffentliche Adresse (für Schritt 11): ${PUBLIC_URL}"
fi

# --- Schritt 7: Datenbank-Schema anlegen -------------------------------------
log "Schritt 7: Datenbank-Schema anlegen (prisma db push)"
(cd apps/api && npx prisma db push)

# --- Schritt 8: Backend bauen -------------------------------------------------
log "Schritt 8: Backend bauen (inkl. packages/shared-types, packages/sync-protocol über prebuild-Skripte)"
npm run build --workspace=apps/api

log "Fertig bis einschließlich Schritt 8."
echo "Weiter geht es manuell mit Schritt 9 (PM2 starten) in docs/deployment-github-codespaces.md."
