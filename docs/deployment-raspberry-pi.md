# Lane 1 auf einem Raspberry Pi veröffentlichen — Schritt-für-Schritt-Anleitung

**Für wen ist diese Anleitung?** Für jemanden ohne (oder mit sehr wenig) Erfahrung in Serveradministration, der/die Lane 1 statt auf einem gemieteten Server zuhause auf eigener Hardware betreiben möchte. Jeder Schritt wird erklärt — auch *warum* er nötig ist, nicht nur *wie*. Es wird nichts vorausgesetzt außer: ein Computer, eine Internetverbindung und die Bereitschaft, Befehle in ein schwarzes Textfenster ("Terminal") einzutippen.

**Basis dieser Anleitung:** [`deployment.md`](./deployment.md) (Hetzner-Cloud-Variante). Diese Anleitung übernimmt bewusst **möglichst viel unverändert** von dort — gleiche Software, gleiche Konfiguration, gleiche Reihenfolge, gleiche (dort bereits gefundenen und behobenen) Stolperfallen. Abgewichen wird nur, wo es die andere Umgebung zwingend erfordert: eigene Hardware statt gemieteter Cloud-Server, eigenes Heimnetz statt Rechenzentrum mit fester öffentlicher IP. Diese Unterschiede werden unten in [0.1](#01-unterschiede-zur-hetzner-anleitung-im-überblick) zusammengefasst.

---

## 0. Überblick: Was am Ende funktioniert

Am Ende dieser Anleitung ist unter einer eigenen Adresse (z. B. `https://training.mein-schwimmverein.de`) erreichbar:

- die Lane-1-Weboberfläche (installierbar als App, funktioniert offline),
- die dazugehörigen Hilfeseiten unter `/help/` (Kurzanleitung, FAQ, Admin-Handbuch — ebenfalls offline nutzbar),
- optional das Node.js-Backend darunter, das die Geräte synchronisiert,
- alles verschlüsselt (HTTPS, kostenloses Zertifikat),
- mit automatischen Neustarts, falls der Raspberry Pi einmal neu startet (z. B. nach einem Stromausfall) —

betrieben auf einem Raspberry Pi bei dir zuhause statt in einem Rechenzentrum.

### 0.1 Unterschiede zur Hetzner-Anleitung im Überblick

| Thema | Hetzner-Cloud-Variante | Diese Raspberry-Pi-Variante |
|---|---|---|
| Server | gemietete Cloud-VM, feste öffentliche IP | eigene Hardware zuhause, meist wechselnde (dynamische) IP |
| Betriebssystem | Ubuntu 24.04 LTS | Raspberry Pi OS (64-Bit, Debian-basiert) |
| Ersteinrichtung | Cloud Console, SSH-Key beim Server-Erstellen hinterlegen | Raspberry Pi Imager, SSH-Key + Benutzer schon beim Beschreiben der Speicherkarte hinterlegen |
| „Firewall" | Hetzner Cloud Firewall (vorgelagert) + `ufw` | nur `ufw` + Portweiterleitung im eigenen Router — SSH wird **nicht** ins Internet weitergeleitet (siehe Abschnitt 4) |
| Domain erreichbar machen | A-Record zeigt direkt auf feste Server-IP | A-Record + **Dynamic DNS** (die Heim-IP ändert sich), **Portweiterleitung** im Router, Prüfung auf **CGNAT** (siehe Abschnitt 5) |
| Backend/Nginx/PostgreSQL/PM2/Zertifikat | — | **identisch**, inkl. aller in `deployment.md` bereits gefundenen Bugfixes (Nginx-`/api/`+`/auth/`-Weiterleitung, PostgreSQL-15-Schema-Rechte, `prisma migrate deploy`, Backup-Cronjob-Fix) |
| Backups/Snapshots | Hetzner-Cloud-Backup (Knopfdruck) | SD-Karten-/SSD-Image statt Cloud-Snapshot; Offsite-Backup umso wichtiger (einzelnes Gerät zuhause) |
| Laufende Kosten | ca. 5–6 €/Monat + Domain | einmalig Hardware + Strom (siehe Abschnitt 15) + Domain |

---

## 1. Hardware-Wahl

### Empfehlung: **Raspberry Pi 5 (4 GB oder 8 GB RAM)**

| Eigenschaft | Wert |
|---|---|
| Modell | Raspberry Pi 5, 4 GB oder 8 GB RAM |
| Speicher | microSD-Karte (min. 32 GB, "High Endurance"/A2-Klasse empfohlen) **oder besser: externe USB-SSD** (siehe Hinweis unten) |
| Netzteil | **offizielles** 27-W-USB-C-Netzteil (Raspberry Pi 5 braucht mehr Strom als ältere Modelle — ein zu schwaches Netzteil führt zu zufälligen Abstürzen/Datenverlust) |
| Gehäuse/Kühlung | Gehäuse mit aktivem Lüfter oder passivem Kühlkörper empfohlen (Dauerbetrieb 24/7) |
| Preis (Stand Mitte 2026) | ca. **80–100 €** einmalig (Pi + Netzteil + Gehäuse + SD-Karte) |
| Betriebssystem | **Raspberry Pi OS (64-Bit, Lite)** |

**Warum genau dieses Produkt?**
- Für einen Verein/ein Team mit einigen Dutzend bis wenigen hundert Nutzer:innen ist die Last gering — ein Pi 5 mit 4 GB reicht für Node.js-API, PostgreSQL-Datenbank und das Ausliefern der Weboberfläche gleichzeitig locker aus (mehr Reserve als die in `deployment.md` empfohlene Hetzner-CX22-Konfiguration).
- **64-Bit-Betriebssystem ist Pflicht**, nicht optional: `@prisma/client` lädt beim Einrichten passend zur Architektur eine fertige Datenbank-Engine herunter (`linux-arm64-openssl-3.0.x`) — unter einem 32-Bit-System (`armhf`) gibt es dafür keine passende Engine, das Backend würde nicht starten.
- Ein Raspberry Pi 4 (mind. 4 GB RAM) funktioniert ebenfalls, ist aber spürbar langsamer beim einmaligen Bauen (`npm run build`, `npm install`) — für den laufenden Betrieb nach der Einrichtung reicht auch er aus.

> **Hinweis:** Modelle und Preise ändern sich — schau im Zweifel direkt bei [raspberrypi.com/products](https://www.raspberrypi.com/products/) nach dem aktuellen Modell mit mindestens 4 GB RAM. Die Empfehlung bleibt dieselbe: aktuellstes Pi-Modell, 64-Bit-OS, mindestens 4 GB RAM.

> **SD-Karte vs. USB-SSD:** Eine ständig laufende PostgreSQL-Datenbank schreibt kontinuierlich auf den Datenträger — normale SD-Karten sind dafür nicht ausgelegt und nutzen sich spürbar schneller ab als bei "normaler" Pi-Nutzung (Datenverlust nach Monaten bis wenigen Jahren möglich). Raspberry Pi 4/5 können nativ **von einer USB-SSD booten** (kein Adapter/Umweg über SD-Karte nötig) — für einen Dauerbetrieb mit Datenbank deutlich empfehlenswerter und nicht wesentlich teurer als eine gute SD-Karte. Diese Anleitung funktioniert identisch, unabhängig davon, ob am Ende eine SD-Karte oder eine USB-SSD als Systemlaufwerk dient — überall wo im Folgenden "SD-Karte" steht, gilt bei einer SSD dasselbe.

Reicht der Pi später nicht mehr aus, lässt sich (anders als bei Hetzner) nicht einfach "vergrößern" — dann hilft nur ein leistungsfähigeres Modell oder doch der Umstieg auf `deployment.md` (Cloud-Server).

---

## 2. Raspberry Pi OS aufsetzen

Anders als bei Hetzner (wo der Server fertig eingerichtet in der Cloud Console erscheint) wird das Betriebssystem hier selbst auf die SD-Karte/SSD geschrieben — mit dem Vorteil, dass sich Benutzername, Passwort und SSH-Zugang schon *vor* dem ersten Start konfigurieren lassen (kein unsicherer Zwischenschritt über einen `root`-Benutzer nötig, siehe Abschnitt 4).

### 2.1 SSH-Key erzeugen (einmalig, auf dem eigenen Computer)

Ein SSH-Key ist ein Schlüsselpaar, mit dem man sich sicherer und bequemer anmeldet als mit einem Passwort. Wird gleich beim Beschreiben der Speicherkarte gebraucht.

**Mac/Linux** (Terminal-App öffnen):
```bash
ssh-keygen -t ed25519 -C "lane1-pi"
```
Dreimal Enter drücken (Standardpfad, kein zusätzliches Passwort nötig für den Einstieg). Danach den öffentlichen Schlüssel anzeigen und kopieren:
```bash
cat ~/.ssh/id_ed25519.pub
```

**Windows** (PowerShell öffnen, ab Windows 10 ist `ssh` vorinstalliert):
```powershell
ssh-keygen -t ed25519 -C "lane1-pi"
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Den angezeigten Text (beginnt mit `ssh-ed25519 …`) gleich griffbereit halten — wird im nächsten Schritt gebraucht.

### 2.2 Speicherkarte/SSD beschreiben (Raspberry Pi Imager)

1. **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)** auf dem eigenen Computer installieren und öffnen.
2. **Gerät:** das verwendete Pi-Modell auswählen.
3. **Betriebssystem:** „Raspberry Pi OS (other)" → **„Raspberry Pi OS Lite (64-bit)"** (Lite = ohne grafische Oberfläche, passend für einen Server — spart Ressourcen).
4. **Speicher:** die SD-Karte bzw. die per USB angeschlossene SSD auswählen.
5. **Vor** dem Klick auf „Weiter"/Schreiben unbedingt die erweiterten Einstellungen öffnen (Zahnrad-Symbol bzw. `Strg+Umschalt+X`):
   - **Hostname:** z. B. `lane1-pi`
   - **SSH aktivieren** → „Public-Key-Authentifizierung verwenden" → den in 2.1 kopierten öffentlichen Schlüssel einfügen
   - **Benutzername:** `deploy` (damit die restliche Anleitung — wie bei Hetzner — mit dem Benutzer `deploy` statt `root` weiterläuft, ganz ohne den in `deployment.md` nötigen Zwischenschritt „eigenen Benutzer anlegen")
   - **Passwort:** trotzdem ein sicheres Passwort setzen (Absicherung, falls SSH-Key-Auth mal deaktiviert werden muss)
   - **WLAN konfigurieren**, falls kein Netzwerkkabel verwendet wird (Kabel/Ethernet ist für einen Dauerbetrieb-Server zuverlässiger und empfohlen)
   - **Lokalisierung:** Zeitzone/Tastaturlayout passend setzen
6. Schreibvorgang starten und abwarten (kann einige Minuten dauern, je nach Speichergröße/-geschwindigkeit).
7. SD-Karte/SSD in den Pi einsetzen, Netzwerkkabel + Netzteil anschließen, Pi starten.

### 2.3 IP-Adresse/Hostname im eigenen Netzwerk finden

Nach ca. 1–2 Minuten (erster Start dauert etwas länger) ist der Pi im Netzwerk erreichbar — entweder:
- über den in 2.2 vergebenen Hostnamen: `lane1-pi.local` (funktioniert auf macOS und den meisten Linux-Systemen sofort; unter Windows ggf. „Bonjour"/mDNS-Unterstützung nötig, meist aber bereits vorhanden), oder
- über die vom Router vergebene lokale IP-Adresse (in der Web-Oberfläche des Routers unter „angeschlossene Geräte"/„DHCP-Clients" nachsehen, Gerätename `lane1-pi`).

> **Empfehlung:** Im Router eine **feste lokale IP-Adresse (DHCP-Reservierung)** für den Pi einrichten, damit sich die lokale Adresse nicht bei einem Neustart des Routers ändert — wie das geht, unterscheidet sich je Router-Hersteller (Suchbegriff: „DHCP-Reservierung" + Router-Modell).

---

## 3. Erste Verbindung zum Pi

Terminal (Mac/Linux) bzw. PowerShell (Windows) öffnen:

```bash
ssh deploy@lane1-pi.local
```
(oder die in 2.3 ermittelte lokale IP-Adresse statt `lane1-pi.local`)

Beim ersten Verbinden erscheint eine Sicherheitsabfrage ("authenticity of host … can't be established"). Das ist normal beim allerersten Kontakt — mit `yes` bestätigen.

Anders als bei Hetzner ist bereits jetzt der Benutzer `deploy` aktiv (dank Vorkonfiguration in Schritt 2.2) — **kein separater Schritt „eigenen Benutzer statt root anlegen" nötig.**

---

## 4. Server absichern (Grundhärtung)

Alle folgenden Befehle **auf dem Pi** eingeben (also innerhalb der SSH-Verbindung von Schritt 3).

### 4.1 System aktualisieren
```bash
sudo apt update && sudo apt upgrade -y
```

### 4.2 Firewall einrichten

Anders als bei Hetzner gibt es keine vorgelagerte Cloud-Firewall — nur `ufw` direkt auf dem Pi. **Wichtiger Unterschied zu Hetzner:** SSH wird später (Abschnitt 5) **nicht** ins Internet weitergeleitet — der Pi soll nur aus dem eigenen Heimnetz per SSH erreichbar sein, für Fernwartung siehe Hinweis am Ende dieses Abschnitts. `ufw` erlaubt SSH deshalb ganz normal (die eigentliche Absicherung gegen SSH-Zugriffe von außen passiert im Router, indem Port 22 dort **nicht** weitergeleitet wird):
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```
Mit `y` bestätigen.

### 4.3 Schutz gegen automatisierte Anmeldeversuche
```bash
sudo apt install fail2ban -y
```
Läuft mit sinnvollen Standardeinstellungen sofort im Hintergrund — nützlich, falls SSH doch einmal (z. B. für Fernwartung, siehe Hinweis unten) von außen erreichbar gemacht wird.

### 4.4 (Empfohlen) Passwort-Login per SSH deaktivieren
```bash
sudo nano /etc/ssh/sshd_config
```
Darin folgende Zeile suchen/anpassen (mit den Pfeiltasten navigieren, `Strg+O` zum Speichern, `Strg+X` zum Verlassen):
```
PasswordAuthentication no
```
Danach:
```bash
sudo systemctl restart ssh
```
**Wichtig:** Vorher unbedingt bestätigen, dass die Anmeldung als `deploy` mit SSH-Key funktioniert (siehe Schritt 3) — sonst sperrt man sich selbst aus. `PermitRootLogin` muss hier — anders als bei Hetzner — nicht extra angepasst werden: Raspberry Pi OS hat standardmäßig gar keinen aktivierbaren `root`-Login per Passwort.

> **Fernwartung von unterwegs (optional):** Statt SSH direkt ins Internet weiterzuleiten (unnötiges Risiko für ein Heimnetz), empfiehlt sich ein VPN wie **[Tailscale](https://tailscale.com)** oder **WireGuard** — damit lässt sich von überall per SSH auf den Pi zugreifen, ohne einen Port im Router nach außen zu öffnen. Für den eigentlichen Lane-1-Betrieb (Web-App erreichbar machen) ist das nicht nötig, nur für die Administration des Pi selbst von unterwegs.

---

## 5. Domain, Dynamic DNS und Erreichbarkeit von außen einrichten

Das ist der Abschnitt, der sich am meisten von `deployment.md` unterscheidet: Ein Hetzner-Server hat eine feste öffentliche IP-Adresse, die direkt in einen DNS-A-Record eingetragen wird. Ein Heimanschluss hat das in aller Regel **nicht** — die vom Internetanbieter zugewiesene IP-Adresse ändert sich (z. B. bei jeder Zwangstrennung, oft alle 24 Stunden). Zusätzlich ist der Pi über eine private Adresse im eigenen Netzwerk erreichbar, nicht direkt aus dem Internet — dafür muss der Router konfiguriert werden.

### 5.1 Prüfen: liegt eine „echte" öffentliche IP vor (kein CGNAT)?

Manche Internetanbieter (v. a. bei reinen Mobilfunk-/manchen Kabelanschlüssen) vergeben gar keine eigene öffentliche IP-Adresse mehr, sondern nutzen **CGNAT** ("Carrier-Grade NAT") — dann funktioniert Portweiterleitung grundsätzlich **nicht**, unabhängig von der Router-Konfiguration. Prüfen:

1. Auf einem Gerät im Heimnetz eine Seite wie `https://www.whatismyip.com` öffnen und die angezeigte IP-Adresse notieren.
2. In der Weboberfläche des Routers (Adresse meist `192.168.0.1` oder `192.168.1.1` bzw. `fritz.box` bei Fritz!Boxen) unter „Internet"/„WAN-Status" die dort angezeigte öffentliche IP-Adresse vergleichen.
3. **Stimmen beide Adressen überein** → normaler Anschluss, weiter mit 5.2.
4. **Stimmen sie nicht überein** → CGNAT, Portweiterleitung funktioniert nicht. Optionen: beim Internetanbieter eine „echte"/statische öffentliche IP dazubuchen (oft gegen Aufpreis erhältlich), oder einen Tunnel-Dienst wie **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** verwenden (leitet Anfragen ohne Portweiterleitung zum Pi durch — eigenständiges Thema, hier nicht weiter dokumentiert), oder auf die Hetzner-Cloud-Variante (`deployment.md`) ausweichen.

### 5.2 Domain registrieren
Eine Domain registrieren (falls noch nicht vorhanden), z. B. über Hetzner selbst, INWX oder einen beliebigen Registrar — identisch zu `deployment.md`, Schritt 5.1.

### 5.3 Dynamic DNS einrichten

Da sich die öffentliche IP-Adresse ändert, reicht ein einmalig eingetragener A-Record nicht — er muss **automatisch aktuell gehalten** werden. Zwei gängige Wege:

**Variante A — DDNS-Client direkt auf dem Router** (falls unterstützt, oft die einfachste Lösung): In der Router-Weboberfläche nach „DynDNS"/„Dynamic DNS" suchen. Viele Router unterstützen entweder verbreitete DDNS-Anbieter (z. B. No-IP, DuckDNS, Dynu) direkt, oder lassen sich mit einem beliebigen Anbieter verbinden, der eine Update-URL bereitstellt. Anschließend beim DNS-Verwalter der eigenen Domain einen **CNAME** anlegen, der auf den vom DDNS-Anbieter erhaltenen Hostnamen zeigt (z. B. `training` → `lane1-verein.duckdns.org`).

**Variante B — `ddclient` auf dem Pi selbst** (funktioniert unabhängig vom Router-Modell):
```bash
sudo apt install -y ddclient
```
Während der Installation nach Anbieter/Zugangsdaten fragen lassen (Konfiguration liegt danach in `/etc/ddclient.conf`, mit `sudo nano /etc/ddclient.conf` anpassbar). `ddclient` prüft anschließend automatisch regelmäßig die öffentliche IP und aktualisiert den DNS-Eintrag bei Änderung.

> Wird die Domain bereits bei Hetzner DNS verwaltet, lässt sich die [Hetzner-DNS-API](https://dns.hetzner.com/api-docs) alternativ auch mit einem eigenen kleinen Cronjob-Skript ansprechen, um direkt den A-Record zu aktualisieren — für den Einstieg ist Variante A oder B aber deutlich einfacher.

### 5.4 Portweiterleitung im Router einrichten

In der Router-Weboberfläche unter „Portweiterleitung"/„Port Forwarding"/„Virtuelle Server" (Bezeichnung variiert je Hersteller) zwei Regeln anlegen, beide zur in Schritt 2.3 vergebenen **festen lokalen IP-Adresse** des Pi:

| Port außen | Port innen (Pi) | Protokoll | Zweck |
|---|---|---|---|
| 80 | 80 | TCP | HTTP (wird später auf HTTPS umgeleitet, wird auch für die Let's-Encrypt-Zertifikatsausstellung gebraucht) |
| 443 | 443 | TCP | HTTPS |

**Port 22 (SSH) bewusst nicht weiterleiten** — siehe Hinweis zu Tailscale/WireGuard in Abschnitt 4.

### 5.5 Erreichbarkeit prüfen
DNS- und Portweiterleitungs-Änderungen brauchen etwas Zeit (DNS meist Minuten, manchmal bis zu einer Stunde). Prüfen:
```bash
ping training.mein-verein.de
```
Antwortet die (öffentliche) IP-Adresse aus Schritt 5.1, ist der DNS-Teil erledigt. Ob die Portweiterleitung tatsächlich funktioniert, lässt sich erst ab Schritt 9 (Nginx läuft) zuverlässig testen — ein Online-Dienst wie „Port Checker" kann vorab schon prüfen, ob Port 80/443 von außen erreichbar sind.

---

## 6. Benötigte Software installieren

Identisch zu `deployment.md`, Abschnitt 6 — dieselben Pakete, dieselben Befehle, funktionieren unverändert auf Raspberry Pi OS (Debian-basiert wie Ubuntu).

### 6.1 Node.js (über NodeSource, liefert eine aktuelle LTS-Version)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```
Sollte `v22.x` anzeigen. Das NodeSource-Repository erkennt die Prozessorarchitektur automatisch und liefert die passende `arm64`-Version — kein Zusatzschritt nötig.

### 6.2 PostgreSQL (Datenbank für das Backend)
```bash
sudo apt install -y postgresql
sudo -u postgres psql
```
Innerhalb der PostgreSQL-Konsole (Prompt `postgres=#`):
```sql
CREATE DATABASE lane1;
CREATE USER lane1_app WITH ENCRYPTED PASSWORD 'EIN-SICHERES-PASSWORT-HIER';
GRANT ALL PRIVILEGES ON DATABASE lane1 TO lane1_app;
\c lane1
GRANT ALL ON SCHEMA public TO lane1_app;
\q
```
**Das Passwort notieren** — es wird gleich in der `.env`-Datei gebraucht.

> **Wichtig (PostgreSQL 15+, betrifft auch aktuelles Raspberry Pi OS/Debian):** Seit
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

## 7. Projekt auf den Pi bringen

Identisch zu `deployment.md`, Abschnitt 7.

### Variante A — mit Git-Repository (empfohlen, falls das Projekt z. B. auf GitHub liegt)
```bash
cd /home/deploy
git clone https://github.com/DEIN-VEREIN/lane1.git
cd lane1
```

### Variante B — ohne Git, per Datei-Upload (z. B. das bisher gelieferte ZIP-Archiv)
Vom **eigenen Computer** aus (nicht auf dem Pi):
```bash
scp lane1-schwimmteam-pwa.zip deploy@lane1-pi.local:/home/deploy/
```
Dann auf dem Pi:
```bash
cd /home/deploy
sudo apt install -y unzip
unzip lane1-schwimmteam-pwa.zip -d lane1
cd lane1
```

### 7.1 Monorepo-Abhängigkeiten installieren
```bash
npm install
```
Führt npm dank der Workspace-Konfiguration für alle Pakete (`apps/web`, `apps/api`, `packages/*`) in einem Rutsch aus. Auf einem Raspberry Pi 5 dauert das — abhängig von SD-Karte/SSD-Geschwindigkeit — spürbar länger als auf einem Cloud-Server mit NVMe-SSD; das ist normal, kein Fehler.

### 7.2 Umgebungsvariablen konfigurieren (`.env`)
```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```
`apps/api/.env.example` enthält bereits alle bekannten Variablen mit
Erklärung (vollständiges, verbindliches Schema samt Validierung:
`apps/api/src/config/env.ts` — ein fehlender/ungültiger Pflichtwert lässt
den Server beim Start sofort mit einer klaren Fehlermeldung abbrechen).
Für einen Produktivserver mindestens folgende Werte setzen bzw. anpassen:
```
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://lane1_app:EIN-SICHERES-PASSWORT-HIER@localhost:5432/lane1"
JWT_PRIVATE_KEY="<mit openssl erzeugen, siehe unten>"
JWT_PUBLIC_KEY="<mit openssl erzeugen, siehe unten>"
CORS_ORIGIN="https://training.mein-verein.de"
FRONTEND_BASE_URL="https://training.mein-verein.de"

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
```
**RS256-Schlüsselpaar erzeugen** (signiert die Zugriffs-Tokens; in
Produktion PFLICHT — ohne diese beiden Werte bricht der Serverstart mit
`NODE_ENV=production` sofort ab):
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/jwt_private.pem
openssl pkey -in /tmp/jwt_private.pem -pubout -out /tmp/jwt_public.pem
```
Beide PEM-Dateien müssen als **eine Zeile** mit literalen `\n` statt
echter Zeilenumbrüche in die `.env`:
```bash
awk 'BEGIN{ORS="\\n"} {print}' /tmp/jwt_private.pem
awk 'BEGIN{ORS="\\n"} {print}' /tmp/jwt_public.pem
```
Jede Ausgabe komplett kopieren und als Wert von `JWT_PRIVATE_KEY` bzw.
`JWT_PUBLIC_KEY` in Anführungszeichen einsetzen (z. B.
`JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"`).
Anschließend die temporären PEM-Dateien löschen, damit der private
Schlüssel nicht zusätzlich unverschlüsselt auf der Platte liegt:
```bash
rm /tmp/jwt_private.pem /tmp/jwt_public.pem
```

> **Hinweis SMTP_SECURE:** `SMTP_SECURE=false` (Port 587/STARTTLS) oder
> `SMTP_SECURE=true` (Port 465/implizites TLS) explizit setzen — beide
> werden korrekt ausgewertet. Bleibt die Zeile ganz weg, gilt ebenfalls
> `false` (Standardwert).
>
> **Hinweis SMTP-Anbieter:** Für die Zugangsdaten reicht in der Regel das
> E-Mail-Postfach des Vereins bzw. ein vom E-Mail-Anbieter bereitgestelltes
> SMTP-Konto. Anders als bei Hetzner gibt es bei einem Heimanschluss keine
> anbieterseitige Sperre von Port 25/465 zu beachten — trotzdem Port 587
> (wie oben, mit STARTTLS) verwenden, das funktioniert mit jedem gängigen
> Anbieter und ist der heute übliche Standard.

### 7.3 Datenbank-Schema anlegen
```bash
cd apps/api
npx prisma migrate deploy
cd ../..
```
> Siehe `deployment.md`, Abschnitt 7.3 für die ausführliche Begründung
> (`migrate deploy` statt `db push` — Code-Review, Befund W5): das Projekt
> führt eine committete, reviewbare Migrationshistorie unter
> `apps/api/prisma/migrations/`.

### 7.4 Backend bauen
```bash
npm run build --workspace=apps/api
```
Baut dabei automatisch auch die gemeinsamen Pakete (`packages/shared-types`, `packages/sync-protocol`) in der richtigen Reihenfolge mit (über `prebuild`-Skripte in den jeweiligen `package.json`).

---

## 8. Backend mit PM2 starten

```bash
cd apps/api
pm2 start dist/index.js --name lane1-api
pm2 save
pm2 startup
```
Der letzte Befehl gibt eine Zeile aus, die mit `sudo` beginnt — diese Zeile **kopieren und einmal ausführen**. Damit startet das Backend automatisch neu, falls der Pi neu bootet (z. B. nach einem Stromausfall — bei einem Gerät zuhause ohne unterbrechungsfreie Stromversorgung deutlich wahrscheinlicher als bei einem Rechenzentrums-Server).

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
Datenbank ein Superadmin-Konto anlegt:
```bash
cd apps/api
npm run create-superadmin -- --email=admin@mein-verein.de --password='EIN-SICHERES-PASSWORT' --name="Vorname Nachname"
cd ../..
```
Mit diesem Konto danach unter `https://training.mein-verein.de/admin`
anmelden (siehe `apps/web/help/admin.html`) und dort den ersten Verein
anlegen — das erzeugt automatisch die erste Admin-Einladung.

---

## 9. Nginx konfigurieren

Identisch zu `deployment.md`, Abschnitt 9 — inklusive aller dort bereits gefundenen und behobenen Bugs (fehlende `/auth/`-Weiterleitung, `/api/`-Präfix-Stripping durch falschen `proxy_pass`).

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

    # Content-Security-Policy für das Frontend (Code-Review, Befund S3) —
    # siehe `deployment.md`, Abschnitt 9 für die ausführliche Begründung
    # (u. a. warum `style-src 'unsafe-inline'` hier ein bewusster,
    # dokumentierter Kompromiss ist).
    set $csp "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'";

    location / {
        try_files $uri $uri/ /index.html;
        add_header Content-Security-Policy $csp always;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
        add_header Content-Security-Policy $csp always;
    }

    # API-Anfragen an das Node.js-Backend weiterleiten
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

    # Health-Check-Endpunkt für Monitoring — bewusst außerhalb von /api/,
    # da der Backend-Endpunkt selbst unter /health (ohne Präfix)
    # registriert ist.
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
> weitergeleitet, sondern selbst (falsch) als SPA-Route behandelt — bei
> dieser Heimnetz-Variante zusätzlich in Betracht ziehen: Testbefehle von
> **außerhalb** des eigenen WLANs ausführen (z. B. über Mobilfunknetz),
> manche Router leiten Anfragen von innen an die eigene öffentliche
> Adresse nicht korrekt zurück ins Netz ("NAT-Loopback/Hairpinning" —
> von außen funktioniert es trotzdem meist einwandfrei).

Aktivieren und testen:
```bash
sudo ln -s /etc/nginx/sites-available/lane1 /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```
`nginx -t` sollte `syntax is ok` und `test is successful` melden — nur dann `reload` ausführen.

Ab jetzt ist die Seite unter `http://training.mein-verein.de` erreichbar (noch ohne Schloss-Symbol/HTTPS) — **vorausgesetzt** DNS (5.3) und Portweiterleitung (5.4) sind korrekt eingerichtet.

> **Hilfeseiten:** Die statischen Hilfedateien liegen unter `apps/web/help/` (`index.html`, `faq.html`, `admin.html`, `help.css`) — ein normaler Unterordner der bereits als `root` eingebundenen `apps/web`. Sie sind **ohne weitere Nginx-Konfiguration** automatisch unter `https://training.mein-verein.de/help/` erreichbar: `try_files $uri $uri/ /index.html;` liefert für existierende Dateien immer zuerst die Datei selbst aus, bevor es zum SPA-Fallback (`/index.html`) kommt.

---

## 10. HTTPS mit Let's Encrypt (kostenlos, automatisch verlängert)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d training.mein-verein.de
```
Certbot fragt nach einer E-Mail-Adresse (für Ablauf-Benachrichtigungen) und passt die Nginx-Konfiguration automatisch an (HTTP → HTTPS-Weiterleitung inklusive).

> **Voraussetzung, die bei Hetzner automatisch erfüllt ist, hier aber nicht:** Certbot muss den Server über Port 80 **aus dem öffentlichen Internet** erreichen können, um das Zertifikat auszustellen (HTTP-01-Challenge). Schlägt der Befehl fehl, zuerst prüfen: DNS zeigt auf die aktuelle öffentliche IP (5.3/5.5), Portweiterleitung 80→80 ist aktiv (5.4), kein CGNAT (5.1).

Automatische Verlängerung testen (läuft normalerweise per Cronjob/Systemd-Timer automatisch):
```bash
sudo certbot renew --dry-run
```

Ab jetzt: `https://training.mein-verein.de` mit Schloss-Symbol im Browser.

---

## 11. Testen

- Seite im Browser öffnen, Installierbarkeit prüfen (Browser bietet "App installieren" an).
- Flugmodus/WLAN aus testen — die App sollte weiterhin funktionieren (Offline-first).
- Test unbedingt **von außerhalb des Heimnetzes** wiederholen (z. B. Mobilfunknetz, WLAN ausgeschaltet) — nur so ist sicher geprüft, dass DNS, Dynamic DNS und Portweiterleitung tatsächlich funktionieren und nicht nur die lokale Erreichbarkeit im selben Netz.
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
Folgende Zeile eintragen (Platzhalter durch das Passwort aus Schritt 6.2 ersetzen) und Datei danach mit `chmod 600 ~/.pgpass` schützen — `pg_dump` liest die Datei automatisch und braucht dadurch keine Passwortabfrage, die in einem nicht-interaktiven Cronjob ohnehin nie beantwortet werden könnte:
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
> sich über den lokalen Unix-Socket statt per TCP — dafür gilt standardmäßig
> `peer`-Authentifizierung (Datei `pg_hba.conf`), die nur funktioniert,
> wenn der Linux-Benutzer exakt so heißt wie die Datenbankrolle. Als
> `deploy`-Cronjob schlägt das mit „Peer authentication failed" fehl —
> **jede Nacht, unbemerkt**, weil sonst auch keine Fehlerausgabe irgendwo
> landet (daher zusätzlich `2>> ...log` oben). Mit `-h 127.0.0.1` greift
> stattdessen die passwortbasierte `host`-Regel, und `~/.pgpass` liefert
> das Passwort automatisch.
>
> Von Zeit zu Zeit prüfen, ob tatsächlich Backups entstehen und die
> Fehler-Log-Datei leer ist:
> ```bash
> ls -lh /home/deploy/backups/
> cat /home/deploy/backups/backup-errors.log
> ```

### 12.2 SD-Karten-/SSD-Image-Backup (Entsprechung zu Hetzner-Snapshots)

Ein Cloud-Snapshot-Knopf wie bei Hetzner existiert hier nicht — die Entsprechung ist ein **Image der gesamten Speicherkarte/SSD**, das man vor größeren Änderungen (z. B. Betriebssystem-Upgrade) erstellt:

1. Pi herunterfahren: `sudo shutdown -h now`.
2. Speicherkarte/SSD am eigenen Computer anschließen.
3. Mit einem Tool wie **Raspberry Pi Imager** (Funktion „Aus Gerät sichern"/"Backup"), `dd` (Linux/Mac, für Fortgeschrittene) oder **Win32DiskImager** (Windows) ein vollständiges Abbild auf eine andere Festplatte sichern.

Das ist deutlich umständlicher als ein Hetzner-Snapshot und eignet sich eher für gelegentliche Vollsicherungen als für einen täglichen Rhythmus — für den Alltag ist das Datenbank-Backup aus 12.1 (plus Offsite-Kopie, siehe 12.3) wichtiger.

### 12.3 Offsite-Backup (bei einem Heimserver besonders wichtig)

Die tägliche `.sql`-Datei aus 12.1 zusätzlich **außerhalb des eigenen Zuhauses** sichern — z. B. mit einer günstigen **Hetzner Storage Box** (unabhängig von einem Hetzner-Server nutzbar) oder einem einfachen Cronjob, der die Datei per `rsync`/`scp` an einen anderen Ort kopiert. Bei einem einzelnen Gerät zuhause ist das noch wichtiger als bei einem Rechenzentrums-Server: Diebstahl, Brand, Wasserschaden oder ein einfacher Defekt der Speicherkarte träfen sonst **gleichzeitig** die laufende Anwendung UND alle lokalen Backups.

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
0 4 * * * cd /home/deploy/lane1/apps/api && /home/deploy/lane1/node_modules/.bin/tsx scripts/purgeDeletedData.ts >> /home/deploy/backups/purge.log 2>&1
```
> **Warum nicht `npm run purge-deleted-data`?** `cron` startet mit einer
> minimalen `PATH`-Umgebung, in der `npm` typischerweise nicht zuverlässig
> gefunden wird — der absolute Pfad zu `tsx` (Workspace-Hoisting legt es
> unter dem Monorepo-**Root**-`node_modules/.bin/` ab, nicht unter
> `apps/api/node_modules/.bin/`) umgeht das. `tsx` wird bewusst verwendet
> statt Nodes eingebauter TypeScript-Unterstützung
> (`node --experimental-strip-types`) — Letzteres löst die im Code üblichen
> relativen Imports mit `.js`-Endung (TypeScript-Konvention) nicht
> automatisch zur passenden `.ts`-Datei auf und bricht mit
> `ERR_MODULE_NOT_FOUND` ab; `tsx` übernimmt genau diese Auflösung
> zusätzlich zum reinen Type-Stripping.

### 12.5 Stromausfälle und Datenintegrität

Ein Heimserver hängt in aller Regel **nicht** an einer unterbrechungsfreien Stromversorgung (USV) wie ein Rechenzentrums-Server. Ein abrupter Stromausfall mitten in einem Datenbank-Schreibvorgang kann im schlimmsten Fall zu einer beschädigten Datenbank führen. Zwei sinnvolle Absicherungen:
- Eine kleine **USV** (unterbrechungsfreie Stromversorgung) für Router + Pi verlängert die Zeit bis zum tatsächlichen Stromausfall und ermöglicht einen sauberen `sudo shutdown -h now`, falls man gerade anwesend ist.
- Wichtiger im Alltag: **regelmäßige, funktionierende Backups** (12.1 + 12.3) — die eigentliche Absicherung gegen Datenverlust ist nicht, einen Stromausfall zu verhindern, sondern im Ernstfall eine aktuelle Kopie der Daten zu haben.

---

## 13. Künftige Updates ausrollen

Identisch zu `deployment.md`, Abschnitt 13.

```bash
cd /home/deploy/lane1
git pull                                    # oder: neues ZIP hochladen & entpacken
npm install
cd apps/api && npx prisma migrate deploy && cd ../..   # wendet neue Migrationsdateien an, siehe Schritt 7.3
npm run build --workspace=apps/api
pm2 restart lane1-api
sudo systemctl reload nginx
```

---

## 14. Laufende Wartung

- `sudo apt update && sudo apt upgrade -y` — regelmäßig (z. B. monatlich) für Sicherheitsupdates.
- `sudo apt install unattended-upgrades -y` — automatische Installation kritischer Sicherheitsupdates.
- `htop` — Prozess-/Auslastungsübersicht direkt auf dem Pi.
- **Temperatur im Blick behalten:** `vcgencmd measure_temp` zeigt die aktuelle CPU-Temperatur. Bei Dauerbetrieb in einem geschlossenen Gehäuse ohne ausreichende Kühlung drosselt der Pi bei Überhitzung automatisch die Leistung ("Thermal Throttling") — bei wiederkehrend hohen Werten (> 70–80 °C) Kühlung verbessern.
- **Speicherkarten-/SSD-Gesundheit:** `df -h` regelmäßig prüfen (voller Datenträger), bei SD-Karten-Betrieb (siehe Hinweis in Abschnitt 1) auf ungewöhnliche Lese-/Schreibfehler in `dmesg` achten — ein frühes Warnzeichen für eine verschleißende Karte.
- Kein Hetzner-Cloud-„Monitoring" verfügbar — für einfache Erreichbarkeits-Überwachung von außen eignet sich ein kostenloser Uptime-Monitoring-Dienst (z. B. UptimeRobot), der periodisch `https://training.mein-verein.de/health` abruft und bei Ausfall benachrichtigt.

---

## 15. Kostenübersicht (grobe Richtwerte, Stand 2026)

| Posten | Kosten |
|---|---|
| Raspberry Pi 5 (4 GB) + Netzteil + Gehäuse + SD-Karte/SSD | ca. 80–100 € **einmalig** |
| Strom (Pi läuft 24/7, ca. 5–8 W Leistungsaufnahme) | ca. 1–2 €/**Monat** (stark abhängig vom lokalen Strompreis) |
| Dynamic DNS | meist kostenlos (DuckDNS, viele Router-integrierte Anbieter) |
| Domain | ca. 10–15 €/**Jahr** (identisch zu Hetzner-Variante) |
| SSL-Zertifikat (Let's Encrypt) | kostenlos |
| Offsite-Backup (optional, z. B. kleine Hetzner Storage Box) | ca. 1–4 €/Monat |
| **Laufende Kosten gesamt** | **ca. 1–3 €/Monat** + Domain (nach der einmaligen Hardware-Anschaffung) |

Anders als bei Hetzner gibt es keine monatliche Servermiete — dafür Anschaffungskosten am Anfang und das (kleine, aber vorhandene) Risiko eines Hardware-Defekts ohne den Komfort eines Cloud-Anbieters, der defekte Hardware im Hintergrund austauscht.

---

## 16. Kurze Fehlerbehebungs-Checkliste

| Symptom | Wahrscheinliche Ursache | Prüfen |
|---|---|---|
| Seite von außerhalb des Heimnetzes gar nicht erreichbar, im WLAN aber schon | Portweiterleitung fehlt/falsch, CGNAT, oder Dynamic DNS zeigt auf veraltete IP | Abschnitte 5.1/5.3/5.4 erneut durchgehen, Online-„Port Checker" für 80/443, `ping domain` mit dem in 5.1 notierten öffentlichen IP vergleichen |
| Seite lädt auch im Heimnetz gar nicht | DNS zeigt noch nicht auf die aktuelle IP / `ufw` blockiert | `ping domain`, `sudo ufw status` |
| „502 Bad Gateway" | Backend läuft nicht | `pm2 status`, `pm2 logs lane1-api` |
| Backend startet gar nicht (`pm2 status` zeigt „errored") | Pflicht-Umgebungsvariable fehlt/ungültig, z. B. `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in Produktion nicht gesetzt | `pm2 logs lane1-api` — `env.ts` gibt die genaue fehlende/ungültige Variable aus |
| Login/Registrierung liefert die HTML-Startseite statt einer Fehlermeldung/eines Tokens | `/auth/`-Location-Block in nginx fehlt oder `proxy_pass` mit abschließendem `/` (siehe Warnhinweis Abschnitt 9) | `curl -i .../auth/login -X POST -d '{}'`, Antwort auf `<!DOCTYPE html>` prüfen |
| Einladungs-E-Mails kommen nicht an | `SMTP_HOST` nicht gesetzt (nur Server-Log) | `pm2 logs lane1-api` auf SMTP-Fehler prüfen, `.env` kontrollieren |
| Kein Schloss-Symbol/HTTPS-Fehler | Zertifikat nicht erneuert, DNS falsch bei Erstanfrage, oder Portweiterleitung 80 fehlt(e) bei der Zertifikatsausstellung | `sudo certbot renew --dry-run`, Abschnitt 10 |
| Seite erreichbar, funktioniert aber nach ein paar Tagen plötzlich nicht mehr | Öffentliche IP hat sich geändert, Dynamic-DNS-Update fehlgeschlagen | in 5.1 beschriebenen IP-Vergleich wiederholen, DDNS-Client-Logs prüfen |
| Änderungen erscheinen nicht | Browser-/Service-Worker-Cache | Hard-Reload (`Strg+Shift+R`), `CACHE_VERSION` in `sw.js` prüfen |
| „Permission denied" bei SSH | falscher Benutzer/Key | Mit `deploy` statt `root` verbinden, richtigen Key prüfen |
| Pi reagiert plötzlich sehr langsam/hängt | Überhitzung (Thermal Throttling) oder verschleißende SD-Karte | `vcgencmd measure_temp`, `dmesg`, siehe Abschnitt 14 |
