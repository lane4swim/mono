#!/usr/bin/env bash
# scripts/setup-codespace.sh
#
# Automatisiert die Schritte 4–10 aus docs/deployment-github-codespaces.md
# (Software installieren, npm-Abhängigkeiten, apps/api/.env konfigurieren,
# Datenbank-Schema anlegen, Backend bauen, PM2 starten, ersten Superadmin
# anlegen, Nginx konfigurieren) für einen frisch erstellten GitHub Codespace.
# Schritte 1–3 dort (Codespace erstellen, Branch/Maschine wählen, Terminal
# öffnen) sind keine Kommandos — hier geht es erst ab Schritt 4 los.
# Schritte 11+ (Port veröffentlichen, Testen, Anhalten/Fortsetzen, …) sind
# bewusst NICHT Teil dieses Scripts — dafür weiterhin
# docs/deployment-github-codespaces.md befolgen.
#
# Nutzung:
#   bash scripts/setup-codespace.sh
#
# Superadmin-Zugangsdaten (Schritt 9.1) sind per Umgebungsvariable
# überschreibbar, Default entspricht den Vorgaben für diesen Testlauf:
#   SUPERADMIN_EMAIL=admin@test.de SUPERADMIN_PASSWORD=pwd12345 bash scripts/setup-codespace.sh
#
# Wiederholt ausführbar: bereits installierte Software wird übersprungen,
# eine bereits vorhandene apps/api/.env wird NICHT überschrieben (verhindert,
# dass ein erneuter Lauf das DB-Passwort/die JWT-Schlüssel unbemerkt
# austauscht und damit die bereits laufende Konfiguration zerschießt), ein
# bereits vorhandenes Superadmin-Konto wird übersprungen statt das Script
# abzubrechen, und PM2/Nginx werden neu gestartet statt doppelt angelegt.

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
ENV_WAS_CREATED=0
if [[ -f "$ENV_FILE" ]]; then
  echo "  $ENV_FILE existiert bereits — wird nicht überschrieben."
else
  ENV_WAS_CREATED=1
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
# `migrate deploy` statt `db push` (Code-Review, Befund W5): wendet die
# committete Migrationshistorie unter apps/api/prisma/migrations/ an.
log "Schritt 7: Datenbank-Schema anlegen (prisma migrate deploy)"
(cd apps/api && npx prisma migrate deploy)

# --- Schritt 8: Backend bauen -------------------------------------------------
log "Schritt 8: Backend bauen (inkl. packages/shared-types, packages/sync-protocol über prebuild-Skripte)"
npm run build --workspace=apps/api

# --- Schritt 9: Backend mit PM2 starten ---------------------------------------
log "Schritt 9: Backend mit PM2 starten"
if pm2 describe lane1-api >/dev/null 2>&1; then
  echo "  Prozess lane1-api läuft bereits unter PM2 — wird neu gestartet."
  (cd apps/api && pm2 restart lane1-api)
else
  (cd apps/api && pm2 start dist/index.js --name lane1-api)
fi
pm2 status

# --- Schritt 9.1: Ersten Superadmin anlegen -----------------------------------
log "Schritt 9.1: Ersten Superadmin anlegen"
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-admin@test.de}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-pwd12345}"
SUPERADMIN_NAME="${SUPERADMIN_NAME:-Test Admin}"
if [[ ${#SUPERADMIN_PASSWORD} -lt 8 ]]; then
  echo "  Fehler: SUPERADMIN_PASSWORD muss mindestens 8 Zeichen lang sein (siehe apps/api/scripts/createSuperAdmin.ts)." >&2
  exit 1
fi
if (
  cd apps/api
  npm run create-superadmin -- --email="${SUPERADMIN_EMAIL}" --password="${SUPERADMIN_PASSWORD}" --name="${SUPERADMIN_NAME}"
); then
  echo "  Superadmin ${SUPERADMIN_EMAIL} angelegt."
else
  echo "  Hinweis: Anlegen übersprungen/fehlgeschlagen — existiert vermutlich bereits (${SUPERADMIN_EMAIL})."
fi

# --- Schritt 10: Nginx konfigurieren ------------------------------------------
log "Schritt 10: Nginx konfigurieren"
sudo tee /etc/nginx/sites-available/lane1 >/dev/null <<NGINX
server {
    listen 8080;
    server_name _;

    # Weboberfläche (PWA) als statische Dateien ausliefern
    root ${REPO_ROOT}/apps/web;
    index index.html;

    # Content-Security-Policy für das Frontend (Code-Review, Befund S3) —
    # siehe docs/deployment.md, Abschnitt 9 für die ausführliche Begründung.
    set \$csp "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Content-Security-Policy \$csp always;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
        add_header Content-Security-Policy \$csp always;
    }

    # API-Anfragen an das Node.js-Backend weiterleiten
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Login/Registrierung/Token-Refresh/Logout — bewusst EIGENER Block, da
    # diese Routen im Backend ohne /api/-Präfix registriert sind.
    location /auth/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Health-Check-Endpunkt
    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/lane1 /etc/nginx/sites-enabled/lane1
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo service nginx restart

log "Fertig bis einschließlich Schritt 10."
echo "Superadmin-Login: ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}"
if [[ "$ENV_WAS_CREATED" == "1" ]]; then
  echo "DB-Passwort (lane1_app, frisch erzeugt): ${DB_PASSWORD}"
  echo "Öffentliche Adresse (CORS_ORIGIN/FRONTEND_BASE_URL): ${PUBLIC_URL}"
fi
echo "Weiter geht es manuell mit Schritt 11 (Port veröffentlichen) in docs/deployment-github-codespaces.md."
