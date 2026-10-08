# Lane 1 auf einem OVHcloud-VPS veröffentlichen — Schritt-für-Schritt-Anleitung

**Für wen ist diese Anleitung?** Für jemanden ohne (oder mit sehr wenig) Erfahrung in Serveradministration. Jeder Schritt wird erklärt — auch *warum* er nötig ist, nicht nur *wie*. Es wird nichts vorausgesetzt außer: ein Computer, eine Internetverbindung und die Bereitschaft, Befehle in ein schwarzes Textfenster ("Terminal") einzutippen.

**Verhältnis zu den anderen Anleitungen:** Diese Anleitung ist die OVHcloud-Variante der Hetzner-Anleitung ([`deployment.md`](./deployment.md)) und der netcup-Anleitung ([`deployment-netcup.md`](./deployment-netcup.md)). Ab Abschnitt 6 (Node.js, PostgreSQL, Nginx, PM2, Let's Encrypt) ist alles identisch — mit einer Ausnahme in Abschnitt 9 (Verzeichnisrechte für Nginx, siehe 9.1). Unterschiede gibt es vor allem bei der Produktwahl, dem vorinstallierten Benutzer `ubuntu` statt `root`, der Firewall (OVHcloud hat keine zustandsbehaftete Cloud-Firewall wie Hetzner/netcup, siehe 2.2) und bei Backups/Monitoring. Die Übersicht in [0.1](#01-unterschiede-zu-hetzner-und-netcup-im-überblick) fasst alles zusammen.

**Basis dieser Anleitung:** der zuvor erstellte `backend-plan.md` (Monorepo mit `apps/web` = Frontend, `apps/api` = Node.js-Backend, JWT-Auth, Sync-API). Diese Anleitung beschreibt die **Veröffentlichung** dieses Monorepos.

---

## 0. Überblick: Was am Ende funktioniert

Am Ende dieser Anleitung ist unter einer eigenen Adresse (z. B. `https://training.mein-schwimmverein.de`) erreichbar:

- die Lane-1-Weboberfläche (installierbar als App, funktioniert offline),
- die dazugehörigen Hilfeseiten unter `/help/` (Kurzanleitung, FAQ, Admin-Handbuch — ebenfalls offline nutzbar),
- das Node.js-Backend darunter, das die Geräte synchronisiert,
- alles verschlüsselt (HTTPS, kostenloses Zertifikat),
- mit automatischen Neustarts, falls der Server einmal neu startet.

### 0.1 Unterschiede zu Hetzner und netcup im Überblick

| Thema | Hetzner ([`deployment.md`](./deployment.md)) | netcup ([`deployment-netcup.md`](./deployment-netcup.md)) | Diese OVHcloud-Variante |
|---|---|---|---|
| Produkt | Cloud CX22 (2 vCPU/4 GB/40 GB) | VPS 1000 (2–4 vCPU/4–8 GB/128–256 GB) | **VPS-1** (4 vCore/8 GB/75 GB) — siehe Abschnitt 1 |
| Standort | Nürnberg/Falkenstein | Nürnberg/Karlsruhe | Frankfurt (DE) oder Gravelines/Straßburg (FR) — Standort bei der Bestellung **aktiv wählen**, die Voreinstellung ist nicht immer ein EU-Rechenzentrum |
| Verwaltungsoberfläche | Cloud Console | CCP (Bestellung) + SCP (Betrieb) | OVHcloud Control Panel → **Bare Metal Cloud → VPS** |
| Erste Anmeldung | `ssh root@…` | `ssh root@…` | **`ssh ubuntu@…`** — `root`-Login ist im OVHcloud-Image bereits gesperrt (Abschnitt 3/4.2) |
| Vorgelagerte Firewall | Cloud Firewall (zustandsbehaftet, IPv4+IPv6) — empfohlen | SCP-Firewall (ab G12) — empfohlen | **Edge Network Firewall** — *zustandslos*, nur IPv4, max. 20 Regeln. **Optional**; `ufw` auf dem Server ist hier die eigentliche Firewall (Abschnitt 2.2) |
| DDoS-Schutz | inklusive | inklusive | inklusive (Anti-DDoS, immer aktiv) |
| SSH-Härtung | `sshd_config` direkt bearbeiten | `sshd_config` direkt bearbeiten | **Drop-in-Datei** unter `sshd_config.d/`, weil cloud-init dort `PasswordAuthentication yes` setzen kann (Abschnitt 4.5) |
| Nginx-Rechte auf `/home/deploy` | nicht beschrieben | nicht beschrieben | `chmod o+x /home/deploy` (Abschnitt 9.1, vom Script automatisch erledigt) |
| Notfallzugang bei Aussperren | Konsole in der Cloud Console | VNC-Konsole im SCP | **KVM-Konsole** und **Rescue-Modus** im Control Panel |
| Snapshots/Backups | Backups ca. 20 % Aufpreis, Snapshots | Snapshots im SCP | Snapshot-/Backup-Option im Control Panel (je nach Angebot inklusive oder kostenpflichtig, Abschnitt 12.2) |
| Offsite-Backup | Hetzner Storage Box | netcup Storage | **OVHcloud Object Storage** (S3-kompatibel) oder beliebig per `rsync` |
| SMTP | Hetzner hat keinen Mailversand; Port 25/465 anfangs gesperrt | netcup-Postfächer | OVHcloud-Postfächer (z. B. MX Plan, `ssl0.ovh.net`); Port 587 offen |
| Monitoring | Cloud Console → Monitoring | SCP → Statistiken | Control Panel → VPS → Graphen + **OVHcloud-Monitoring** (Ping, E-Mail bei Ausfall) |
| Setup-Script | — | `scripts/setup-netcup.sh` | `scripts/setup-ovhcloud.sh` (OVHcloud-Vorprüfungen, danach dieselben Schritte 6–9) |
| Preis (Stand 2026) | ca. 5–6 €/Monat | ca. 5–11 €/Monat | ca. **5–8 €/Monat** (Preise meist **ohne** MwSt. angezeigt) |

### 0.2 Schritte 6–9 automatisiert per Script

Wer die Befehle aus den Abschnitten 6–9 nicht Schritt für Schritt von Hand eintippen möchte, kann stattdessen `scripts/setup-ovhcloud.sh` ausführen:

```bash
bash scripts/setup-ovhcloud.sh
```

Vorausgesetzt sind die Abschnitte 1–5 (Server bestellt, SSH-Zugang als `deploy`-Benutzer, Grundhärtung erledigt, Domain per A-Record bereits auf den Server zeigend — **ohne funktionierendes DNS schlägt Schritt 10 später fehl**) sowie ein bereits im Arbeitsverzeichnis liegendes Repository (Abschnitt 7, Variante A oder B).

Das Script prüft zuerst die OVHcloud-spezifischen Punkte und führt danach dieselben Schritte aus wie `scripts/setup-netcup.sh` (die Abschnitte 6–9 sind bei beiden Hostern identisch):

1. **Vorprüfungen (nur OVHcloud-Script):**
   - läuft nicht als `root` und `sudo` funktioniert,
   - `ufw` ist aktiv und lässt SSH, 80 und 443 durch — ist `ufw` noch aus, bietet das Script an, es mit genau diesen Regeln einzuschalten (SSH wird dabei **vor** dem Einschalten freigegeben). Bei OVHcloud ist das wichtiger als bei Hetzner/netcup, weil die vorgelagerte Edge Network Firewall optional ist und IPv6 gar nicht filtert,
   - Nginx darf das Projektverzeichnis lesen: Ubuntu 24.04 legt Home-Verzeichnisse mit `750` an, der Nginx-Benutzer `www-data` käme dann nicht bis `apps/web` und jede Seite endete mit einem Fehler. Das Script setzt dafür nur das Durchgangsrecht (`o+x`), kein Leserecht auf das Home-Verzeichnis (Abschnitt 9.1).
2. **Abschnitt 6–9** wie in der netcup-Variante: Software installieren, npm-Abhängigkeiten, `apps/api/.env` inkl. JWT-/VAPID-/TOTP-Schlüssel, `prisma migrate deploy`, Backend bauen, PM2 samt Autostart, ersten Superadmin anlegen, Nginx konfigurieren.

Das Script fragt interaktiv nach der **Domain**, der **Superadmin-E-Mail-Adresse und dem -Passwort** (verdeckte Eingabe mit Bestätigung, kein Default-Passwort) und optional nach **SMTP-Zugangsdaten**. Datenbank-Passwörter und Schlüsselpaare werden automatisch erzeugt und landen ausschließlich in `apps/api/.env`, `apps/api/.env.migrate` bzw. `apps/api/keys/` (alle `chmod 600`/`700`). Für einen nicht-interaktiven Lauf lassen sich alle Werte per Umgebungsvariable vorgeben (siehe Kopfkommentar in `scripts/setup-ovhcloud.sh`). Es ist wiederholt ausführbar.

**Bewusst NICHT** Teil des Scripts: Abschnitt 1–5 (Bestellung, Benutzer, SSH-Härtung, Edge Network Firewall, Domain/DNS) und Abschnitt 10+ (HTTPS per certbot, Testen, Backups, Updates, Wartung).

---

## 1. Produktwahl bei OVHcloud

OVHcloud bietet mehrere Server-Linien an: **VPS**, **Public Cloud** (stundengenau abgerechnete Instanzen, OpenStack-basiert) und **Bare Metal/Dedicated Server**. Für dieses Projekt ist ein **VPS** die richtige Wahl — Public Cloud ist für einen einzelnen, dauerhaft laufenden Server komplizierter (Projekte, Security Groups, separate Abrechnung) und meist teurer, Dedicated Server sind deutlich überdimensioniert.

### Empfehlung: **OVHcloud VPS-1**

| Eigenschaft | Wert (Richtwert) |
|---|---|
| vCore | 4 |
| Arbeitsspeicher | 8 GB |
| Festplatte | 75 GB SSD (NVMe) |
| Datenvolumen | unbegrenzt (Bandbreite je nach Standort ca. 400 Mbit/s) |
| Preis (Stand 2026) | ca. **5–8 €/Monat**, abhängig von Standort und Vertragslaufzeit (Angaben im Shop meist **ohne** MwSt.) |
| Standort | **Frankfurt** (Deutschland) oder Gravelines/Straßburg (Frankreich) — Daten bleiben in der EU |
| Betriebssystem | **Ubuntu 24.04** |

**Warum genau dieses Produkt?**
- Der kleinste OVHcloud-VPS hat bereits mehr Reserve als die Hetzner-/netcup-Empfehlung (4 vCore/8 GB statt 2 vCPU/4 GB) — für einen Verein mit einigen Dutzend bis wenigen hundert Nutzer:innen mehr als ausreichend.
- Anti-DDoS-Schutz und unbegrenzter Traffic sind inklusive.
- OVHcloud ist ein europäisches Unternehmen mit Rechenzentren in Deutschland und Frankreich — das vereinfacht die DSGVO-Betrachtung (Backend-Plan, Abschnitt 12). **Der Standort muss bei der Bestellung aber aktiv gewählt werden** (siehe Schritt 2): OVHcloud betreibt auch Rechenzentren außerhalb der EU (z. B. Kanada, USA, Singapur), und manche Standorte kosten einen Aufpreis.

> **Hinweis:** OVHcloud benennt und bepreist seine VPS-Produkte immer wieder um. Schau im Zweifel direkt im [OVHcloud-Shop](https://www.ovhcloud.com/de/vps/) nach dem aktuell kleinsten VPS mit mindestens 2 vCore/4 GB RAM — die genaue Bezeichnung kann abweichen, die Empfehlung bleibt dieselbe.

Reicht der Server später nicht mehr aus, lässt er sich im Control Panel auf ein größeres VPS-Modell hochstufen, ohne ihn neu aufzusetzen. (Ein **Herabstufen** ist bei OVHcloud-VPS in der Regel nicht möglich — daher klein anfangen.)

---

## 2. OVHcloud-Konto und Server anlegen

1. Auf **[ovhcloud.com](https://www.ovhcloud.com/de/)** ein Kundenkonto erstellen (E-Mail bestätigen, Zahlungsmethode hinterlegen). OVHcloud verlangt bei neuen Konten gelegentlich eine **Identitätsprüfung** (Ausweis-Upload), bevor die erste Bestellung freigeschaltet wird — das kann einige Stunden bis zu einem Werktag dauern. Für einen Verein ggf. direkt ein Konto auf den Verein (mit Vereinsdaten/USt-ID, falls vorhanden) anlegen, damit Rechnungen auf den Verein laufen.
2. Den gewünschten VPS bestellen:
   - **Modell:** VPS-1 (siehe oben)
   - **Standort:** **Frankfurt** (oder Gravelines/Straßburg) — nicht einfach die Voreinstellung übernehmen
   - **Image (Betriebssystem):** Ubuntu 24.04 (ohne vorinstallierte Anwendung/„Distribution only")
   - **SSH-Key:** siehe Schritt 2.1 — bereits bei der Bestellung hinterlegen. Ohne Key schickt OVHcloud ein Passwort für den Benutzer `ubuntu` per E-Mail; das funktioniert zwar, sollte aber gleich in Schritt 4 durch einen Key ersetzt werden
   - **Laufzeit:** monatlich kündbar oder mit Mindestlaufzeit (günstiger) — für den Start reicht monatlich
3. Nach der Bereitstellung (meist wenige Minuten, bei neuen Konten nach der Identitätsprüfung) erscheint der Server im **OVHcloud Control Panel** unter **Bare Metal Cloud → Virtual Private Servers**. Dort stehen die öffentliche **IPv4-Adresse** (merken/kopieren, wird ständig gebraucht) und die **IPv6-Adresse**. Zusätzlich kommt eine E-Mail mit den Zugangsdaten.

### 2.1 SSH-Key erzeugen (einmalig, auf dem eigenen Computer)

Ein SSH-Key ist ein Schlüsselpaar, mit dem man sich sicherer und bequemer anmeldet als mit einem Passwort.

**Mac/Linux** (Terminal-App öffnen):
```bash
ssh-keygen -t ed25519 -C "lane1-server"
```
Dreimal Enter drücken (Standardpfad, kein zusätzliches Passwort nötig für den Einstieg). Danach den öffentlichen Schlüssel anzeigen und kopieren:
```bash
cat ~/.ssh/id_ed25519.pub
```

**Windows** (PowerShell öffnen, ab Windows 10 ist `ssh` vorinstalliert):
```powershell
ssh-keygen -t ed25519 -C "lane1-server"
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Den angezeigten Text (beginnt mit `ssh-ed25519 …`) bei der Bestellung im Feld **„SSH-Schlüssel"** einfügen. Alternativ lässt er sich im Control Panel unter **Konto → Meine Dienste/Einstellungen → SSH-Schlüssel** hinterlegen. Wurde der Server bereits ohne Key bestellt: einmal per Passwort (aus der E-Mail) als `ubuntu` anmelden und den Key mit `ssh-copy-id ubuntu@DEINE-SERVER-IP` (Mac/Linux) übertragen — oder den VPS im Control Panel mit Key **neu installieren** (löscht alles, vor Schritt 6 aber unproblematisch).

### 2.2 Firewall — Unterschied zu Hetzner/netcup

Bei Hetzner und netcup gibt es eine **zustandsbehaftete** Cloud-Firewall: man erlaubt eingehend 22/80/443, und Antworten auf ausgehende Verbindungen (z. B. `apt update`, `npm install`, certbot) kommen automatisch durch. OVHcloud bietet stattdessen die **Edge Network Firewall**, die anders funktioniert:

- **zustandslos**: sie kennt keine „Antwort auf eine eigene Anfrage" — ohne eine ausdrückliche Regel für bereits aufgebaute TCP-Verbindungen und für DNS-/NTP-Antworten bricht jede ausgehende Verbindung des Servers ab (Paketinstallation, npm, certbot, E-Mail-Versand),
- filtert **nur IPv4**, IPv6 läuft ungefiltert daran vorbei,
- maximal **20 Regeln** je IP-Adresse.

**Empfehlung für diese Anleitung:** `ufw` auf dem Server (Schritt 4.3) ist bei OVHcloud die **eigentliche** Firewall und **Pflicht**. Die Edge Network Firewall ist eine **optionale** zusätzliche Schicht — wer sie nutzt, muss die Regeln exakt so anlegen wie unten, sonst sperrt man den Server von der Außenwelt ab. Für den Einstieg kann man sie auch weglassen und später ergänzen.

**Optional: Edge Network Firewall einrichten** — Control Panel → **Bare Metal Cloud → Network → Public IP Addresses** → bei der IPv4-Adresse des VPS auf **„…" → „Configure the Edge Network Firewall"** (bzw. „Firewall erstellen", dann „Konfigurieren"). Regeln in dieser Reihenfolge anlegen (niedrigere Priorität = wird zuerst geprüft):

| Priorität | Aktion | Protokoll | Weitere Angabe | Zweck |
|---|---|---|---|---|
| 0 | Erlauben | TCP | Option **„established"** | Antworten auf ausgehende Verbindungen (apt, npm, certbot, SMTP) |
| 1 | Erlauben | UDP | **Quellport** 53 | DNS-Antworten |
| 2 | Erlauben | UDP | **Quellport** 123 | Zeitsynchronisation (NTP) — sonst läuft die Uhr weg und TLS/TOTP-Codes schlagen fehl |
| 3 | Erlauben | ICMP | — | Ping (u. a. für das OVHcloud-Monitoring, Abschnitt 14) |
| 4 | Erlauben | TCP | Zielport 22 | SSH |
| 5 | Erlauben | TCP | Zielport 80 | HTTP (certbot, Weiterleitung auf HTTPS) |
| 6 | Erlauben | TCP | Zielport 443 | HTTPS |
| 19 | Ablehnen | IPv4 | — | alles andere |

Danach die Firewall **aktivieren** (Schalter in derselben Ansicht). Änderungen brauchen ein paar Minuten, bis sie greifen. Anschließend auf dem Server prüfen, dass ausgehende Verbindungen weiterhin funktionieren: `sudo apt update` und `curl -I https://deb.nodesource.com` müssen ohne Zeitüberschreitung antworten.

> **Ausgesperrt?** Bei OVHcloud kommt man über das Control Panel → VPS → **„KVM"** (Konsole im Browser) immer noch an den Server, auch wenn Firewall oder SSH falsch konfiguriert sind. Notfalls hilft der **Rescue-Modus** (VPS startet ein Rettungssystem, die eigene Festplatte lässt sich darin einhängen und reparieren). Bei der Edge Network Firewall genügt es, sie im Control Panel wieder zu deaktivieren.

---

## 3. Erste Verbindung zum Server

Terminal (Mac/Linux) bzw. PowerShell (Windows) öffnen:

```bash
ssh ubuntu@DEINE-SERVER-IP
```

**Anders als bei Hetzner/netcup** heißt der vorinstallierte Benutzer `ubuntu`, nicht `root` — eine direkte Anmeldung als `root` ist im OVHcloud-Ubuntu-Image bereits gesperrt. `ubuntu` hat `sudo`-Rechte; Befehle mit Systemrechten daher mit vorangestelltem `sudo` ausführen.

Beim ersten Verbinden erscheint eine Sicherheitsabfrage ("authenticity of host … can't be established"). Das ist normal beim allerersten Kontakt — mit `yes` bestätigen.

---

## 4. Server absichern (Grundhärtung)

Alle folgenden Befehle **auf dem Server** eingeben (also innerhalb der SSH-Verbindung von Schritt 3).

### 4.1 System aktualisieren
```bash
sudo apt update && sudo apt upgrade -y
```
Fragt `apt` während des Upgrades, ob eine geänderte Konfigurationsdatei (z. B. `sshd_config`) ersetzt werden soll, die vorgeschlagene Standardantwort (aktuelle Version behalten) übernehmen. Wird ein Neustart verlangt (`/var/run/reboot-required` existiert), mit `sudo reboot` neu starten und nach einer Minute wieder verbinden.

### 4.2 Eigenen Benutzer `deploy` anlegen
Technisch ließe sich alles als `ubuntu` erledigen. Diese Anleitung (und alle Pfade in Cronjobs, Nginx-Konfiguration und `.env`) geht aber — wie die Hetzner- und netcup-Variante — von einem Benutzer `deploy` mit Projektordner `/home/deploy/lane1` aus. Deshalb:
```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo rsync --archive --chown=deploy:deploy /home/ubuntu/.ssh /home/deploy
```
Der letzte Befehl kopiert den SSH-Key des Benutzers `ubuntu` auch für `deploy` (anders als bei Hetzner/netcup liegt der Key hier nicht unter `/root/.ssh`, sondern unter `/home/ubuntu/.ssh`).

Ab jetzt: neues Terminal-Fenster öffnen und testen:
```bash
ssh deploy@DEINE-SERVER-IP
sudo whoami     # muss "root" ausgeben (Passwort von deploy eingeben)
```
Klappt das, kann das `ubuntu`-Fenster geschlossen werden — ab hier alles als `deploy` ausführen.

**Empfohlen:** den nicht mehr benötigten Benutzer `ubuntu` sperren (er hat denselben SSH-Key und volle `sudo`-Rechte ohne Passwortabfrage — ein zweiter, unbeobachteter Zugang):
```bash
sudo usermod --lock --expiredate 1 ubuntu
```
Das sperrt sowohl Passwort- als auch SSH-Key-Anmeldung, ohne den Benutzer zu löschen (rückgängig mit `sudo usermod --unlock --expiredate '' ubuntu`). **Erst ausführen, nachdem `ssh deploy@…` und `sudo` als `deploy` nachweislich funktionieren.**

### 4.3 Firewall auf Betriebssystemebene (bei OVHcloud Pflicht, siehe 2.2)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```
Mit `y` bestätigen. `ufw` filtert IPv4 **und** IPv6 (Standard in Ubuntu) und ist zustandsbehaftet — ausgehende Verbindungen funktionieren ohne Zusatzregeln. `scripts/setup-ovhcloud.sh` prüft diese Regeln und bietet an, `ufw` einzuschalten, falls es noch aus ist.

### 4.4 Schutz gegen automatisierte Anmeldeversuche
```bash
sudo apt install fail2ban -y
```
Läuft mit sinnvollen Standardeinstellungen sofort im Hintergrund.

### 4.5 (Empfohlen) Passwort-Login und root-Login per SSH deaktivieren

**Unterschied zu Hetzner/netcup:** Das OVHcloud-Image richtet den Server per *cloud-init* ein, und cloud-init legt — vor allem, wenn der Server ohne SSH-Key bestellt wurde — eine Datei `/etc/ssh/sshd_config.d/50-cloud-init.conf` mit `PasswordAuthentication yes` an. SSH übernimmt bei doppelten Einstellungen den **zuerst gelesenen** Wert, und die Dateien in `sshd_config.d/` werden **vor** dem Rest von `/etc/ssh/sshd_config` gelesen. Ein Ändern von `/etc/ssh/sshd_config` (wie in der Hetzner-/netcup-Anleitung) hätte dann **keine Wirkung**. Stattdessen eine eigene Datei anlegen, die alphabetisch vor `50-cloud-init.conf` liegt:
```bash
sudo tee /etc/ssh/sshd_config.d/00-lane1.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl restart ssh
```
Prüfen, welche Werte SSH tatsächlich verwendet:
```bash
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication)'
```
Alle drei müssen `no` zeigen.

**Wichtig:** Vorher unbedingt bestätigen, dass die Anmeldung als `deploy` mit SSH-Key funktioniert (Schritt 4.2) — sonst sperrt man sich aus. (Notfalls hilft die KVM-Konsole, siehe Hinweis in 2.2 — für die KVM-Konsole braucht `deploy` ein Passwort, das in 4.2 per `adduser` vergeben wurde.)

---

## 5. Domain einrichten

1. Eine Domain registrieren (falls noch nicht vorhanden), z. B. direkt bei OVHcloud (**Web Cloud → Domainnamen**) oder einem beliebigen anderen Registrar.
2. Beim DNS-Verwalter der Domain (bei OVHcloud: **Web Cloud → Domainnamen → *Domain* → „DNS-Zone" → „Eintrag hinzufügen"**) einen **A-Record** anlegen:
   - Subdomain: `training` (ergibt `training.mein-verein.de`) oder leer für die Hauptdomain
   - Ziel: die öffentliche **IPv4**-Adresse des Servers aus Schritt 2
   - TTL: Standardwert belassen
   - Gibt es für denselben Namen bereits einen A-Record (OVHcloud legt bei neuen Domains Standardeinträge auf eigene Parkseiten an), diesen **ändern statt einen zweiten anzulegen** — sonst landen Besucher:innen und certbot zufällig mal auf dem einen, mal auf dem anderen Ziel.
3. **IPv6 (optional):** Zusätzlich einen **AAAA-Record** mit der IPv6-Adresse aus Schritt 2 nur dann anlegen, wenn IPv6 auf dem Server nachweislich funktioniert (`curl -6 -I https://www.ovhcloud.com` auf dem Server liefert eine Antwort). Ein AAAA-Record auf eine nicht erreichbare IPv6-Adresse lässt Let's Encrypt in Schritt 10 scheitern (es prüft bevorzugt per IPv6).
4. DNS-Änderungen brauchen etwas Zeit (meist Minuten, bei OVHcloud-DNS-Zonen gelegentlich bis zu einer Stunde). Prüfen mit:
   ```bash
   ping training.mein-verein.de
   ```
   Antwortet die IP des Servers, ist alles bereit für Schritt 10 (HTTPS).

> **Optional — Reverse-DNS:** Im Control Panel lässt sich für die IP-Adresse ein Reverse-DNS-Eintrag (`training.mein-verein.de`) setzen (Network → Public IP Addresses → „…" → „Reverse-DNS ändern"). Für Lane 1 nicht nötig, da E-Mails über einen externen SMTP-Server laufen (Schritt 7.2), aber hilfreich, um den Server in Logs wiederzuerkennen.

---

## 6. Benötigte Software installieren

### 6.1 Node.js (über NodeSource, liefert eine aktuelle LTS-Version)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```
Sollte `v22.x` anzeigen.

### 6.2 PostgreSQL (Datenbank für das Backend)
```bash
sudo apt install -y postgresql
sudo -u postgres psql
```
Innerhalb der PostgreSQL-Konsole (Prompt `postgres=#`) — **zwei** Rollen
statt einer (Sicherheitsreview 2026-08-28, Befund N1): `lane1_migrator`
wendet ausschließlich das Datenbankschema an (`prisma migrate deploy`,
braucht dafür DDL-Rechte — Tabellen anlegen/ändern), `lane1_app` ist die
Rolle, mit der die Anwendung selbst zur Laufzeit läuft (`DATABASE_URL` in
`.env`, Schritt 7.2) und bekommt bewusst NUR Lese-/Schreibrechte auf
Zeilenebene, keine DDL-Rechte. Ein zur Laufzeit erlangter Datenbankzugriff
(z. B. über eine künftige SQL-Injection-Lücke oder ein kompromittiertes
`DATABASE_URL`) kann dadurch keine Tabellen mehr anlegen, ändern oder
löschen:
```sql
CREATE DATABASE lane1;

CREATE USER lane1_migrator WITH ENCRYPTED PASSWORD 'EIN-SICHERES-MIGRATIONS-PASSWORT-HIER';
GRANT ALL PRIVILEGES ON DATABASE lane1 TO lane1_migrator;

CREATE USER lane1_app WITH ENCRYPTED PASSWORD 'EIN-SICHERES-PASSWORT-HIER';
GRANT CONNECT ON DATABASE lane1 TO lane1_app;

\c lane1
GRANT ALL ON SCHEMA public TO lane1_migrator;
GRANT USAGE ON SCHEMA public TO lane1_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lane1_app;
-- Sorgt dafür, dass auch von KÜNFTIGEN Migrationen neu angelegte Tabellen
-- automatisch dieselben Rechte für lane1_app tragen, ohne nach jeder
-- Migration erneut manuell GRANTen zu müssen.
ALTER DEFAULT PRIVILEGES FOR ROLE lane1_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lane1_app;
\q
```
**Beide Passwörter notieren** — `lane1_app` wird gleich in der
`.env`-Datei gebraucht (Schritt 7.2), `lane1_migrator` bei jedem
`prisma migrate deploy` (Schritt 7.3 unten sowie beim späteren
Aktualisieren, Abschnitt 11).

> **Wichtig (PostgreSQL 15+, damit auch Ubuntu 24.04/PostgreSQL 16):** Seit
> PostgreSQL 15 hat nur noch der Datenbank-Eigentümer automatisch das Recht,
> im Schema `public` Tabellen anzulegen — `GRANT ALL PRIVILEGES ON DATABASE`
> allein reicht dafür **nicht** mehr. Ohne das zusätzliche `\c lane1` +
> `GRANT ALL ON SCHEMA public` oben bricht Schritt 7.3
> (`prisma migrate deploy`) mit `permission denied for schema public` ab.

### 6.3 Nginx (liefert die Weboberfläche aus und leitet API-Anfragen weiter)
```bash
sudo apt install -y nginx
```

### 6.4 PM2 (hält das Node.js-Backend dauerhaft am Laufen)
```bash
sudo npm install -g pm2
```

### 6.5 Git
```bash
sudo apt install -y git
```

---

## 7. Projekt auf den Server bringen

### Variante A — mit Git-Repository (empfohlen, falls das Projekt z. B. auf GitHub liegt)
```bash
cd /home/deploy
git clone https://github.com/DEIN-VEREIN/lane1.git
cd lane1
```

### Variante B — ohne Git, per Datei-Upload (z. B. das bisher gelieferte ZIP-Archiv)
Vom **eigenen Computer** aus (nicht auf dem Server):
```bash
scp lane1-schwimmteam-pwa.zip deploy@DEINE-SERVER-IP:/home/deploy/
```
Dann auf dem Server:
```bash
cd /home/deploy
sudo apt install -y unzip
unzip lane1-schwimmteam-pwa.zip -d lane1
cd lane1
```

### 7.1 Monorepo-Abhängigkeiten installieren
Sobald das Backend gemäß Plan als `apps/api` (plus `packages/*`) existiert:
```bash
npm install
```
Führt npm dank der Workspace-Konfiguration für alle Pakete (`apps/web`, `apps/api`, `packages/*`) in einem Rutsch aus.

> **Stand heute:** Nur `apps/web` (die fertige PWA) existiert bereits. Ohne Backend lässt sich Schritt 7–9 trotzdem durchführen — einfach die Backend-spezifischen Teile (7.2–7.4) vorerst überspringen und direkt mit Schritt 9 (Nginx fürs Frontend) fortfahren.

### 7.2 Umgebungsvariablen konfigurieren (`.env`)
```bash
cp apps/api/.env.example apps/api/.env
chmod 600 apps/api/.env
nano apps/api/.env
```
Das `chmod 600` ist **Pflicht, nicht optional**: `apps/api/.env` enthält
gleich zwei kritische Geheimnisse — das Datenbank-Passwort und, sobald
unten gesetzt, `JWT_PRIVATE_KEY` (signiert sämtliche Access Tokens).
Ohne diesen Schritt entsteht die Datei mit den systemweiten
Standardrechten (üblich `644`, also weltlesbar) — jedes andere lokale
Benutzerkonto auf diesem Server könnte den privaten Schlüssel lesen und
sich damit ein Access Token mit beliebiger Rolle (auch `superadmin`)
selbst signieren, ohne dass ein Login, ein Rate-Limit oder ein Logeintrag
das sichtbar machen würde (`app.authenticate` prüft ausschließlich die
Signatur, nie die Datenbank — siehe `apps/api/src/plugins/authenticate.ts`).
Analog zu `chmod 600 ~/.pgpass` in Abschnitt 12.1 unten, dort für dasselbe
Datenbank-Passwort.

`apps/api/.env.example` enthält bereits alle bekannten Variablen mit
Erklärung (vollständiges, verbindliches Schema samt Validierung:
`apps/api/src/config/env.ts` — ein fehlender/ungültiger Pflichtwert lässt
den Server beim Start sofort mit einer klaren Fehlermeldung abbrechen).
Für einen Produktivserver mindestens folgende Werte setzen bzw. anpassen:
```
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://lane1_app:EIN-SICHERES-PASSWORT-HIER@localhost:5432/lane1"
# WICHTIG (Sicherheitsreview 2026-08-28, Befund N1): bewusst die
# DML-only-Rolle `lane1_app`, NICHT `lane1_migrator` (siehe Schritt 6.2)
# — dies sind die Zugangsdaten, mit denen die Anwendung dauerhaft läuft.
# `lane1_migrator` gehört NICHT in diese Datei, siehe Schritt 7.3.
JWT_PRIVATE_KEY_FILE="<mit openssl erzeugen, siehe unten>"
JWT_PUBLIC_KEY_FILE="<mit openssl erzeugen, siehe unten>"
CORS_ORIGIN="https://training.mein-verein.de"
FRONTEND_BASE_URL="https://training.mein-verein.de"

# Sicherheitsreview 2026-08-27, Befund H1 — Nginx (Abschnitt 9 unten)
# läuft auf demselben Host und ist der einzige tatsächliche
# Reverse-Proxy-Hop; PFLICHT bei NODE_ENV=production.
TRUSTED_PROXY_IPS="127.0.0.1"

# SMTP — nötig, damit Einladungs-E-Mails (Vereins-/Nutzerverwaltung,
# siehe apps/web/help/admin.html) tatsächlich zugestellt werden. Bleibt
# SMTP_HOST leer, wird die Einladung nur ins Server-Log geschrieben statt
# per E-Mail versendet — für einen Produktivbetrieb SMTP_HOST daher setzen.
SMTP_HOST="smtp.beispiel-anbieter.de"
SMTP_PORT=587
SMTP_USER="postversand@mein-verein.de"
SMTP_PASSWORD="EIN-SICHERES-SMTP-PASSWORT-HIER"
SMTP_FROM_EMAIL="postversand@mein-verein.de"
SMTP_FROM_NAME="Lane 1"

# Web-Push (Phase 2, Abschnitt 1.2) — siehe "VAPID-Schlüsselpaar erzeugen"
# weiter unten. Optional: bleiben beide leer, protokolliert der Server
# Push-Versuche nur, statt sie zu versenden (kein Startabbruch).
VAPID_PUBLIC_KEY="<mit npx web-push generate-vapid-keys erzeugen, siehe unten>"
VAPID_PRIVATE_KEY="<mit npx web-push generate-vapid-keys erzeugen, siehe unten>"
VAPID_SUBJECT="mailto:postversand@mein-verein.de"
```
**RS256-Schlüsselpaar erzeugen** (signiert die Zugriffs-Tokens; in
Produktion PFLICHT — ohne einen konfigurierten Schlüssel bricht der
Serverstart mit `NODE_ENV=production` sofort ab).

**Empfohlen** (Sicherheitsreview 2026-08-28, Befund H2, Empfehlung 3):
das Schlüsselpaar direkt an seinem endgültigen Ort erzeugen, statt es
über eine `.env`-Zeile zu leiten — die Schlüsseldatei trägt dadurch
eigene, engere Dateirechte (`600`, nur das Dienstkonto), unabhängig von
der übrigen `.env` (die u. a. auch das Datenbank-Passwort enthält):
```bash
mkdir -p apps/api/keys
chmod 700 apps/api/keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out apps/api/keys/jwt_private.pem
openssl pkey -in apps/api/keys/jwt_private.pem -pubout -out apps/api/keys/jwt_public.pem
chmod 600 apps/api/keys/jwt_private.pem
chmod 644 apps/api/keys/jwt_public.pem
```
In der `.env` dann nur den Pfad eintragen (absolute Pfade sind robuster
gegen einen vom PM2-Start abweichenden Arbeitsordner):
```
JWT_PRIVATE_KEY_FILE="/home/deploy/lane1/apps/api/keys/jwt_private.pem"
JWT_PUBLIC_KEY_FILE="/home/deploy/lane1/apps/api/keys/jwt_public.pem"
```
`apps/api/keys/` ist per `.gitignore` bereits ausgeschlossen — dieser
Ordner darf wie `.env` niemals committet werden.

**Alternative** (falls eine separate Schlüsseldatei im jeweiligen Setup
nicht praktikabel ist, z. B. bei einer rein umgebungsvariablenbasierten
Konfiguration/einem Secrets-Manager, der nur Variablen injiziert): den
PEM-Inhalt direkt als `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in die `.env`
schreiben, mit literalen `\n` statt echter Zeilenumbrüche:
```bash
awk 'BEGIN{ORS="\\n"} {print}' apps/api/keys/jwt_private.pem
awk 'BEGIN{ORS="\\n"} {print}' apps/api/keys/jwt_public.pem
```
Jede Ausgabe komplett kopieren und als Wert von `JWT_PRIVATE_KEY` bzw.
`JWT_PUBLIC_KEY` in Anführungszeichen einsetzen (z. B.
`JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"`),
und **nur in diesem Fall** anschließend `apps/api/keys/` wieder löschen
(`rm -rf apps/api/keys`) — sonst liegt derselbe private Schlüssel
doppelt vor, einmal in der Datei und einmal inline in der `.env`. Je
Schlüssel darf **nur eine** der beiden Formen gesetzt sein
(`JWT_PRIVATE_KEY` **oder** `JWT_PRIVATE_KEY_FILE`, nie beide — `env.ts`
lehnt eine gleichzeitige Angabe sonst mit einer klaren Fehlermeldung ab).

> **Hinweis TRUSTED_PROXY_IPS:** benennt die Adresse(n), denen die API den
> Header `X-Forwarded-For` überhaupt glaubt (Fastifys `trustProxy`-Option)
> — bei diesem Aufbau ausschließlich `127.0.0.1`, da Nginx auf demselben
> Server läuft und die API nur über die Loopback-Adresse anspricht (siehe
> Abschnitt 9). Dieser Wert ist die einzige Verteidigung gegen einen
> Client, der selbst einen `X-Forwarded-For`-Header mitschickt, um Rate-
> Limits zu umgehen — `trustProxy: true` (jede Adresse vertrauenswürdig)
> wäre hier ein Sicherheitsproblem, kein Bind auf `trustProxy` (also gar
> keine Proxy-Adresse eingetragen) ein anderes (alle Clients teilen sich
> dasselbe Rate-Limit-Budget, da `request.ip` dann immer die
> Nginx-Adresse ist). `env.ts` erzwingt deshalb einen gesetzten Wert,
> sobald `NODE_ENV=production` ist.
>
> **Hinweis SMTP_SECURE:** `SMTP_SECURE=false` (Port 587/STARTTLS) oder
> `SMTP_SECURE=true` (Port 465/implizites TLS) explizit setzen — beide
> werden korrekt ausgewertet. Bleibt die Zeile ganz weg, gilt ebenfalls
> `false` (Standardwert).
>
> **Hinweis SMTP-Anbieter:** Für die Zugangsdaten reicht in der Regel das
> E-Mail-Postfach des Vereins bzw. ein von dessen Hoster bereitgestelltes
> SMTP-Konto. Wird die Domain bei OVHcloud verwaltet, eignet sich ein
> OVHcloud-Postfach (z. B. aus dem kostenlosen „MX Plan" einer Domain oder
> „Email Pro"): `SMTP_HOST="ssl0.ovh.net"`, `SMTP_PORT=587`,
> `SMTP_SECURE=false`, `SMTP_USER` = vollständige E-Mail-Adresse. Anders
> als bei Hetzner ist ausgehender Mailverkehr vom VPS nicht pauschal
> gesperrt; OVHcloud überwacht aber Port 25 auf Spam und sperrt die IP bei
> Auffälligkeiten — Lane 1 versendet ohnehin nur über Port 587 an einen
> externen SMTP-Server, das ist davon nicht betroffen. Wer die Edge Network
> Firewall nutzt (Schritt 2.2), braucht dafür die Regel „TCP established"
> (Priorität 0), sonst laufen SMTP-Verbindungen in eine Zeitüberschreitung.

**VAPID-Schlüsselpaar erzeugen** (Phase 2, Abschnitt 1.2 —
Push-Benachrichtigungen; **optional**, kein Startabbruch ohne). Anders
als das JWT-Schlüsselpaar oben ist der private VAPID-Schlüssel kein
Geheimnis auf demselben Schutzniveau — er landet direkt als Wert in der
`.env` (die ohnehin `chmod 600` bekommt, siehe unten), keine eigene
Schlüsseldatei nötig. `web-push` ist bereits eine Abhängigkeit von
`apps/api` (`npm install` in Schritt 7.1 hat es mitinstalliert):
```bash
cd apps/api && npx web-push generate-vapid-keys
```
Liefert zwei Zeilen `Public Key:`/`Private Key:` — als
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` oben eintragen. `VAPID_SUBJECT`
ist laut VAPID-Spezifikation ein `mailto:`- oder `https://`-Kontakt, an
den sich ein Push-Dienst im Missbrauchsfall wenden kann — die eigene
`SMTP_FROM_EMAIL`-Adresse genügt. Ohne diese drei Werte bleibt „Push-
Benachrichtigungen aktivieren" (Mein Profil) in der Oberfläche zwar
sichtbar, der Server protokolliert Versandversuche dann aber nur, statt
sie tatsächlich zuzustellen (`ConsolePushSender`, siehe
`apps/api/src/push/pusher.console.ts`).

**Zwei-Faktor-Anmeldung (TOTP).** `TOTP_ENCRYPTION_KEY` verschlüsselt die
TOTP-Secrets in der Datenbank, `MFA_ENFORCE` legt fest, ob die
Zwei-Faktor-Anmeldung für Superadmins Pflicht ist:
```bash
echo "TOTP_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"" >> apps/api/.env
echo 'MFA_ENFORCE=true' >> apps/api/.env
```
Für diese Anleitung ist `MFA_ENFORCE=true` der empfohlene Wert (auch der
Standard, wenn die Zeile fehlt): jedes Superadmin-Konto muss dann eine
Authenticator-App einrichten, Vereine können dasselbe für ihre Admins
verlangen.
Mit `NODE_ENV=production` und aktiver Pflicht startet der Server ohne
`TOTP_ENCRYPTION_KEY` nicht. Den Schlüssel **nie ändern oder löschen**,
solange Konten TOTP nutzen — ihre Codes und Wiederherstellungscodes wären
sonst ungültig.

`scripts/setup-ovhcloud.sh` erledigt beides: es erzeugt den Schlüssel und
fragt nach der Pflicht (Standard: ja; vorgeben mit `MFA_ENFORCE=true` bzw.
`false`). Vorhandene Werte bleiben bei einem erneuten Lauf unverändert.

### 7.3 Datenbank-Schema anlegen
`DATABASE_URL` wird hier bewusst **überschrieben** (Sicherheitsreview
2026-08-28, Befund N1): `apps/api/.env` enthält die DML-only-Rolle
`lane1_app` (Schritt 7.2), Schema-Änderungen brauchen aber die DDL-Rolle
`lane1_migrator` (Schritt 6.2) — die vorangestellte Umgebungsvariable
gilt nur für genau diesen einen Befehl, ohne `.env` selbst anzufassen
(Prismas eigenes `.env`-Laden überschreibt eine bereits gesetzte
Umgebungsvariable nicht):
```bash
cd apps/api
DATABASE_URL="postgresql://lane1_migrator:EIN-SICHERES-MIGRATIONS-PASSWORT-HIER@localhost:5432/lane1" npx prisma migrate deploy
cd ../..
```
> **Warum `migrate deploy` statt `db push`?** `apps/api/prisma/migrations/`
> enthält eine committete, reviewbare Migrationshistorie (Code-Review,
> Befund W5) — `migrate deploy` wendet genau diese Dateien nicht-
> interaktiv an, ohne Rückfrage bei potenziell datenverlierenden
> Änderungen, und bricht mit einer klaren Fehlermeldung ab, falls die
> Historie nicht zur aktuellen `schema.prisma` passt, statt Abweichungen
> stillschweigend zu übernehmen. `prisma db push` (erzeugt das Schema
> stattdessen direkt aus `schema.prisma`, ohne Migrationshistorie) sollte
> nur noch für lokale Entwicklung/Prototyping genutzt werden, nie für ein
> Produktivsystem mit echten Vereinsdaten. Eine künftige Schemaänderung
> entsteht lokal per `npx prisma migrate dev --name <kurze-beschreibung>`
> (erzeugt eine neue Datei unter `prisma/migrations/`), wird committet und
> gelangt über genau diesen Schritt 7.3 (bzw. Abschnitt 13 bei einem
> späteren Update) auf den Server.

### 7.4 Backend bauen
```bash
npm run build --workspace=apps/api
```

---

## 8. Backend mit PM2 starten (sobald vorhanden)

`--node-args="--env-file-if-exists=.env"` ist **Pflicht** (Sicherheitsreview
2026-08-28, Befund N2): Weder `apps/api/src/config/env.ts` noch der
laufende Server laden `apps/api/.env` von sich aus — ohne dieses Flag
stürzt der Prozess sofort mit „DATABASE_URL: Required" ab, obwohl die
Datei direkt daneben liegt (empirisch geprüft: `pm2 start dist/index.js`
ohne dieses Flag lädt `.env` nicht, mit dem Flag funktioniert es):
```bash
cd apps/api
pm2 start dist/index.js --name lane1-api --node-args="--env-file-if-exists=.env"
pm2 save
pm2 startup
```
Der letzte Befehl gibt eine Zeile aus, die mit `sudo` beginnt — diese Zeile **kopieren und einmal ausführen**. Damit startet das Backend automatisch neu, falls der Server neu bootet (z. B. nach einem Wartungsfenster).

Kontrolle:
```bash
pm2 status
pm2 logs lane1-api
```

### 8.1 Ersten Superadmin anlegen (einmalig)

**Ohne diesen Schritt kann sich niemand jemals anmelden** — Lane 1 hat
bewusst keine offene Registrierung, Konten entstehen ausschließlich per
Einladungslink, und Einladungen kann nur verschicken, wer schon ein Konto
hat. Für die allererste Person gibt es deshalb ein einmaliges CLI-Skript
(siehe `apps/api/scripts/createSuperAdmin.ts`), das direkt in der
Datenbank ein Superadmin-Konto anlegt. Das Passwort wird bewusst NICHT
als Argument angegeben (Sicherheitsreview 2026-08-28, Befund M1 —
Kommandozeilenargumente sind auf Linux über `/proc/<pid>/cmdline` für
jeden lokalen Benutzer lesbar), sondern interaktiv abgefragt (ohne
Terminal-Echo, mit Bestätigung):
```bash
cd apps/api
npm run create-superadmin -- --email=admin@mein-verein.de --name="Vorname Nachname"
cd ../..
```
Alternativ nicht-interaktiv per Umgebungsvariable (z. B. für ein
automatisiertes Setup):
```bash
cd apps/api
SUPERADMIN_PASSWORD='EIN-SICHERES-PASSWORT' npm run create-superadmin -- --email=admin@mein-verein.de --name="Vorname Nachname"
cd ../..
```
Mit diesem Konto danach unter `https://training.mein-verein.de/admin`
anmelden (siehe `apps/web/help/admin.html`) und dort den ersten Verein
anlegen — das erzeugt automatisch die erste Admin-Einladung.

**Erste Anmeldung mit Zwei-Faktor-Pflicht** (`MFA_ENFORCE=true`): nach dem
Passwort zeigt Lane 1 einen QR-Code — eine Authenticator-App (z. B. Aegis, Google
Authenticator, Microsoft Authenticator oder einen Passwortmanager mit TOTP)
bereithalten, den Code scannen und die 10 Wiederherstellungscodes sicher
aufbewahren. Gehen App und Wiederherstellungscodes verloren, setzt der
Serverbetrieb TOTP zurück:
```bash
cd apps/api
npm run reset-mfa -- --email=admin@mein-verein.de
cd ../..
```

---

## 9. Nginx konfigurieren

Neue Konfigurationsdatei anlegen:
```bash
sudo nano /etc/nginx/sites-available/lane1
```
Inhalt (Pfad zu `apps/web` ggf. anpassen):
```nginx
server {
    listen 80;
    server_name training.mein-verein.de;

    # Weboberfläche (PWA) als statische Dateien ausliefern
    root /home/deploy/lane1/apps/web;
    index index.html;

    # Content-Security-Policy für das Frontend (Code-Review, Befund S3):
    # apps/api setzt bereits eine eigene, maximal restriktive CSP für seine
    # JSON-Antworten (siehe apps/api/src/plugins/security.ts) — die
    # eigentliche HTML-Anwendung (dieses Nginx-`root`-Verzeichnis) lief
    # bislang OHNE jede CSP. Das Refresh Token liegt aus praktischen Gründen
    # in `localStorage` (siehe apps/web/js/apiClient.js, dort ausführlich
    # begründet), nicht in einem httpOnly-Cookie — bei einem XSS wäre der
    # Schaden ohne CSP maximal (dauerhafte Sitzungsübernahme statt eines nur
    # flüchtigen Zugriffs). Als `set`-Variable definiert statt den String
    # zweimal auszuschreiben (siehe `location = /sw.js` unten, die einen
    # eigenen `add_header` hat und dadurch die Vererbung aus `server`
    # bricht — Nginx-Eigenheit: eine Location mit eigenem `add_header`
    # erbt KEINE `add_header`-Direktiven des umschließenden Blocks mehr,
    # auch nicht andere als die dort neu gesetzte).
    #   - style-src erlaubt bewusst 'unsafe-inline': apps/web ist bewusst
    #     ohne Build-Schritt (siehe apps/web/package.json) und setzt an
    #     vielen Stellen `style="..."` direkt per JavaScript (`el()` in
    #     js/dom.js) statt über CSS-Klassen — ein vollständiger Umbau
    #     wäre eine eigene, große Refactoring-Aufgabe. Style-basierte
    #     CSS-Injection ist ein deutlich kleineres Risiko als
    #     Script-Injection, daher hier als bewusster, dokumentierter
    #     Kompromiss vertretbar; script-src bleibt ohne 'unsafe-inline'
    #     (die App verwendet ohnehin keine Inline-Skripte/-Handler).
    #   - connect-src 'self' reicht aus, da diese Konfiguration Frontend
    #     UND Backend (`location /api/`/`/auth/` unten) unter derselben
    #     Origin ausliefert — ein eigener API-Origin ist hier nicht nötig.
    #   - Ausführlich in einem echten Browser gegen genau diese Nginx-
    #     Konfiguration getestet (Login, Navigation durch alle Module,
    #     Modals, SVG-Diagramme, Service-Worker-Registrierung,
    #     Superadmin-/Demo-/Hilfe-Seiten) — keine CSP-Verstöße in der
    #     Konsole.

    # Sicherheitsreview 2026-08-29, Befund N2: neben der CSP fehlten der
    # statisch ausgelieferten Weboberfläche bislang drei weitere Header.
    # apps/api setzt sie über Helmet (siehe plugins/security.ts) — aber
    # nur auf seinen EIGENEN JSON-Antworten; die HTML-Anwendung aus
    # diesem `root`-Verzeichnis läuft nicht durch Fastify und bekam
    # dadurch keinen davon:
    #   - Strict-Transport-Security: `certbot --nginx` legt zwar eine
    #     80->443-Weiterleitung an, aber kein HSTS. Ohne den Header ist
    #     der allererste Aufruf einer Sitzung (Tippen der Domain ohne
    #     "https://") als Klartext-HTTP angreifbar — und in genau dieser
    #     Anfrage schickt der Browser bereits das im localStorage
    #     liegende Refresh Token mit, sobald die App lädt. `preload`
    #     bewusst NICHT gesetzt: das ist eine praktisch unumkehrbare
    #     Eintragung in die Browser-Liste und sollte eine bewusste
    #     Entscheidung des Betreibers bleiben, kein Nebeneffekt dieser
    #     Anleitung.
    #   - X-Content-Type-Options: verhindert MIME-Sniffing — ein als
    #     Bild/Text hochgeladener oder abgelegter Inhalt darf nicht als
    #     Skript interpretiert werden.
    #   - Referrer-Policy: die Einladungs-/Reset-Tokens stehen zwar im
    #     URL-FRAGMENT und verlassen den Browser ohnehin nie (siehe
    #     invitations.service.ts: buildInviteUrl()) — der Header hält
    #     zusätzlich Pfad und Query aus dem Referer fremder Ziele heraus.
    # Wie bei der CSP als `set`-Variablen definiert, damit sie in jedem
    # `location`-Block wiederholt werden können: eine Location mit
    # eigenem `add_header` erbt KEINE `add_header`-Direktiven des
    # umschließenden Blocks (Nginx-Eigenheit, siehe Kommentar oben).
    set $csp "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";
    set $hsts "max-age=31536000; includeSubDomains";
    set $nosniff "nosniff";
    set $referrer_policy "strict-origin-when-cross-origin";

    location / {
        try_files $uri $uri/ /index.html;
        add_header Content-Security-Policy $csp always;
        add_header Strict-Transport-Security $hsts always;
        add_header X-Content-Type-Options $nosniff always;
        add_header Referrer-Policy $referrer_policy always;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
        add_header Content-Security-Policy $csp always;
        add_header Strict-Transport-Security $hsts always;
        add_header X-Content-Type-Options $nosniff always;
        add_header Referrer-Policy $referrer_policy always;
    }

    # API-Anfragen an das Node.js-Backend weiterleiten (sobald vorhanden)
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Login/Registrierung/Token-Refresh/Logout — bewusst EIGENER Block, da
    # diese Routen im Backend ohne /api/-Präfix registriert sind
    # (/auth/login, /auth/register, /auth/refresh, /auth/logout; siehe
    # apps/api/src/modules/auth/auth.route.ts). Ohne diesen Block würde
    # jeder Login-/Registrierungsversuch NICHT ans Backend gehen, sondern
    # von "location /" als unbekannte Route auf die HTML-Startseite
    # umgeleitet (try_files-Fallback) — die App bekäme HTML statt der
    # erwarteten JSON-Antwort und die Anmeldung würde lautlos fehlschlagen.
    location /auth/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health-Check-Endpunkt für Monitoring (z. B. einen externen Uptime-
    # Check, siehe Schritt 11) — bewusst außerhalb von /api/, da der
    # Backend-Endpunkt selbst unter /health (ohne Präfix) registriert ist.
    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```
> **Wichtig — `proxy_pass` bewusst OHNE abschließenden Schrägstrich (bei
> `/api/` und `/auth/`):** `proxy_pass http://127.0.0.1:3000/;` (mit `/`)
> würde nginx anweisen, das jeweilige Präfix beim Weiterleiten zu entfernen
> — ein Aufruf von `/api/me` käme beim Backend nur noch als `/me` an. Das
> Backend registriert seine Routen aber selbst schon **mit** Präfix (z. B.
> `/api/me`, `/api/sync/push`, `/auth/login` — siehe
> `apps/api/src/modules/*/**.route.ts`) und erwartet den Pfad unverändert.
> Ohne den Schrägstrich (wie oben) leitet nginx den ursprünglichen Pfad
> unverändert weiter — das ist der korrekte, hier nötige Fall.
>
> Nach dem Einrichten testen (alle drei, nicht nur eins):
> ```bash
> curl -i https://training.mein-verein.de/health              # 200 OK, {"status":"ok",...}
> curl -i https://training.mein-verein.de/api/me               # 401 Unauthorized (kein Token) — NICHT 404, NICHT HTML
> curl -i -X POST https://training.mein-verein.de/auth/login \
>   -H 'Content-Type: application/json' -d '{"email":"x@x.de","password":"x"}'
>                                                                # 401/400 mit JSON-Fehlermeldung — NICHT die HTML-Startseite
> ```
> Ein `401`/`400` mit JSON-Body beweist bei allen dreien: die Anfrage kam
> beim Backend an und wurde dort verarbeitet. Eine HTML-Antwort (erkennbar
> an `<!DOCTYPE html>` im Body) bedeutet: nginx hat die Anfrage nicht
> weitergeleitet, sondern selbst (falsch) als SPA-Route behandelt.
### 9.1 Nginx Zugriff auf das Projektverzeichnis geben

Ubuntu 24.04 legt Home-Verzeichnisse mit den Rechten `750` an — andere
Benutzer, auch der Nginx-Benutzer `www-data`, kommen nicht hinein. Nginx
könnte `/home/deploy/lane1/apps/web` dann nicht lesen und beantwortet jede
Anfrage mit einem Fehler (`403 Forbidden` bzw. `500`, im Log
`/var/log/nginx/error.log` steht `Permission denied`). Deshalb einmalig das
**Durchgangsrecht** setzen — damit kann `www-data` Dateien unter bekanntem
Pfad öffnen, aber nicht auflisten, was sonst im Home-Verzeichnis liegt:
```bash
chmod o+x /home/deploy
sudo -u www-data test -r /home/deploy/lane1/apps/web/index.html && echo OK
```
Muss `OK` ausgeben. (`scripts/setup-ovhcloud.sh` erledigt das automatisch.)

### 9.2 Konfiguration aktivieren

Aktivieren und testen:
```bash
sudo ln -s /etc/nginx/sites-available/lane1 /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```
`nginx -t` sollte `syntax is ok` und `test is successful` melden — nur dann `reload` ausführen.

Ab jetzt ist die Seite unter `http://training.mein-verein.de` erreichbar (noch ohne Schloss-Symbol/HTTPS).

> **Hilfeseiten:** Die statischen Hilfedateien liegen unter `apps/web/help/` (`index.html`, `faq.html`, `admin.html`, `help.css`) — ein normaler Unterordner der bereits als `root` eingebundenen `apps/web`. Sie sind **ohne weitere Nginx-Konfiguration** automatisch unter `https://training.mein-verein.de/help/` erreichbar: `try_files $uri $uri/ /index.html;` liefert für existierende Dateien immer zuerst die Datei selbst aus, bevor es zum SPA-Fallback (`/index.html`) kommt. Nur bei einer künftigen Erweiterung um weitere Sprachvarianten oder eigene Unterordner ggf. prüfen, ob deren Dateinamen mit bestehenden App-Routen kollidieren.

---

## 10. HTTPS mit Let's Encrypt (kostenlos, automatisch verlängert)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d training.mein-verein.de
```
Certbot fragt nach einer E-Mail-Adresse (für Ablauf-Benachrichtigungen) und passt die Nginx-Konfiguration automatisch an (HTTP → HTTPS-Weiterleitung inklusive).

Automatische Verlängerung testen (läuft normalerweise per Cronjob/Systemd-Timer automatisch):
```bash
sudo certbot renew --dry-run
```

Ab jetzt: `https://training.mein-verein.de` mit Schloss-Symbol im Browser.

---

## 11. Testen

- Seite im Browser öffnen, Installierbarkeit prüfen (Browser bietet "App installieren" an).
- Flugmodus/WLAN aus testen — die App sollte weiterhin funktionieren (Offline-first).
- `https://training.mein-verein.de/help/` öffnen und prüfen, dass die Kurzanleitung (nicht die App) angezeigt wird; ebenso `/help/faq.html` und `/help/admin.html` sowie den „Hilfe"-Link unten in der Seitenleiste der App.
- Bei Backend-Anbindung: `curl -i https://training.mein-verein.de/health` prüfen (`200 OK`, `{"status":"ok",...}`) — bestätigt, dass Backend UND nginx-Weiterleitung grundsätzlich funktionieren, bevor der eigentliche Login getestet wird.
- Bei Backend-Anbindung: Login testen, danach in der Sync-Warteschlange „Jetzt synchronisieren" auslösen (zum Anlegen des ersten Kontos siehe Schritt 8.1).
- Bei Problemen:
  ```bash
  pm2 logs lane1-api        # Backend-Logs
  sudo journalctl -u nginx  # Nginx-Logs
  sudo nginx -t             # Konfigurationsfehler prüfen
  ```

---

## 12. Backups

### 12.1 Datenbank-Backup (täglich, automatisiert)
```bash
mkdir -p /home/deploy/backups
nano ~/.pgpass
```
Folgende Zeile eintragen (Platzhalter durch das `lane1_app`-Passwort aus
Schritt 6.2 ersetzen — die DML-Rechte dieser Rolle genügen für einen
lesenden `pg_dump`, `lane1_migrator` wird hierfür nicht gebraucht) und
Datei danach mit `chmod 600 ~/.pgpass` schützen — `pg_dump` liest die
Datei automatisch und braucht dadurch keine Passwortabfrage, die in
einem nicht-interaktiven Cronjob ohnehin nie beantwortet werden könnte:
```
127.0.0.1:5432:lane1:lane1_app:EIN-SICHERES-PASSWORT-HIER
```
```bash
chmod 600 ~/.pgpass
crontab -e
```
Folgende Zeile ergänzen (läuft täglich um 3:00 Uhr):
```
0 3 * * * pg_dump -h 127.0.0.1 -U lane1_app lane1 > /home/deploy/backups/lane1-$(date +\%F).sql 2>> /home/deploy/backups/backup-errors.log
```
> **Wichtig:** `pg_dump -U lane1_app lane1` **ohne** `-h 127.0.0.1` verbindet
> sich über den lokalen Unix-Socket statt per TCP — dafür gilt auf Ubuntu
> standardmäßig `peer`-Authentifizierung (Datei `pg_hba.conf`), die nur
> funktioniert, wenn der Linux-Benutzer exakt so heißt wie die
> Datenbankrolle. Als `deploy`-Cronjob schlägt das mit
> „Peer authentication failed" fehl — **jede Nacht, unbemerkt**, weil sonst
> auch keine Fehlerausgabe irgendwo landet (daher zusätzlich `2>> ...log`
> oben). Mit `-h 127.0.0.1` greift stattdessen die passwortbasierte
> `host`-Regel, und `~/.pgpass` liefert das Passwort automatisch.
>
> Von Zeit zu Zeit prüfen, ob tatsächlich Backups entstehen und die
> Fehler-Log-Datei leer ist:
> ```bash
> ls -lh /home/deploy/backups/
> cat /home/deploy/backups/backup-errors.log
> ```

### 12.2 OVHcloud-Snapshots und automatische Backups (komplettes Server-Abbild)
Im Control Panel unter **Bare Metal Cloud → Virtual Private Servers → *VPS*** gibt es zwei getrennte Optionen:

- **Snapshot** — ein manuelles Abbild, z. B. vor einem Ubuntu-Upgrade. Es gibt nur **einen** Snapshot-Platz: ein neuer Snapshot ersetzt den alten.
- **Automatisches Backup** — tägliche Sicherung des gesamten VPS mit einigen Tagen Aufbewahrung.

Ob diese Optionen im gebuchten Angebot enthalten sind oder als monatliche Zusatzoption gebucht werden müssen, hängt von VPS-Generation und Angebot ab — im Control Panel beim jeweiligen VPS unter „Optionen" nachsehen. Beides ersetzt kein Offsite-Backup (siehe 12.3), schützt aber schnell vor einer fehlgeschlagenen Änderung.

### 12.3 Offsite-Backup (empfohlen)
Die tägliche `.sql`-Datei zusätzlich außerhalb des Servers sichern — z. B. in einem **OVHcloud Object Storage**-Container (S3-kompatibel, abgerechnet nach Speichermenge — für ein paar Megabyte SQL-Dumps praktisch kostenlos; hochladen z. B. mit `rclone` oder `aws s3 cp`) **an einem anderen Standort als der VPS**, bei einem anderen Anbieter, oder per einfachem Cronjob, der die Datei per `rsync`/`scp` an einen anderen Ort kopiert. Ein Backup, das nur auf demselben Server liegt, hilft bei einem Totalausfall des Servers nicht.

### 12.4 DSGVO-Löschfristen durchsetzen (Purge-Cronjob)

Löscht ein Konto sein eigenes Nutzerkonto (Mein Profil → Konto löschen,
DSGVO Art. 17), wird es zunächst nur als gelöscht **markiert**
(Soft-Delete) — die endgültige, unwiderrufliche Löschung übernimmt ein
separates Skript, das `DATA_ERASURE_RETENTION_DAYS` Tage (Standard: 30,
siehe `.env`) nach der Löschanfrage läuft. Ohne diesen Cronjob bleiben als
gelöscht markierte Daten dauerhaft in der Datenbank stehen — ein
DSGVO-Verstoß. Einrichten:
```bash
crontab -e
```
Folgende Zeile ergänzen (läuft täglich um 4:00 Uhr, also nach dem
Datenbank-Backup aus 12.1):
```
0 4 * * * cd /home/deploy/lane1/apps/api && /home/deploy/lane1/node_modules/.bin/tsx --env-file-if-exists=.env scripts/purgeDeletedData.ts >> /home/deploy/backups/purge.log 2>&1
```
> **Warum nicht `npm run purge-deleted-data`?** `cron` startet mit einer
> minimalen `PATH`-Umgebung, in der `npm` typischerweise nicht zuverlässig
> gefunden wird — der absolute Pfad zu `tsx` (Workspace-Hoisting legt es
> unter dem Monorepo-**Root**-`node_modules/.bin/` ab, nicht unter
> `apps/api/node_modules/.bin/`) umgeht das. `tsx` wird bewusst verwendet
> statt Nodes eingebauter TypeScript-Unterstützung
> (`node --experimental-strip-types`) — Letzteres löst die im Code üblichen
> relativen Imports mit `.js`-Endung (TypeScript-Konvention, siehe
> `tsconfig.json`) nicht automatisch zur passenden `.ts`-Datei auf und
> bricht mit `ERR_MODULE_NOT_FOUND` ab; `tsx` übernimmt genau diese
> Auflösung zusätzlich zum reinen Type-Stripping.
>
> **Warum `--env-file-if-exists=.env`?** (Sicherheitsreview 2026-08-28, Befund N2)
> Weder `apps/api/src/config/env.ts` noch die direkt instanziierte
> `PrismaClient` in `purgeDeletedData.ts` laden `apps/api/.env` von sich
> aus — ohne dieses Flag bricht der Cronjob sofort mit „DATABASE_URL:
> Required" ab, unabhängig davon, dass die Datei direkt daneben liegt.
> Node ≥ 20.6 unterstützt `--env-file` nativ, `tsx` reicht es unverändert
> an den zugrundeliegenden Node-Prozess durch.

### 12.5 Ablauf-Erinnerungen für Qualifikationen (Cronjob)

Nur relevant, wenn mindestens ein Verein das Modul „Qualifikationsmanagement"
gebucht hat. Verschickt E-Mail- (und, sofern `VAPID_*` gesetzt ist,
zusätzlich Push-)Erinnerungen an Personen mit bald ablaufender oder
bereits abgelaufener Qualifikation sowie an die Admins ihres Vereins.
Ohne diesen Cronjob bleiben solche Fristen unbemerkt. Einrichten:
```bash
crontab -e
```
Folgende Zeile ergänzen (läuft täglich um 5:00 Uhr, eine Stunde nach dem
Purge-Cronjob aus 12.4):
```
0 5 * * * cd /home/deploy/lane1/apps/api && /home/deploy/lane1/node_modules/.bin/tsx --env-file-if-exists=.env scripts/notifyExpiringQualifications.ts >> /home/deploy/backups/notify-qualifications.log 2>&1
```
Absoluter `tsx`-Pfad und `--env-file-if-exists=.env` aus demselben Grund
wie beim Purge-Cronjob oben (siehe dortige Erklärung).

### 12.6 Erinnerungen an bevorstehende Trainingseinheiten (Cronjob)

Nur relevant, wenn mindestens ein Verein das Modul „Einheiten & Feedback"
gebucht hat, UND nur wirksam, wenn `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
gesetzt sind (siehe Schritt 7.2) — dieser Cronjob versendet ausschließlich
Push, keine E-Mail. Erinnert Athlet:innen der betroffenen Gruppe sowie
alle Trainer:innen/Admins des Vereins rechtzeitig vor einer bevorstehenden
Einheit. Einrichten:
```bash
crontab -e
```
Folgende Zeile ergänzen (läuft alle 6 Stunden — die Erinnerung selbst
greift erst, sobald eine Einheit näher als 20 Stunden bevorsteht, siehe
`apps/api/src/jobs/notifyUpcomingSessions.ts: UPCOMING_SESSION_REMINDER_HOURS`):
```
0 */6 * * * cd /home/deploy/lane1/apps/api && /home/deploy/lane1/node_modules/.bin/tsx --env-file-if-exists=.env scripts/notifyUpcomingSessions.ts >> /home/deploy/backups/notify-sessions.log 2>&1
```
Absoluter `tsx`-Pfad und `--env-file-if-exists=.env` aus demselben Grund
wie beim Purge-Cronjob oben (siehe dortige Erklärung).

---

## 13. Künftige Updates ausrollen

Sobald es Änderungen am Code gibt (neue Version aus Git oder neues ZIP):
```bash
cd /home/deploy/lane1
git pull                                    # oder: neues ZIP hochladen & entpacken
npm install
cd apps/api
DATABASE_URL="postgresql://lane1_migrator:EIN-SICHERES-MIGRATIONS-PASSWORT-HIER@localhost:5432/lane1" npx prisma migrate deploy   # DDL-Rolle, siehe Schritt 7.3 (Befund N1)
cd ..
npm run build --workspace=apps/api
pm2 restart lane1-api
sudo systemctl reload nginx
```
> Ohne ausstehende neue Migrationsdatei ist `prisma migrate deploy` ein
> No-op ("No pending migrations to apply.") — der Schritt kann bei jedem
> Update gefahrlos mitlaufen, unabhängig davon, ob dieses Update tatsächlich
> eine Schemaänderung enthält.

> **Update auf/nach Sicherheitsreview 2026-08-27, Befund H1:** Ab dieser
> Version verlangt `apps/api/src/config/env.ts` bei `NODE_ENV=production`
> zusätzlich die Variable `TRUSTED_PROXY_IPS` — ohne sie bricht `pm2
> restart lane1-api` oben mit einer klaren Fehlermeldung ab (`pm2 logs
> lane1-api --nostream` zeigt sie). Eine bereits bestehende `apps/api/.env`
> wird von diesem Ablauf **nicht** automatisch angepasst (sie wurde beim
> allerersten Einrichten einmalig erzeugt, siehe Abschnitt 7.2, und danach
> nie wieder überschrieben). Vor dem ersten `pm2 restart` nach diesem
> Update daher einmalig ergänzen:
> ```bash
> echo 'TRUSTED_PROXY_IPS="127.0.0.1"' >> apps/api/.env
> ```
> (Der Wert ist bei diesem Aufbau immer `127.0.0.1` — Nginx läuft auf
> demselben Host, siehe Abschnitt 9.)

> **Update auf die Version mit Zwei-Faktor-Pflicht (Issue #97):** fehlt
> `TOTP_ENCRYPTION_KEY` in einer bestehenden `apps/api/.env`, bricht der
> Start ab, solange `MFA_ENFORCE` nicht `false` ist. Vor dem ersten `pm2
> restart` nach diesem Update einmalig ergänzen:
> ```bash
> echo "TOTP_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"" >> apps/api/.env
> echo 'MFA_ENFORCE=true' >> apps/api/.env
> ```
> (`bash scripts/setup-ovhcloud.sh` ergänzt beides ebenfalls, ohne andere Werte anzufassen.)
> Danach werden Superadmins bei ihrer nächsten Anmeldung durch die
> Einrichtung geführt; laufende Sitzungen ohne TOTP enden spätestens nach
> 15 Minuten.

---

## 14. Laufende Wartung

- `sudo apt update && sudo apt upgrade -y` — regelmäßig (z. B. monatlich) für Sicherheitsupdates.
- `sudo apt install unattended-upgrades -y` — automatische Installation kritischer Sicherheitsupdates.
- `htop` — Prozess-/Auslastungsübersicht direkt auf dem Server.
- Control Panel → **Bare Metal Cloud → Virtual Private Servers → *VPS*** — CPU-/RAM-/Netzwerk-Graphen ohne Zusatzinstallation.
- Ebenda **„Monitoring"** einschalten: OVHcloud pingt den Server regelmäßig und schickt bei Ausfall eine E-Mail. Funktioniert nur, solange ICMP (Ping) erlaubt ist — `ufw` lässt Ping standardmäßig durch, in der Edge Network Firewall sorgt Regel 3 (Schritt 2.2) dafür. Das prüft nur, ob der Server läuft, nicht ob Lane 1 antwortet — dafür zusätzlich einen externen Uptime-Dienst (z. B. UptimeRobot) auf `https://training.mein-verein.de/health` richten.
- Wartungsankündigungen kommen per E-Mail an die Konto-Adresse und stehen im Control Panel unter „Vorfälle/Travaux" ([status.ovhcloud.com](https://status.ovhcloud.com)) — die Kontakt-E-Mail des OVHcloud-Kontos daher an eine regelmäßig gelesene Adresse binden.

---

## 15. Kostenübersicht (grobe Richtwerte, Stand 2026)

| Posten | Kosten |
|---|---|
| OVHcloud VPS-1 (4 vCore/8 GB) | ca. 5–8 €/Monat (Shop-Preise meist zzgl. MwSt.; günstiger mit Mindestlaufzeit) |
| Automatisches Backup/Snapshot (optional, falls nicht inklusive) | ca. 1–3 €/Monat |
| Object Storage für Offsite-Backup (optional) | wenige Cent/Monat |
| Domain (bei OVHcloud oder anderem Registrar) | ca. 10–15 €/**Jahr** |
| SSL-Zertifikat (Let's Encrypt) | kostenlos |
| Anti-DDoS, Edge Network Firewall | kostenlos |
| **Gesamt** | **ca. 6–10 €/Monat** + Domain |

> Wie bei jedem Hoster ändern sich Produktnamen und Preise über die Zeit — im Zweifel im [OVHcloud-Shop](https://www.ovhcloud.com/de/vps/) nachsehen.

---

## 16. Kurze Fehlerbehebungs-Checkliste

| Symptom | Wahrscheinliche Ursache | Prüfen |
|---|---|---|
| Backend startet nicht, Log: „TOTP_ENCRYPTION_KEY fehlt, MFA_ENFORCE ist aber aktiv“ | Pflicht zur Zwei-Faktor-Anmeldung ohne Schlüssel | Schlüssel ergänzen (siehe Abschnitt Umgebungsvariablen) oder `MFA_ENFORCE=false` setzen |
| Superadmin hat Authenticator-App und Wiederherstellungscodes verloren | — | `cd apps/api && npm run reset-mfa -- --email=...`, danach bei der Anmeldung neu einrichten |
| Seite lädt gar nicht | DNS zeigt noch nicht auf den Server / Firewall blockiert | `ping domain`, `sudo ufw status`, Regeln der Edge Network Firewall (Schritt 2.2) |
| `apt update`, `npm install`, certbot oder SMTP hängen mit Zeitüberschreitung | Edge Network Firewall aktiv, aber ohne „TCP established"- bzw. DNS-Regel (zustandslos, Schritt 2.2) | Regeln 0–2 aus Schritt 2.2 prüfen oder die Edge Network Firewall testweise deaktivieren |
| Jede Seite liefert `403 Forbidden`/`500`, im Nginx-Log `Permission denied` | `www-data` darf nicht in `/home/deploy` (Ubuntu-24.04-Standard `750`) | Abschnitt 9.1: `chmod o+x /home/deploy` |
| certbot scheitert, obwohl `ping domain` die richtige IPv4 zeigt | AAAA-Record zeigt auf eine IPv6-Adresse, die nicht antwortet | Abschnitt 5, Punkt 3: AAAA-Record entfernen oder IPv6 reparieren |
| SSH fragt trotz Härtung noch nach einem Passwort | `50-cloud-init.conf` setzt `PasswordAuthentication yes` und wird vor `sshd_config` gelesen | Abschnitt 4.5: Drop-in-Datei `00-lane1.conf`, `sudo sshd -T` prüfen |
| SSH-Zugang verloren | Firewall-/SSH-Fehlkonfiguration | Control Panel → VPS → **KVM**-Konsole bzw. Rescue-Modus (Hinweis in Schritt 2.2) |
| „502 Bad Gateway" | Backend läuft nicht | `pm2 status`, `pm2 logs lane1-api` |
| Backend startet gar nicht (`pm2 status` zeigt „errored") | Pflicht-Umgebungsvariable fehlt/ungültig, z. B. `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in Produktion nicht gesetzt | `pm2 logs lane1-api` — `env.ts` gibt die genaue fehlende/ungültige Variable aus |
| Login/Registrierung liefert die HTML-Startseite statt einer Fehlermeldung/eines Tokens | `/auth/`-Location-Block in nginx fehlt oder `proxy_pass` mit abschließendem `/` (siehe Warnhinweis Abschnitt 9) | `curl -i .../auth/login -X POST -d '{}'`, Antwort auf `<!DOCTYPE html>` prüfen |
| Einladungs-E-Mails kommen nicht an | `SMTP_HOST` nicht gesetzt (nur Server-Log) | `pm2 logs lane1-api` auf SMTP-Fehler prüfen, `.env` kontrollieren |
| Push-Benachrichtigungen kommen nie an | `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` nicht gesetzt (nur Server-Log, siehe Schritt 7.2) oder die beiden Cronjobs aus 12.5/12.6 fehlen | `pm2 logs lane1-api` auf „[push] Kein VAPID-Schlüssel konfiguriert" prüfen, `crontab -l` kontrollieren |
| Kein Schloss-Symbol/HTTPS-Fehler | Zertifikat nicht erneuert oder DNS falsch bei Erstanfrage | `sudo certbot renew --dry-run` |
| Änderungen erscheinen nicht | Browser-/Service-Worker-Cache | Hard-Reload (`Strg+Shift+R`), `CACHE_VERSION` in `sw.js` prüfen |
| „Permission denied" bei SSH | falscher Benutzer/Key | Mit `deploy` (bzw. vor Schritt 4.2 mit `ubuntu`) verbinden — `root` ist bei OVHcloud gesperrt; richtigen Key prüfen |
