#!/usr/bin/env bash
# Automatisiert die Schritte 6–9 aus docs/deployment/deployment-ovhcloud.md
# für einen bereits eingerichteten OVHcloud-VPS.
#
# Ablauf:
#   1. OVHcloud-spezifische Vorprüfungen (dieses Script):
#      - nicht als root, sudo funktioniert,
#      - ufw aktiv mit SSH/80/443 — bei OVHcloud die eigentliche Firewall,
#        weil die vorgelagerte Edge Network Firewall optional, zustandslos
#        und nur für IPv4 ist (Abschnitt 2.2 dort),
#      - der Nginx-Benutzer www-data kommt bis apps/web (Ubuntu 24.04 legt
#        Home-Verzeichnisse mit 750 an, Abschnitt 9.1 dort).
#   2. Abschnitt 6–9 über scripts/setup-netcup.sh — die Schritte sind bei
#      beiden Hostern identisch; SETUP_GUIDE sorgt dafür, dass dessen
#      Meldungen auf die OVHcloud-Anleitung verweisen.
#
# Schritte 1–5 (Bestellung, Benutzer deploy, SSH-Härtung, Edge Network
# Firewall, Domain/DNS) sind Klicks im OVHcloud Control Panel bzw. einmalige
# Handgriffe und nicht Teil dieses Scripts, ebenso Schritt 10+ (certbot,
# Backups, Updates). Das Repository muss bereits im Arbeitsverzeichnis
# liegen (Abschnitt 7), ausgeführt wird als deploy-Benutzer mit sudo-Rechten.
#
# Nutzung (auf dem Server, im geklonten Projektordner):
#   bash scripts/setup-ovhcloud.sh
#
# Abgefragt werden Domain, Superadmin-E-Mail/-Passwort und optional SMTP —
# alles auch per Umgebungsvariable vorgebbar, siehe Kopfkommentar von
# scripts/setup-netcup.sh. Zusätzlich hier:
#   UFW_ENABLE=true|false  ufw ohne Rückfrage einschalten (true) bzw. aus
#                          lassen (false), falls es noch nicht aktiv ist.
#                          Ohne Terminal und ohne Vorgabe bleibt ufw aus
#                          (mit Warnung) — eine Firewall wird nie
#                          unbeaufsichtigt eingeschaltet.
#
# Wiederholt ausführbar: bereits gesetzte ufw-Regeln und Verzeichnisrechte
# werden erkannt und nicht doppelt angelegt.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GUIDE="docs/deployment/deployment-ovhcloud.md"
EXPECTED_ROOT="/home/deploy/lane1"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
warn() { printf '  \033[1;33mWarnung:\033[0m %s\n' "$1" >&2; }

# --- Vorprüfung: Benutzer und sudo ------------------------------------------
log "Vorprüfung: Benutzer und sudo"
if [[ "${EUID}" -eq 0 ]]; then
  echo "Fehler: bitte nicht als root ausführen, sondern als deploy-Benutzer (${GUIDE}, Abschnitt 4.2)." >&2
  echo "PM2 und die Projektdateien gehörten sonst root, und der Autostart liefe als root." >&2
  exit 1
fi
if ! sudo -v; then
  echo "Fehler: $(whoami) hat keine sudo-Rechte (${GUIDE}, Abschnitt 4.2: usermod -aG sudo $(whoami))." >&2
  exit 1
fi
echo "  Benutzer: $(whoami), sudo: ok"

if [[ -r /etc/os-release ]]; then
  # shellcheck source=/dev/null
  OS_ID="$(. /etc/os-release && printf '%s %s' "${ID:-}" "${VERSION_ID:-}")"
  if [[ "$OS_ID" != "ubuntu 24.04" ]]; then
    warn "getestet ist Ubuntu 24.04, gefunden: ${OS_ID}. Weiter auf eigenes Risiko."
  fi
fi

if [[ "$REPO_ROOT" != "$EXPECTED_ROOT" ]]; then
  warn "Projektordner ist ${REPO_ROOT}, die Anleitung geht von ${EXPECTED_ROOT} aus."
  warn "Die Cronjob-Pfade in Abschnitt 12 entsprechend anpassen."
fi

# --- Vorprüfung: ufw ----------------------------------------------------------
# Liefert 0, wenn eine ALLOW-Regel auf eine der übergebenen Bezeichnungen
# passt (Port, Port/tcp oder ufw-Anwendungsprofil).
ufw_allows() {
  local status="$1"; shift
  local name
  for name in "$@"; do
    if grep -Eq "^${name}([[:space:]]+\(v6\))?[[:space:]]+ALLOW" <<<"$status"; then
      return 0
    fi
  done
  return 1
}

log "Vorprüfung: Firewall (ufw)"
if ! command -v ufw >/dev/null 2>&1; then
  sudo apt-get install -y ufw
fi
UFW_STATUS="$(sudo ufw status)"
if grep -q '^Status: active' <<<"$UFW_STATUS"; then
  # Fehlende Freigaben ergänzen — eine zusätzliche ALLOW-Regel kann niemanden
  # aussperren. SSH wird mitgeprüft, falls dieses Script über die
  # KVM-Konsole läuft und SSH bislang gesperrt war.
  ufw_allows "$UFW_STATUS" 'OpenSSH' '22' '22/tcp' || sudo ufw allow OpenSSH
  ufw_allows "$UFW_STATUS" '80' '80/tcp' 'Nginx Full' 'Nginx HTTP' || sudo ufw allow 80/tcp
  ufw_allows "$UFW_STATUS" '443' '443/tcp' 'Nginx Full' 'Nginx HTTPS' || sudo ufw allow 443/tcp
  echo "  ufw ist aktiv, SSH/80/443 sind freigegeben."
else
  if [[ -z "${UFW_ENABLE:-}" ]]; then
    if [[ -t 0 ]]; then
      read -rp "  ufw ist nicht aktiv. Jetzt mit Freigaben für SSH, 80 und 443 einschalten? (J/n): " answer || answer=''
      case "${answer,,}" in
        '' | j | ja | y | yes) UFW_ENABLE=true ;;
        *) UFW_ENABLE=false ;;
      esac
    else
      UFW_ENABLE=false
    fi
  fi
  case "${UFW_ENABLE}" in
    true)
      # SSH zuerst freigeben, erst dann einschalten — sonst trennt `enable`
      # die laufende Sitzung.
      sudo ufw allow OpenSSH
      sudo ufw allow 80/tcp
      sudo ufw allow 443/tcp
      sudo ufw --force enable
      echo "  ufw eingeschaltet."
      ;;
    false)
      warn "ufw bleibt aus. Bei OVHcloud filtert die Edge Network Firewall nur IPv4 und ist optional —"
      warn "ohne ufw ist der Server per IPv6 ungeschützt. Später nachholen: ${GUIDE}, Abschnitt 4.3."
      ;;
    *)
      echo "Fehler: UFW_ENABLE muss \"true\" oder \"false\" sein (ist: \"${UFW_ENABLE}\")." >&2
      exit 1
      ;;
  esac
fi

# --- Vorprüfung: Nginx darf apps/web lesen -----------------------------------
# www-data braucht das Durchgangsrecht (x) auf jedem Verzeichnis bis
# apps/web. Gesetzt wird nur o+x, kein o+r: www-data kann damit Dateien
# unter bekanntem Pfad öffnen, aber nicht auflisten, was sonst im
# Home-Verzeichnis liegt.
log "Vorprüfung: Nginx-Zugriff auf ${REPO_ROOT}/apps/web"
WEB_DIR="${REPO_ROOT}/apps/web"
dir="$WEB_DIR"
while [[ "$dir" != "/" ]]; do
  dir="$(dirname "$dir")"
  mode="$(stat -c '%a' "$dir")"
  if (( (8#${mode} & 1) == 0 )); then
    if [[ -O "$dir" ]]; then
      chmod o+x "$dir"
    else
      sudo chmod o+x "$dir"
    fi
    echo "  Durchgangsrecht für andere gesetzt: ${dir} (vorher ${mode})"
  fi
done
if ! sudo -u www-data test -r "${WEB_DIR}/index.html"; then
  # Ausgecheckt mit restriktiver umask (z. B. 077): die statischen Dateien
  # liefert Nginx ohnehin öffentlich aus, Leserechte für andere sind hier
  # also kein zusätzliches Risiko.
  chmod -R o+rX "$WEB_DIR"
  echo "  Leserechte für andere auf ${WEB_DIR} gesetzt."
fi
if sudo -u www-data test -r "${WEB_DIR}/index.html"; then
  echo "  www-data kann ${WEB_DIR}/index.html lesen."
else
  echo "Fehler: www-data kann ${WEB_DIR}/index.html weiterhin nicht lesen (${GUIDE}, Abschnitt 9.1)." >&2
  exit 1
fi

# --- Abschnitt 6–9 ------------------------------------------------------------
log "Weiter mit Abschnitt 6–9 (gemeinsam mit der netcup-Variante)"
SETUP_GUIDE="$GUIDE" bash "${REPO_ROOT}/scripts/setup-netcup.sh"

log "OVHcloud-spezifische Hinweise"
echo "- Edge Network Firewall (optional): nur mit den Regeln aus ${GUIDE}, Abschnitt 2.2 aktivieren —"
echo "  sie ist zustandslos, ohne \"TCP established\"/DNS-Regel hängen apt, npm, certbot und SMTP."
echo "- AAAA-Record nur setzen, wenn IPv6 funktioniert (curl -6 -I https://www.ovhcloud.com), sonst scheitert certbot."
echo "- Ausgesperrt? Control Panel -> VPS -> KVM-Konsole bzw. Rescue-Modus."
