# shellcheck shell=bash
# Ersten Superadmin anlegen — gemeinsam genutzt von scripts/setup-codespace.sh
# und scripts/setup-netcup.sh (per `source`; letzteres auch über
# scripts/setup-ovhcloud.sh). Erwartet das Repository-Wurzelverzeichnis als
# aktuelles Verzeichnis und einen fertig gebauten apps/api.
#
# superadmin_ensure <email> <name>
#   Fragt das Passwort ab (sofern SUPERADMIN_PASSWORD nicht gesetzt ist) und
#   legt das Konto an. Ein Passwort, das die Regeln des Servers verletzt
#   (mind. 12 Zeichen, nicht aus bekannten Datenlecks), wird bei der Eingabe
#   abgelehnt und neu abgefragt; ein per Umgebungsvariable vorgegebenes
#   bricht das Skript ab. Existiert das Konto (oder ein anderer Superadmin)
#   bereits, wird der Schritt übersprungen.
#
# Das Passwort wird NICHT als --password=…-Argument übergeben — Argumente
# eines laufenden Prozesses sind auf Linux über /proc/<pid>/cmdline für
# JEDEN lokalen Benutzer lesbar (`ps aux` genügt), für die gesamte, bei
# argon2id nicht ganz kurze Laufzeit von createSuperAdmin.ts. Stattdessen
# als Umgebungsvariable NUR für den jeweiligen Befehl gesetzt (nicht per
# `export`, das würde sie unnötig für den Rest des Skriptlaufs in der
# Prozessumgebung belassen).

# Dieselben Regeln wie der Server (apps/api/src/auth/passwordPolicy.ts) —
# die Leak-Liste kennt nur createSuperAdmin.ts. Gibt die Begründung aus und
# liefert 1, wenn das Passwort abgelehnt wird.
superadmin_check_password() {
  (
    cd apps/api
    SUPERADMIN_PASSWORD="$1" npm run --silent create-superadmin -- --check-password
  )
}

superadmin_read_password() {
  local confirm
  while true; do
    read -rsp "  Superadmin-Passwort (mind. 12 Zeichen, wird nicht angezeigt): " SUPERADMIN_PASSWORD
    echo
    if ! superadmin_check_password "${SUPERADMIN_PASSWORD}"; then
      echo "  Bitte ein anderes Passwort eingeben." >&2
      continue
    fi
    read -rsp "  Superadmin-Passwort (Bestätigung): " confirm
    echo
    if [[ "${SUPERADMIN_PASSWORD}" != "${confirm}" ]]; then
      echo "  Die beiden Eingaben stimmen nicht überein — bitte erneut eingeben." >&2
      continue
    fi
    return 0
  done
}

superadmin_ensure() {
  local email="$1" name="$2" status=0
  if [[ -z "${SUPERADMIN_PASSWORD:-}" ]]; then
    superadmin_read_password
  elif ! superadmin_check_password "${SUPERADMIN_PASSWORD}"; then
    echo "  Fehler: SUPERADMIN_PASSWORD wird abgelehnt (siehe oben) — bitte ein anderes Passwort vorgeben." >&2
    return 1
  fi

  (
    cd apps/api
    SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD}" npm run --silent create-superadmin -- --email="${email}" --name="${name}"
  ) || status=$?
  case "$status" in
    0) echo "  Superadmin ${email} angelegt." ;;
    # EXIT_ALREADY_EXISTS in createSuperAdmin.ts; der Grund steht darüber.
    2) echo "  Anlegen übersprungen — siehe Hinweis oben." ;;
    *)
      echo "  Fehler: Superadmin ${email} konnte nicht angelegt werden (siehe Meldung oben)." >&2
      return 1
      ;;
  esac
}
