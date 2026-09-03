#!/usr/bin/env bash
# scripts/setup-netcup.sh
#
# Automatisiert die Schritte 6–9 aus docs/deployment-netcup.md (Software
# installieren, npm-Abhängigkeiten, apps/api/.env konfigurieren, Datenbank-
# Schema anlegen, Backend bauen, PM2 starten samt Autostart, ersten
# Superadmin anlegen, Nginx konfigurieren) für einen bereits eingerichteten
# netcup-vServer.
#
# Schritte 1–5 dort (Produktwahl, Konto/Server/SSH-Key/Firewall im SCP,
# erste SSH-Verbindung, Server-Grundhärtung inkl. eigenem `deploy`-Benutzer,
# Domain/DNS-A-Record) sind KEINE Kommandos dieses Repos, sondern Klicks im
# netcup-Kundenpanel bzw. einmalige Handgriffe auf dem noch leeren Server —
# hier geht es erst los, nachdem das Repository bereits (per `git clone`
# oder Datei-Upload, siehe Abschnitt 7 dort) im Arbeitsverzeichnis liegt und
# als `deploy`-Benutzer mit sudo-Rechten ausgeführt wird.
# Schritt 10+ (HTTPS mit Let's Encrypt/certbot, Testen, Backups, künftige
# Updates, laufende Wartung) sind bewusst NICHT Teil dieses Scripts — dafür
# weiterhin docs/deployment-netcup.md ab Abschnitt 10 befolgen. Grund: DNS
# muss zu diesem Zeitpunkt bereits auf den Server zeigen (Abschnitt 5),
# sonst schlägt certbot fehl — das lässt sich von hier aus nicht prüfen.
#
# Nutzung (auf dem Server, im geklonten Projektordner):
#   bash scripts/setup-netcup.sh
#
# Erforderliche Angaben:
#   - Domain (Abschnitt 5 dort muss vorher erledigt sein, d. h. der
#     A-Record zeigt bereits auf diesen Server): wird interaktiv abgefragt,
#     falls nicht per DOMAIN=training.mein-verein.de vorgegeben.
#   - Superadmin-E-Mail-Adresse und -Passwort (Schritt 8.1): interaktiv
#     abgefragt (Passwort ohne Terminal-Echo, mit Bestätigung) — es gibt
#     bewusst KEIN Default-Passwort (Sicherheitsreview 2026-08, Befund H1).
#   - SMTP-Zugangsdaten (optional, für tatsächlich versendete Einladungs-
#     E-Mails statt nur Server-Log-Eintrag): wird bei fehlender
#     SMTP_HOST-Umgebungsvariable interaktiv erfragt, ob jetzt eingerichtet
#     werden soll.
# Für einen nicht-interaktiven Lauf lässt sich alles per Umgebungsvariable
# vorgeben, z. B.:
#   DOMAIN=training.mein-verein.de \
#   SUPERADMIN_EMAIL=admin@mein-verein.de SUPERADMIN_PASSWORD='...' \
#   SMTP_HOST=smtp.beispiel-anbieter.de SMTP_USER=... SMTP_PASSWORD=... \
#   bash scripts/setup-netcup.sh
# Am Ende des Scripts wird ausschließlich die Superadmin-E-Mail-Adresse noch
# einmal ausgegeben, nie ein Passwort.
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

# Sicherheitskorrektur (Code-Review 2026-09-02, Befund D2): Escapt einen
# Wert für die sichere Einbettung in ein einfach gequotetes SQL-Zeichenketten-
# Literal (verdoppelt eingebettete `'`, die Standard-SQL-Escapierung) — NUR
# für Werte gedacht, die per Heredoc auf STDIN von `psql` gereicht werden
# (siehe die beiden CREATE-USER-Aufrufe unten), NIEMALS für ein `-c`-
# Kommandozeilenargument. Letzteres wäre über `ps aux`/`/proc/<pid>/cmdline`
# für JEDES lokale Konto lesbar — dieselbe Fehlerklasse, die bereits für das
# Superadmin-Passwort behoben wurde (Commit 45dc106, „fix(scripts): stop
# passing superadmin password as a CLI argument"), hier aber übersehen
# blieb. Ein Heredoc auf STDIN erscheint dagegen nicht in der Prozess-
# Argumentliste.
sql_quote() { printf '%s' "$1" | sed "s/'/''/g"; }

# --- Domain -------------------------------------------------------------
# Nicht geheim, aber zwingend nötig für CORS_ORIGIN/FRONTEND_BASE_URL
# (Schritt 7.2) und den Nginx server_name (Schritt 9) — ohne exakt
# übereinstimmenden Wert schlägt der Login später mit einem CORS-Fehler
# fehl, obwohl Backend und Nginx beide einwandfrei laufen.
if [[ -z "${DOMAIN:-}" ]]; then
  read -rp "Domain (muss bereits per DNS-A-Record auf diesen Server zeigen, z. B. training.mein-verein.de): " DOMAIN
fi
if [[ -z "${DOMAIN}" ]]; then
  echo "Fehler: Domain darf nicht leer sein (siehe docs/deployment-netcup.md, Abschnitt 5)." >&2
  exit 1
fi
PUBLIC_URL="https://${DOMAIN}"

DB_NAME="lane1"
DB_USER="lane1_app"
# Nur relevant, falls die Rolle in diesem Lauf NEU angelegt wird (siehe
# Schritt 6.2/Abschnitt weiter unten) — per DB_PASSWORD=... vorgebbar, sonst
# zufällig erzeugt.
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
# Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund N1): eigene
# Rolle NUR für `prisma migrate deploy` (Schritt 7.3) — DB_USER/lane1_app
# oben ist die Rolle, mit der die Anwendung dauerhaft läuft (DATABASE_URL in
# .env, Schritt 7.2) und bekommt bewusst KEINE DDL-Rechte. Analog zu
# DB_PASSWORD per DB_MIGRATOR_PASSWORD=... vorgebbar, sonst zufällig erzeugt.
DB_MIGRATOR_USER="lane1_migrator"
DB_MIGRATOR_PASSWORD="${DB_MIGRATOR_PASSWORD:-$(openssl rand -hex 16)}"

# --- Schritt 6: Benötigte Software installieren ------------------------------
log "Schritt 6.1: Node.js (v22) installieren"
sudo apt-get update
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

log "Schritt 6.2: PostgreSQL installieren und Datenbank anlegen"
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get install -y postgresql
fi
sudo systemctl enable --now postgresql

# Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund N1): ZWEI
# Rollen statt einer. ${DB_MIGRATOR_USER} wendet ausschließlich das
# Datenbankschema an (prisma migrate deploy, Schritt 7.3) und braucht dafür
# DDL-Rechte (Tabellen anlegen/ändern) — deshalb Eigentümerin der
# Datenbank. ${DB_USER} ist die Rolle, mit der die Anwendung selbst zur
# Laufzeit läuft (DATABASE_URL in .env, Schritt 7.2) und bekommt bewusst
# NUR Lese-/Schreibrechte auf Zeilenebene, keine DDL-Rechte — ein zur
# Laufzeit erlangter Datenbankzugriff kann dadurch keine Tabellen mehr
# anlegen, ändern oder löschen.
MIGRATOR_ROLE_CREATED=0
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_MIGRATOR_USER}'" | grep -q 1; then
  # Sicherheitskorrektur (Befund D2, siehe sql_quote()-Kommentar oben):
  # Passwort per Heredoc auf STDIN statt per `-c "..."` — Letzteres wäre als
  # Kommandozeilenargument des psql-Prozesses für jedes lokale Konto sichtbar.
  sudo -u postgres psql <<SQL
CREATE USER ${DB_MIGRATOR_USER} WITH ENCRYPTED PASSWORD '$(sql_quote "${DB_MIGRATOR_PASSWORD}")';
SQL
  MIGRATOR_ROLE_CREATED=1
else
  echo "  Rolle ${DB_MIGRATOR_USER} existiert bereits — Passwort bleibt unverändert."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql <<SQL
CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '$(sql_quote "${DB_PASSWORD}")';
SQL
else
  echo "  Rolle ${DB_USER} existiert bereits — Passwort bleibt unverändert."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_MIGRATOR_USER};"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_MIGRATOR_USER};"
sudo -u postgres psql -c "GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};"
# Seit PostgreSQL 15 zusätzlich nötig, sonst schlägt Schritt 7.3 (prisma
# migrate deploy) mit "permission denied for schema public" fehl — gilt nur
# für die Eigentümerin ${DB_MIGRATOR_USER}, ${DB_USER} bekommt stattdessen
# die explizite, auf DML begrenzte Zeile darunter.
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_MIGRATOR_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT USAGE ON SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${DB_USER};"
# Sorgt dafür, dass auch von KÜNFTIGEN Migrationen (durch ${DB_MIGRATOR_USER}
# neu angelegte Tabellen) automatisch dieselben Rechte für ${DB_USER}
# gelten, ohne nach jeder Migration erneut manuell GRANTen zu müssen.
sudo -u postgres psql -d "${DB_NAME}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${DB_MIGRATOR_USER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_USER};"

# ${DB_MIGRATOR_USER}s Zugangsdaten bewusst NICHT in apps/api/.env (das
# liest ausschließlich die Anwendung selbst, siehe Schritt 7.2/Befund N1) —
# stattdessen in einer eigenen, chmod-600-geschützten Datei, damit sie bei
# einer künftigen manuellen `prisma migrate deploy` (Abschnitt 13, nach
# einer neuen, per `git pull` hinzugekommenen Migration) wiederauffindbar
# bleiben, ohne dass ein Blick in die Skript-Ausgabe dieses einen Laufs
# nötig ist.
#
# NUR schreiben, wenn die Rolle in DIESEM Lauf tatsächlich neu angelegt
# wurde: ${DB_MIGRATOR_PASSWORD} ist sonst ein frisch gewürfelter Wert,
# der nie in die Datenbank geschrieben wurde (der else-Zweig oben lässt
# das bestehende Passwort bewusst unverändert). Ein unbedingtes
# Überschreiben hinterließe nach jedem Wiederholungslauf eine Datei mit
# einem Passwort, das schlicht nicht funktioniert — genau die Art
# stillschweigender Zugangsdaten-Vertauschung, die dieses Skript für
# apps/api/.env ausdrücklich vermeidet (siehe Kopfkommentar oben).
MIGRATOR_ENV_FILE="apps/api/.env.migrate"
if [[ "$MIGRATOR_ROLE_CREATED" == "1" ]]; then
  MIGRATE_DATABASE_URL="postgresql://${DB_MIGRATOR_USER}:${DB_MIGRATOR_PASSWORD}@localhost:5432/${DB_NAME}"
  cat >"$MIGRATOR_ENV_FILE" <<EOF
# apps/api/.env.migrate — NICHT von der Anwendung oder von Prisma
# automatisch gelesen (nur "apps/api/.env" wird automatisch geladen).
# Ausschließlich zum manuellen Nachschlagen für ein künftiges
# "prisma migrate deploy" gedacht, siehe scripts/setup-netcup.sh
# bzw. docs/deployment-netcup.md, Abschnitt 7.3 und 13.
MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL}"
EOF
  chmod 600 "$MIGRATOR_ENV_FILE"
elif [[ -f "$MIGRATOR_ENV_FILE" ]]; then
  # Rolle bestand bereits UND die Datei aus dem damaligen Lauf ist noch da
  # — unverändert lassen, sie trägt weiterhin das tatsächlich gültige
  # Passwort. Rechte trotzdem nachziehen, falls die Datei aus einer Version
  # vor dieser Korrektur stammt.
  chmod 600 "$MIGRATOR_ENV_FILE"
  echo "  $MIGRATOR_ENV_FILE existiert bereits — wird nicht überschrieben."
  # Sicherheitskorrektur (Code-Review 2026-09-02, Befund D1): das hier
  # hinterlegte, TATSÄCHLICH gültige Passwort zurücklesen — DB_MIGRATOR_PASSWORD
  # oben ist in diesem Zweig ein frisch gewürfelter Wert, der NIE in die
  # Datenbank geschrieben wurde (der else-Zweig bei der Rollenanlage oben
  # lässt das bestehende Passwort bewusst unverändert). Schritt 7.3 unten
  # verwendet ab hier ausschließlich diese zurückgelesene
  # MIGRATE_DATABASE_URL, nie mehr DB_MIGRATOR_PASSWORD direkt — sonst
  # scheiterte `prisma migrate deploy` bei JEDEM Wiederholungslauf
  # (Authentifizierungsfehler gegen die Datenbank), obwohl das Skript für
  # sich selbst "wiederholt ausführbar" in Anspruch nimmt (siehe
  # Kopfkommentar).
  # shellcheck source=/dev/null
  source "$MIGRATOR_ENV_FILE"
  if [[ -z "${MIGRATE_DATABASE_URL:-}" ]]; then
    echo "Fehler: $MIGRATOR_ENV_FILE existiert, enthält aber keine MIGRATE_DATABASE_URL." >&2
    echo "Bitte die Datei prüfen oder löschen und das Passwort der Rolle ${DB_MIGRATOR_USER} neu setzen:" >&2
    echo "  sudo -u postgres psql -c \"ALTER USER ${DB_MIGRATOR_USER} WITH ENCRYPTED PASSWORD '<neues-passwort>';\"" >&2
    echo "und danach $MIGRATOR_ENV_FILE von Hand mit der passenden MIGRATE_DATABASE_URL anlegen." >&2
    exit 1
  fi
else
  # Sicherheitskorrektur (Befund D1): vormals nur ein Hinweis (der Lauf
  # ging munter weiter und scheiterte erst ~200 Zeilen später, in Schritt
  # 7.3, an einem irreführenden Postgres-Authentifizierungsfehler) — jetzt
  # ein Abbruch HIER, an der Stelle, an der das eigentliche Problem
  # entsteht.
  echo "Fehler: Rolle ${DB_MIGRATOR_USER} existiert bereits, aber $MIGRATOR_ENV_FILE fehlt —" >&2
  echo "das gültige Passwort ist diesem Lauf nicht bekannt und wird daher NICHT geraten." >&2
  echo "Für 'prisma migrate deploy' (Schritt 7.3 unten) entweder das alte Passwort in" >&2
  echo "$MIGRATOR_ENV_FILE nachtragen oder ein neues setzen:" >&2
  echo "  sudo -u postgres psql -c \"ALTER USER ${DB_MIGRATOR_USER} WITH ENCRYPTED PASSWORD '<neues-passwort>';\"" >&2
  echo "und danach $MIGRATOR_ENV_FILE von Hand mit der passenden MIGRATE_DATABASE_URL anlegen," >&2
  echo "bevor dieses Skript erneut ausgeführt wird." >&2
  exit 1
fi

log "Schritt 6.3: Nginx installieren (Konfiguration folgt erst in Schritt 9)"
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get install -y nginx
fi
sudo systemctl enable nginx

log "Schritt 6.4: PM2 installieren"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

log "Schritt 6.5: Git installieren"
if ! command -v git >/dev/null 2>&1; then
  sudo apt-get install -y git
fi

# --- Schritt 7.1: npm-Abhängigkeiten -----------------------------------------
log "Schritt 7.1: npm-Abhängigkeiten installieren (alle Workspaces)"
npm install

# --- Schritt 7.2: apps/api/.env konfigurieren --------------------------------
log "Schritt 7.2: apps/api/.env konfigurieren"
ENV_FILE="apps/api/.env"
ENV_WAS_CREATED=0
if [[ -f "$ENV_FILE" ]]; then
  echo "  $ENV_FILE existiert bereits — wird nicht überschrieben."
else
  ENV_WAS_CREATED=1

  # Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund H2,
  # Empfehlung 3): das Schlüsselpaar wird direkt an seinem endgültigen,
  # geschützten Ort erzeugt (apps/api/keys/) statt zuerst in ein temporäres
  # Verzeichnis und von dort — als literal-"\n"-kodierter String — in
  # $ENV_FILE kopiert zu werden. Zwei Vorteile gegenüber der Inline-Form:
  # (1) kein Zwischenschritt, in dem der private Schlüssel zusätzlich
  # unverschlüsselt an einem zweiten Ort liegt, (2) die Schlüsseldatei
  # trägt eigene, engere Dateirechte (600, nur Eigentümer) UNABHÄNGIG von
  # $ENV_FILE (das u. a. auch das Datenbank-Passwort enthält) —
  # apps/api/.env verweist über JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE
  # nur noch auf den Pfad, siehe apps/api/src/config/env.ts.
  KEYS_DIR="${REPO_ROOT}/apps/api/keys"
  mkdir -p "$KEYS_DIR"
  chmod 700 "$KEYS_DIR"
  JWT_PRIVATE_KEY_FILE="${KEYS_DIR}/jwt_private.pem"
  JWT_PUBLIC_KEY_FILE="${KEYS_DIR}/jwt_public.pem"
  # Sicherheitsreview 2026-08-29, Befund N2: `umask 077` VOR der Erzeugung,
  # statt nur `chmod 600` danach. `openssl genpkey -out` legt die Datei
  # unter der geltenden umask an (üblich 0022 -> 0644, weltlesbar) — der
  # private Schlüssel, mit dem sich beliebige Access Tokens signieren
  # lassen (siehe plugins/authenticate.ts: prüft nur die Signatur, nie die
  # Datenbank), lag dadurch zwischen Erzeugung und `chmod` für jedes
  # andere lokale Konto offen. Das Fenster ist kurz, aber vermeidbar; die
  # explizite Rechtevergabe unten bleibt zusätzlich stehen (korrigiert
  # auch eine bereits vorhandene Datei aus der Zeit davor).
  (
    umask 077
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$JWT_PRIVATE_KEY_FILE"
    openssl pkey -in "$JWT_PRIVATE_KEY_FILE" -pubout -out "$JWT_PUBLIC_KEY_FILE"
  )
  chmod 600 "$JWT_PRIVATE_KEY_FILE"
  chmod 644 "$JWT_PUBLIC_KEY_FILE"

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

  # SMTP — optionales Geheimnis: ohne SMTP_HOST wird eine Einladung nur ins
  # Server-Log geschrieben statt tatsächlich per E-Mail versendet (für
  # einen ersten Testlauf ausreichend, für echten Vereinsbetrieb aber
  # nötig). Interaktiv nur nachfragen, wenn weder SMTP_HOST noch ein
  # ausdrücklicher Verzicht per SKIP_SMTP=1 vorgegeben wurde.
  if [[ -z "${SMTP_HOST:-}" && -z "${SKIP_SMTP:-}" ]]; then
    read -rp "  SMTP für Einladungs-E-Mails jetzt einrichten? (j/N): " SETUP_SMTP
    if [[ "${SETUP_SMTP,,}" == "j" || "${SETUP_SMTP,,}" == "y" ]]; then
      read -rp "  SMTP_HOST (z. B. smtp.beispiel-anbieter.de): " SMTP_HOST
      read -rp "  SMTP_PORT [587]: " SMTP_PORT_INPUT
      SMTP_PORT="${SMTP_PORT_INPUT:-587}"
      read -rp "  SMTP_USER: " SMTP_USER
      read -rsp "  SMTP_PASSWORD (wird nicht angezeigt): " SMTP_PASSWORD
      echo
      read -rp "  SMTP_FROM_EMAIL [postversand@${DOMAIN}]: " SMTP_FROM_EMAIL_INPUT
      SMTP_FROM_EMAIL="${SMTP_FROM_EMAIL_INPUT:-postversand@${DOMAIN}}"
    fi
  fi
  SMTP_PORT="${SMTP_PORT:-587}"
  SMTP_FROM_NAME="${SMTP_FROM_NAME:-Lane 1}"

  # Sicherheitsreview 2026-08-29, Befund N2 — dieselbe Begründung wie beim
  # Schlüsselpaar oben: `cat >` legt die Datei unter der geltenden umask an
  # (üblich weltlesbar), und sie enthält u. a. das Datenbank- und ggf.
  # SMTP-Passwort. Der unbedingte `chmod 600` weiter unten bleibt
  # zusätzlich bestehen — er korrigiert auch eine bereits vorhandene Datei
  # aus einem früheren Lauf.
  (
  umask 077
  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000

DATABASE_URL="${DATABASE_URL}"

JWT_PRIVATE_KEY_FILE="${JWT_PRIVATE_KEY_FILE}"
JWT_PUBLIC_KEY_FILE="${JWT_PUBLIC_KEY_FILE}"

JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_DAYS=30

CORS_ORIGIN="${PUBLIC_URL}"
FRONTEND_BASE_URL="${PUBLIC_URL}"

# Sicherheitsreview 2026-08-27, Befund H1 — Nginx (Schritt 9 unten) läuft
# auf demselben Host und ist der einzige tatsächliche Reverse-Proxy-Hop.
# PFLICHT bei NODE_ENV=production (siehe apps/api/src/config/env.ts).
TRUSTED_PROXY_IPS="127.0.0.1"

SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
SMTP_FROM_EMAIL="${SMTP_FROM_EMAIL:-postversand@${DOMAIN}}"
SMTP_FROM_NAME="${SMTP_FROM_NAME}"

DATA_ERASURE_RETENTION_DAYS=30
EOF
  )

  echo "  $ENV_FILE geschrieben. Öffentliche Adresse: ${PUBLIC_URL}"
fi

# Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund H2): $ENV_FILE
# enthält u. a. das DATABASE_URL- und ggf. SMTP-Passwort und — bei einer
# bereits vorhandenen Datei aus der Zeit vor Empfehlung 3 oben — möglich-
# erweise weiterhin JWT_PRIVATE_KEY direkt inline (signiert sämtliche
# Access Tokens). Ohne dies entsteht die Datei per `cat >` unter der
# jeweils geltenden umask, üblich 0644 (weltlesbar). Unbedingt (nicht nur
# im ENV_WAS_CREATED-Zweig oben) — korrigiert bei einem erneuten Lauf auch
# die Rechte einer bereits vorhandenen Datei aus der Zeit vor dieser
# Korrektur.
chmod 600 "$ENV_FILE"

# --- Schritt 7.3: Datenbank-Schema anlegen -----------------------------------
# `migrate deploy` statt `db push` (Code-Review, Befund W5): wendet die
# committete Migrationshistorie unter apps/api/prisma/migrations/ an.
# DATABASE_URL wird hier bewusst mit der DDL-Rolle ${DB_MIGRATOR_USER}
# ÜBERSCHRIEBEN (Sicherheitsreview 2026-08-28, Befund N1) — nur für genau
# diesen einen Befehl, nicht für apps/api/.env selbst (das weiterhin die
# DML-only-Rolle ${DB_USER} trägt, siehe Schritt 7.2). Prismas eigenes
# .env-Laden überschreibt eine bereits gesetzte Umgebungsvariable nicht.
#
# Sicherheitskorrektur (Code-Review 2026-09-02, Befund D1): verwendet
# ausschließlich die oben aufgelöste ${MIGRATE_DATABASE_URL} — NICHT mehr
# ${DB_MIGRATOR_PASSWORD} direkt. Bei einem Wiederholungslauf (Rolle
# existierte bereits) ist DB_MIGRATOR_PASSWORD ein frisch gewürfelter Wert,
# der nie in die Datenbank geschrieben wurde; MIGRATE_DATABASE_URL trägt
# stattdessen das aus apps/api/.env.migrate zurückgelesene, tatsächlich
# gültige Passwort.
log "Schritt 7.3: Datenbank-Schema anlegen (prisma migrate deploy)"
(cd apps/api && DATABASE_URL="${MIGRATE_DATABASE_URL}" npx prisma migrate deploy)

# --- Schritt 7.4: Backend bauen -----------------------------------------------
log "Schritt 7.4: Backend bauen (inkl. packages/shared-types, packages/sync-protocol über prebuild-Skripte)"
npm run build --workspace=apps/api

# --- Schritt 8: Backend mit PM2 starten ---------------------------------------
# Sicherheitsreview 2026-08-28, Befund N2: --node-args="--env-file-if-exists=.env"
# ist Pflicht — weder config/env.ts noch der laufende Server laden
# apps/api/.env von sich aus; ohne dieses Flag stürzt der Prozess sofort
# mit "DATABASE_URL: Required" ab (empirisch geprüft). Nur beim
# ERSTMALIGEN `pm2 start` nötig — `pm2 restart` im else-Zweig darunter
# übernimmt die beim ersten Start hinterlegten Node-Argumente automatisch
# erneut.
log "Schritt 8: Backend mit PM2 starten"
if pm2 describe lane1-api >/dev/null 2>&1; then
  echo "  Prozess lane1-api läuft bereits unter PM2 — wird neu gestartet."
  (cd apps/api && pm2 restart lane1-api)
else
  (cd apps/api && pm2 start dist/index.js --name lane1-api --node-args="--env-file-if-exists=.env")
fi
pm2 status

# Anders als bei einem Codespace ist dieser Server dauerhaft — PM2 muss den
# Prozess deshalb auch nach einem Server-Neustart (z. B. nach einem
# Wartungsfenster) automatisch wieder starten. `pm2 startup` gibt dafür
# einen mit `sudo` beginnenden Befehl aus, der einen systemd-Dienst
# einrichtet; dieser wird hier direkt ausgeführt statt ihn zum manuellen
# Kopieren auszugeben, damit der Autostart nicht vergessen wird.
STARTUP_CMD="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" | tail -n1)"
if [[ "$STARTUP_CMD" == sudo* ]]; then
  eval "$STARTUP_CMD"
else
  echo "  Hinweis: 'pm2 startup' hat keinen sudo-Befehl ausgegeben (evtl. bereits eingerichtet) — Ausgabe:" >&2
  echo "  $STARTUP_CMD" >&2
fi
pm2 save

# --- Schritt 8.1: Ersten Superadmin anlegen -----------------------------------
log "Schritt 8.1: Ersten Superadmin anlegen"
SUPERADMIN_NAME="${SUPERADMIN_NAME:-Vorname Nachname}"

# Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund H1): kein
# Default-Passwort — ohne vorab gesetzte SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD
# wird interaktiv nachgefragt; das Passwort wird dabei per `read -s` NICHT
# auf dem Terminal angezeigt und zur Absicherung gegen Tippfehler ein
# zweites Mal zur Bestätigung abgefragt.
if [[ -z "${SUPERADMIN_EMAIL:-}" ]]; then
  read -rp "  Superadmin-E-Mail-Adresse: " SUPERADMIN_EMAIL
fi
if [[ -z "${SUPERADMIN_EMAIL}" ]]; then
  echo "  Fehler: Superadmin-E-Mail-Adresse darf nicht leer sein." >&2
  exit 1
fi

if [[ -z "${SUPERADMIN_PASSWORD:-}" ]]; then
  while true; do
    read -rsp "  Superadmin-Passwort (mind. 8 Zeichen, wird nicht angezeigt): " SUPERADMIN_PASSWORD
    echo
    if [[ ${#SUPERADMIN_PASSWORD} -lt 8 ]]; then
      echo "  Das Passwort muss mindestens 8 Zeichen lang sein — bitte erneut eingeben." >&2
      continue
    fi
    read -rsp "  Superadmin-Passwort (Bestätigung): " SUPERADMIN_PASSWORD_CONFIRM
    echo
    if [[ "${SUPERADMIN_PASSWORD}" != "${SUPERADMIN_PASSWORD_CONFIRM}" ]]; then
      echo "  Die beiden Eingaben stimmen nicht überein — bitte erneut eingeben." >&2
      continue
    fi
    unset SUPERADMIN_PASSWORD_CONFIRM
    break
  done
fi
# Sicherheitsnetz auch für den nicht-interaktiven Pfad (SUPERADMIN_PASSWORD
# per Umgebungsvariable vorgegeben) — die Schleife oben validiert nur den
# interaktiv eingegebenen Fall.
if [[ ${#SUPERADMIN_PASSWORD} -lt 8 ]]; then
  echo "  Fehler: SUPERADMIN_PASSWORD muss mindestens 8 Zeichen lang sein (siehe apps/api/scripts/createSuperAdmin.ts)." >&2
  exit 1
fi
# Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund M1): das
# Passwort wird NICHT als --password=…-Argument übergeben — Argumente
# eines laufenden Prozesses sind auf Linux über /proc/<pid>/cmdline für
# JEDEN lokalen Benutzer lesbar (`ps aux` genügt), für die gesamte, bei
# argon2id nicht ganz kurze Laufzeit von createSuperAdmin.ts. Stattdessen
# als Umgebungsvariable NUR für diesen einen Befehl gesetzt (nicht per
# `export`, das würde sie unnötig für den Rest dieses Skriptlaufs in der
# Prozessumgebung belassen) — createSuperAdmin.ts liest SUPERADMIN_PASSWORD
# bereits selbst vorrangig aus der Umgebung, siehe dort.
if (
  cd apps/api
  SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD}" npm run create-superadmin -- --email="${SUPERADMIN_EMAIL}" --name="${SUPERADMIN_NAME}"
); then
  echo "  Superadmin ${SUPERADMIN_EMAIL} angelegt."
else
  echo "  Hinweis: Anlegen übersprungen/fehlgeschlagen — existiert vermutlich bereits (${SUPERADMIN_EMAIL})."
fi

# --- Schritt 9: Nginx konfigurieren -------------------------------------------
log "Schritt 9: Nginx konfigurieren"
sudo tee /etc/nginx/sites-available/lane1 >/dev/null <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Weboberfläche (PWA) als statische Dateien ausliefern
    root ${REPO_ROOT}/apps/web;
    index index.html;

    # Content-Security-Policy + Sicherheitsheader für das Frontend
    # (Code-Review, Befund S3; Sicherheitsreview 2026-08-29, Befund N2) —
    # siehe docs/deployment-netcup.md, Abschnitt 9 für die ausführliche
    # Begründung (u. a. warum style-src 'unsafe-inline' ein bewusster,
    # dokumentierter Kompromiss ist, und warum HSTS trotz aktuell nur
    # HTTP hier bereits gesetzt wird — certbot in Schritt 10 ergänzt die
    # HTTPS-Weiterleitung in dieser Datei, der Header greift ab dann).
    set \$csp "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";
    set \$hsts "max-age=31536000; includeSubDomains";
    set \$nosniff "nosniff";
    set \$referrer_policy "strict-origin-when-cross-origin";

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Content-Security-Policy \$csp always;
        add_header Strict-Transport-Security \$hsts always;
        add_header X-Content-Type-Options \$nosniff always;
        add_header Referrer-Policy \$referrer_policy always;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
        add_header Content-Security-Policy \$csp always;
        add_header Strict-Transport-Security \$hsts always;
        add_header X-Content-Type-Options \$nosniff always;
        add_header Referrer-Policy \$referrer_policy always;
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
    # diese Routen im Backend ohne /api/-Präfix registriert sind
    # (/auth/login, /auth/register, /auth/refresh, /auth/logout; siehe
    # apps/api/src/modules/auth/auth.route.ts). Ohne diesen Block würde
    # jeder Login-/Registrierungsversuch NICHT ans Backend gehen, sondern
    # von "location /" als unbekannte Route auf die HTML-Startseite
    # umgeleitet (try_files-Fallback).
    location /auth/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Health-Check-Endpunkt für Monitoring/externe Uptime-Checks
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
sudo systemctl reload nginx

log "Fertig bis einschließlich Schritt 9."
# Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund H1): nur noch die
# E-Mail-Adresse, NIE das Passwort — vormals landete ein Klartext-Passwort
# hier im Terminal-Scrollback und in jedem Log, das die Skriptausgabe
# mitschneidet.
echo "Superadmin-Login: ${SUPERADMIN_EMAIL} (Passwort wie eingegeben/vorgegeben — wird hier nicht wiederholt)"
if [[ "$ENV_WAS_CREATED" == "1" ]]; then
  echo "Das erzeugte DB-Passwort (Laufzeitrolle lane1_app) steht in apps/api/.env unter DATABASE_URL."
  echo "Das erzeugte DB-Migrationspasswort (lane1_migrator, nur für künftige 'prisma migrate deploy'-Läufe, siehe Abschnitt 13) steht in apps/api/.env.migrate."
  echo "Das erzeugte JWT-Schlüsselpaar liegt unter apps/api/keys/ (chmod 600/644, referenziert per JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE in apps/api/.env)."
fi
echo "Öffentliche Adresse (noch ohne HTTPS): http://${DOMAIN}"
echo "Weiter geht es manuell mit Schritt 10 (HTTPS mit Let's Encrypt) in docs/deployment-netcup.md:"
echo "  sudo apt install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d ${DOMAIN}"
