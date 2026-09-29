# shellcheck shell=bash
# Zwei-Faktor-Anmeldung (Issue #97) in apps/api/.env — gemeinsam genutzt von
# scripts/setup-codespace.sh und scripts/setup-netcup.sh (per `source`).
#
# mfa_ensure_env <env-datei> <standard: true|false>
#   - TOTP_ENCRYPTION_KEY: fehlt er (oder ist leer), wird ein neuer erzeugt.
#     Ein vorhandener Schlüssel wird NIE ersetzt — sonst wären alle
#     eingerichteten TOTP-Secrets und Wiederherstellungscodes unlesbar.
#   - MFA_ENFORCE: fehlt der Wert, wird gefragt, ob die Zwei-Faktor-Anmeldung
#     für Superadmins Pflicht sein soll. Eine vorgegebene Umgebungsvariable
#     MFA_ENFORCE=true|false ersetzt die Frage; ohne Terminal gilt der
#     Standard. Ein vorhandener Wert in der Datei bleibt unverändert.
#
# Bewusst ergänzend statt nur beim ersten Anlegen der Datei: so bekommt auch
# eine bestehende Installation beim erneuten Lauf des Skripts die neuen
# Werte, ohne dass die übrigen Einträge (DB-Passwort, JWT-Schlüssel)
# angefasst werden.

# Für Tests überschreibbar: ob stdin ein Terminal ist.
MFA_STDIN_IS_TTY="${MFA_STDIN_IS_TTY:-}"

# Wandelt eine Antwort in true/false; leer = Standard. Rückgabe 1 bei einer
# ungültigen Antwort.
mfa_parse_answer() {
  local answer="${1,,}" default="$2"
  case "$answer" in
    '') printf '%s' "$default" ;;
    j | ja | y | yes) printf 'true' ;;
    n | nein | no) printf 'false' ;;
    *) return 1 ;;
  esac
}

# Setzt MFA_ENFORCE_CHOICE auf true/false.
mfa_ask_enforce() {
  local default="$1" hint answer parsed
  if [[ -n "${MFA_ENFORCE:-}" ]]; then
    case "${MFA_ENFORCE}" in
      true | false) MFA_ENFORCE_CHOICE="${MFA_ENFORCE}"; return 0 ;;
      *) echo "  Fehler: MFA_ENFORCE muss \"true\" oder \"false\" sein (ist: \"${MFA_ENFORCE}\")." >&2; return 1 ;;
    esac
  fi
  local is_tty="${MFA_STDIN_IS_TTY}"
  if [[ -z "$is_tty" ]]; then
    if [[ -t 0 ]]; then is_tty=1; else is_tty=0; fi
  fi
  if [[ "$is_tty" != 1 ]]; then
    MFA_ENFORCE_CHOICE="$default"
    echo "  Kein Terminal — Zwei-Faktor-Pflicht für Superadmins: ${default} (Standard)."
    return 0
  fi
  if [[ "$default" == true ]]; then hint='J/n'; else hint='j/N'; fi
  while true; do
    read -rp "  Zwei-Faktor-Anmeldung (TOTP) für Superadmins verlangen? (${hint}): " answer || answer=''
    if parsed="$(mfa_parse_answer "$answer" "$default")"; then
      MFA_ENFORCE_CHOICE="$parsed"
      return 0
    fi
    echo "  Bitte mit j (ja) oder n (nein) antworten." >&2
  done
}

# Liefert 0, wenn die Datei einen NICHT leeren Eintrag <name>=... enthält.
mfa_env_has_value() {
  grep -Eq "^${2}=\"?[^\"[:space:]]" "$1"
}

# Setzt <name>=<wert>: ersetzt eine leere Zeile <name>= oder hängt an.
mfa_env_set() {
  local file="$1" name="$2" value="$3"
  if grep -Eq "^${name}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v n="$name" -v v="$value" 'BEGIN { p = n "=" } index($0, p) == 1 { print n "=\"" v "\""; next } { print }' "$file" >"$tmp"
    cat "$tmp" >"$file"
    rm -f "$tmp"
  else
    printf '%s="%s"\n' "$name" "$value" >>"$file"
  fi
}

mfa_ensure_env() {
  local file="$1" default="$2" enforce_missing=0
  # Erst entscheiden (und eine ungültige Vorgabe ablehnen), dann schreiben.
  if ! mfa_env_has_value "$file" MFA_ENFORCE; then
    enforce_missing=1
    mfa_ask_enforce "$default" || return 1
  fi
  if mfa_env_has_value "$file" TOTP_ENCRYPTION_KEY; then
    echo "  TOTP_ENCRYPTION_KEY ist bereits gesetzt — bleibt unverändert."
  else
    if ! grep -Eq '^TOTP_ENCRYPTION_KEY=' "$file"; then
      {
        echo ""
        echo "# Zwei-Faktor-Anmeldung: verschlüsselt die TOTP-Secrets. Nie ändern oder"
        echo "# entfernen, solange Konten TOTP nutzen (siehe apps/api/.env.example)."
      } >>"$file"
    fi
    mfa_env_set "$file" TOTP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
    echo "  TOTP_ENCRYPTION_KEY erzeugt."
  fi
  if [[ "$enforce_missing" == 1 ]]; then
    mfa_env_set "$file" MFA_ENFORCE "$MFA_ENFORCE_CHOICE"
    echo "  MFA_ENFORCE=${MFA_ENFORCE_CHOICE} gespeichert."
  else
    echo "  MFA_ENFORCE ist bereits gesetzt — bleibt unverändert."
  fi
}
