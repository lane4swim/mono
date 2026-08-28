# Lane 1 in einer produktionsnahen Testumgebung auf macOS einrichten

**Für wen ist diese Anleitung?** Für jemanden, der Lane 1 auf dem eigenen Mac möglichst genauso betreiben möchte wie auf einem echten Server (`deployment.md`) — zum Testen, Vorführen oder Entwickeln mit realistischem Setup (echte PostgreSQL-Datenbank, echtes HTTPS, Nginx davor, PM2 im Hintergrund), aber **nicht** aus dem Internet erreichbar. Jeder Schritt wird erklärt — auch *warum* er nötig ist, nicht nur *wie*. Es wird nichts vorausgesetzt außer einem Mac und der Bereitschaft, Befehle in ein Terminal-Fenster einzutippen.

**Basis dieser Anleitung:** [`deployment.md`](./deployment.md) (Hetzner-Cloud-Variante). Wie schon bei [`deployment-raspberry-pi.md`](./deployment-raspberry-pi.md) gilt: **möglichst viel unverändert** übernehmen — gleiche Software, gleiche Konfiguration, gleiche (dort bereits gefundenen und behobenen) Stolperfallen. Abweichungen nur, wo eine lokale Testumgebung auf dem eigenen Mac es zwingend anders macht.

> **Wichtig — das hier ist bewusst KEIN Produktions-Deployment:** Diese Anleitung macht Lane 1 **nicht** aus dem Internet erreichbar (kein Portforwarding, keine echte Domain, kein Let's-Encrypt-Zertifikat). Alles läuft ausschließlich auf `127.0.0.1`/lokal auf dem eigenen Mac. Für einen echten, öffentlich erreichbaren Betrieb siehe `deployment.md` oder `deployment-raspberry-pi.md`.

---

## 0. Überblick: Was am Ende funktioniert

Am Ende dieser Anleitung ist unter `https://lane1.test` (rein lokal, nur auf dem eigenen Mac erreichbar) verfügbar:

- die Lane-1-Weboberfläche (installierbar als App, funktioniert offline),
- die dazugehörigen Hilfeseiten unter `/help/`,
- das Node.js-Backend mit einer echten lokalen PostgreSQL-Datenbank,
- echtes, vom Browser als vertrauenswürdig akzeptiertes HTTPS (über `mkcert`, siehe Abschnitt 10 — kein Zertifikatswarnhinweis wie bei einem simplen selbstsignierten Zertifikat),
- automatischer Neustart des Backends nach einem Neustart des Macs (über PM2, genau wie bei den anderen beiden Anleitungen).

### 0.1 Unterschiede zur Hetzner-Anleitung im Überblick

| Thema | Hetzner-Cloud-Variante | Diese macOS-Testumgebung |
|---|---|---|
| Erreichbarkeit | öffentlich aus dem Internet | **nur lokal**, ausschließlich auf dem eigenen Mac (`127.0.0.1`) |
| Server/Benutzer | separater Server, eigener `deploy`-Benutzer, SSH-Zugriff | der eigene Mac, das eigene Benutzerkonto — kein SSH, keine Benutzerverwaltung nötig |
| Paketverwaltung | `apt` (Ubuntu) | **[Homebrew](https://brew.sh)** |
| Domain/DNS | echte Domain, öffentlicher A-Record | **`lane1.test`** über einen lokalen `/etc/hosts`-Eintrag — keine echte Domain, kein DNS nötig |
| HTTPS-Zertifikat | Let's Encrypt (öffentlich vertrauenswürdig) | **`mkcert`** (lokal vertrauenswürdig, gleicher Effekt — kein Browser-Warnhinweis) |
| Firewall/Portfreigabe | `ufw` + Cloud-Firewall | **nicht nötig** — nichts wird nach außen exponiert |
| Backend/Nginx/PostgreSQL/PM2 | — | **identisch**, inkl. aller in `deployment.md` bereits gefundenen Bugfixes (Nginx-`/api/`+`/auth/`-Weiterleitung, PostgreSQL-15-Schema-Rechte, `prisma migrate deploy`) |
| Dienste starten/verwalten | `systemctl`/`sudo apt install` | `brew services` (nutzt intern `launchd`, das macOS-Gegenstück zu systemd) |

---

## 1. Voraussetzungen

- Ein Mac mit einer aktuellen macOS-Version (Apple Silicon **oder** Intel — beides funktioniert, alle unten verwendeten Pakete gibt es für beide Architekturen; nirgends wird Rosetta gebraucht).
- **Xcode-Kommandozeilentools** (werden von Homebrew und einigen npm-Paketen beim Bauen gebraucht):
  ```bash
  xcode-select --install
  ```
  Ein Dialogfenster öffnet sich, Installation bestätigen und abwarten.

- **[Homebrew](https://brew.sh)** installieren, falls noch nicht vorhanden:
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
  Am Ende der Installation gibt das Skript ein oder zwei Zeilen aus, die mit `echo` beginnen — diese **unbedingt ausführen** (fügt Homebrew zum `PATH` hinzu, auf Apple Silicon liegt Homebrew unter `/opt/homebrew`, auf Intel-Macs unter `/usr/local`). Danach prüfen:
  ```bash
  brew --version
  ```

> **Hinweis zu Pfaden in dieser Anleitung:** Weil Homebrew je nach Prozessor unter einem anderen Pfad installiert, verwenden alle Befehle unten `$(brew --prefix)` bzw. `$(brew --prefix <paket>)` statt eines fest eingetragenen Pfads — das funktioniert dadurch unverändert auf Apple Silicon **und** Intel-Macs.

---

## 2. Lokale „Domain" einrichten

Statt einer echten Domain mit öffentlichem DNS-Eintrag (wie bei Hetzner/Raspberry Pi) genügt für eine rein lokale Testumgebung ein Eintrag in der Datei `/etc/hosts`, der einen frei erfundenen Namen auf den eigenen Rechner (`127.0.0.1`) zeigen lässt:

```bash
echo "127.0.0.1 lane1.test" | sudo tee -a /etc/hosts
```

> **Warum `.test`?** Die Endung `.test` ist von der IANA offiziell für genau diesen Zweck reserviert ("special-use domain name") — sie wird nie an eine echte, öffentlich registrierbare Domain vergeben. Ein Tippfehler kann hier also nie versehentlich eine echte fremde Website betreffen, anders als z. B. bei einer erfundenen `.de`/`.com`-Adresse.

Prüfen:
```bash
ping -c 1 lane1.test
```
Sollte von `127.0.0.1` antworten.

---

## 3. Benötigte Software installieren

```bash
brew install node@22 postgresql@16 nginx git mkcert nss
```

- **`node@22`** — passend zur in `apps/api/package.json`/`package.json` geforderten Node-Version (`>=22.0.0`), gleiche Major-Version wie in den anderen beiden Anleitungen.
- **`postgresql@16`** — passend zu Ubuntu 24.04 (Hetzner-Anleitung) und aktuellem Raspberry Pi OS; die PostgreSQL-15+-Schema-Rechte-Besonderheit (siehe Abschnitt 6) betrifft diese Version genauso.
- **`nginx`** — liefert die Weboberfläche aus und leitet API-Anfragen weiter, wie bei den anderen beiden Anleitungen.
- **`mkcert`** (+ `nss`, falls auch Firefox getestet werden soll) — erzeugt ein lokal vertrauenswürdiges HTTPS-Zertifikat, siehe Abschnitt 10.

Node und PostgreSQL nach `brew`-Konvention zum `PATH` hinzufügen (Homebrew installiert versionierte Formeln standardmäßig nicht automatisch in den `PATH`, um Versionskonflikte zu vermeiden):
```bash
echo 'export PATH="$(brew --prefix node@22)/bin:$PATH"' >> ~/.zprofile
echo 'export PATH="$(brew --prefix postgresql@16)/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
node -v   # sollte v22.x anzeigen
```
(Verwendest du `bash` statt der macOS-Standardshell `zsh`, entsprechend `~/.bash_profile` statt `~/.zprofile`.)

**PM2** gibt es — wie bei den beiden anderen Anleitungen — nicht als Homebrew-Formel, sondern als npm-Paket:
```bash
npm install -g pm2
```
Mit Homebrew-Node ist dafür (anders als bei einer Ubuntu-Systeminstallation) **kein** `sudo` nötig — Homebrew installiert Node in ein Verzeichnis, auf das der eigene Benutzer bereits vollen Zugriff hat.

PostgreSQL und Nginx als Hintergrunddienste starten (Homebrews Entsprechung zu `systemctl enable --now`):
```bash
brew services start postgresql@16
```
Nginx wird **bewusst noch nicht** hier gestartet — dazu unten mehr (Abschnitt 9), da Nginx für Port 80/443 root-Rechte braucht.

---

## 4. Projekt auf den Mac holen

Identisch zu `deployment.md`, Abschnitt 7 (Variante A) — nur ohne SSH-Verbindung, da alles direkt auf dem eigenen Mac passiert:

```bash
cd ~
git clone https://github.com/DEIN-VEREIN/lane1.git
cd lane1
npm install
```
Führt npm dank der Workspace-Konfiguration für alle Pakete (`apps/web`, `apps/api`, `packages/*`) in einem Rutsch aus.

---

## 5. Umgebungsvariablen konfigurieren (`.env`)

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
Benutzerkonto auf diesem Rechner könnte den privaten Schlüssel lesen und
sich damit ein Access Token mit beliebiger Rolle (auch `superadmin`)
selbst signieren, ohne dass ein Login, ein Rate-Limit oder ein Logeintrag
das sichtbar machen würde (`app.authenticate` prüft ausschließlich die
Signatur, nie die Datenbank — siehe `apps/api/src/plugins/authenticate.ts`).
Analog zu `chmod 600 ~/.pgpass` (siehe `deployment.md`, Abschnitt 12.1),
dort für dasselbe Datenbank-Passwort.

`apps/api/.env.example` enthält bereits alle bekannten Variablen mit
Erklärung (vollständiges, verbindliches Schema samt Validierung:
`apps/api/src/config/env.ts`). Für die Testumgebung mindestens folgende
Werte setzen bzw. anpassen:
```
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://lane1_app:EIN-TESTPASSWORT-HIER@localhost:5432/lane1"
JWT_PRIVATE_KEY_FILE="<mit openssl erzeugen, siehe unten>"
JWT_PUBLIC_KEY_FILE="<mit openssl erzeugen, siehe unten>"
CORS_ORIGIN="https://lane1.test"
FRONTEND_BASE_URL="https://lane1.test"

# Sicherheitsreview 2026-08-27, Befund H1 — Nginx (Abschnitt 9 unten)
# läuft auf demselben Mac und ist der einzige tatsächliche
# Reverse-Proxy-Hop; PFLICHT bei NODE_ENV=production (siehe Hinweis
# unten).
TRUSTED_PROXY_IPS="127.0.0.1"
```

> **`NODE_ENV=production` auch hier?** Ja, bewusst — nur so entspricht die Testumgebung wirklich dem späteren Produktivbetrieb (u. a. sind `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` sowie `TRUSTED_PROXY_IPS` dann PFLICHT, siehe unten bzw. `deployment.md`, Abschnitt 7.2, statt automatisch generierter Wegwerf-Schlüssel bzw. eines leeren Werts wie bei `NODE_ENV=development`). Genau das ist der Sinn dieser Anleitung.

**SMTP (optional für eine reine Testumgebung):** Ohne `SMTP_HOST` wird eine Einladung nur ins Server-Log geschrieben statt tatsächlich per E-Mail versendet — für lokale Tests meist völlig ausreichend (der Einladungslink lässt sich trotzdem im Log bzw. direkt in der Nutzerverwaltungs-Oberfläche kopieren, siehe `apps/web/help/admin.html`). Soll der komplette Versandweg mitgetestet werden, denselben SMTP-Block wie in `deployment.md`, Abschnitt 7.2 eintragen.

**RS256-Schlüsselpaar erzeugen** (in Produktion — und damit auch hier, siehe Hinweis oben — PFLICHT). Das auf macOS vorinstallierte `openssl`-Kommando (LibreSSL-basiert) unterstützt die hier verwendeten Befehle vollständig — falls in einer künftigen macOS-Version doch einmal nicht, ersatzweise `brew install openssl@3` und `$(brew --prefix openssl@3)/bin/openssl` statt `openssl` verwenden.

**Empfohlen** (Sicherheitsreview 2026-08-28, Befund H2, Empfehlung 3):
das Schlüsselpaar direkt an seinem endgültigen Ort erzeugen, statt es
über eine `.env`-Zeile zu leiten — die Schlüsseldatei trägt dadurch
eigene, engere Dateirechte (`600`), unabhängig von der übrigen `.env`
(die u. a. auch das Datenbank-Passwort enthält):
```bash
mkdir -p apps/api/keys
chmod 700 apps/api/keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out apps/api/keys/jwt_private.pem
openssl pkey -in apps/api/keys/jwt_private.pem -pubout -out apps/api/keys/jwt_public.pem
chmod 600 apps/api/keys/jwt_private.pem
chmod 644 apps/api/keys/jwt_public.pem
```
In der `.env` dann nur den Pfad eintragen:
```
JWT_PRIVATE_KEY_FILE="/Users/<dein-benutzername>/lane1/apps/api/keys/jwt_private.pem"
JWT_PUBLIC_KEY_FILE="/Users/<dein-benutzername>/lane1/apps/api/keys/jwt_public.pem"
```
(Pfad an den tatsächlichen Ort deines Checkouts anpassen — `~/lane1` löst
`pm2`/andere Startmethoden je nach Arbeitsverzeichnis nicht immer korrekt
auf, ein absoluter Pfad ist robuster.) `apps/api/keys/` ist per
`.gitignore` bereits ausgeschlossen — dieser Ordner darf wie `.env`
niemals committet werden.

**Alternative** (falls eine separate Schlüsseldatei nicht praktikabel
ist): den PEM-Inhalt direkt als `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in die
`.env` schreiben, mit literalen `\n` statt echter Zeilenumbrüche:
```bash
awk 'BEGIN{ORS="\\n"} {print}' apps/api/keys/jwt_private.pem
awk 'BEGIN{ORS="\\n"} {print}' apps/api/keys/jwt_public.pem
```
Jede Ausgabe komplett kopieren und als Wert von `JWT_PRIVATE_KEY` bzw.
`JWT_PUBLIC_KEY` in Anführungszeichen einsetzen, und **nur in diesem
Fall** anschließend `apps/api/keys/` wieder löschen (`rm -rf
apps/api/keys`) — sonst liegt derselbe private Schlüssel doppelt vor. Je
Schlüssel darf **nur eine** der beiden Formen gesetzt sein
(`JWT_PRIVATE_KEY` **oder** `JWT_PRIVATE_KEY_FILE`, nie beide — `env.ts`
lehnt eine gleichzeitige Angabe sonst mit einer klaren Fehlermeldung ab).

---

## 6. Datenbank-Schema anlegen

Homebrew richtet PostgreSQL beim ersten Start (Abschnitt 3) automatisch mit einer Standarddatenbank ein, deren Eigentümer der eigene macOS-Benutzer ist — anders als bei `apt`, wo ein separater Systembenutzer `postgres` existiert. Ein `sudo -u postgres psql` wie in `deployment.md` ist hier deshalb **nicht** nötig — einfach direkt:
```bash
psql postgres
```
Innerhalb der PostgreSQL-Konsole (Prompt `postgres=#`):
```sql
CREATE DATABASE lane1;
CREATE USER lane1_app WITH ENCRYPTED PASSWORD 'EIN-TESTPASSWORT-HIER';
GRANT ALL PRIVILEGES ON DATABASE lane1 TO lane1_app;
\c lane1
GRANT ALL ON SCHEMA public TO lane1_app;
\q
```
Das Passwort muss zum in Schritt 5 eingetragenen `DATABASE_URL` passen.

> **Wichtig (PostgreSQL 15+, betrifft auch die hier installierte Version 16):** Seit
> PostgreSQL 15 hat nur noch der Datenbank-Eigentümer automatisch das Recht,
> im Schema `public` Tabellen anzulegen — `GRANT ALL PRIVILEGES ON DATABASE`
> allein reicht dafür **nicht** mehr. Ohne das zusätzliche `\c lane1` +
> `GRANT ALL ON SCHEMA public` oben bricht der nächste Befehl unten mit
> `permission denied for schema public` ab.

Schema anlegen:
```bash
cd apps/api
npx prisma migrate deploy
cd ../..
```
> Siehe `deployment.md`, Abschnitt 7.3 für die ausführliche Begründung
> (`migrate deploy` statt `db push` — Code-Review, Befund W5): das Projekt
> führt eine committete, reviewbare Migrationshistorie unter
> `apps/api/prisma/migrations/`.

---

## 7. Backend bauen

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
Der letzte Befehl erkennt auf macOS automatisch `launchd` (das macOS-Gegenstück zu `systemd`) und gibt eine Zeile mit `sudo` aus — diese **kopieren und einmal ausführen**. Damit startet das Backend automatisch neu, sobald sich der eigene macOS-Benutzer anmeldet (bzw. nach einem Neustart des Macs).

Kontrolle:
```bash
pm2 status
pm2 logs lane1-api
```

### 8.1 Ersten Superadmin anlegen (einmalig)

Identisch zu `deployment.md`, Abschnitt 8.1 — ohne diesen Schritt kann sich niemand einloggen:
```bash
cd apps/api
npm run create-superadmin -- --email=admin@test.lane1.test --password='EIN-TESTPASSWORT' --name="Test Admin"
cd ../..
```
Mit diesem Konto danach unter `https://lane1.test/admin` anmelden und dort den ersten (Test-)Verein anlegen.

---

## 9. Nginx konfigurieren

Homebrews Nginx-Formel bindet standardmäßig nicht Port 80/443 (die klassischen privilegierten Ports unter 1024 dürfen unter macOS wie unter Linux nur von `root` gebunden werden) — Homebrews eigener Standard-Port ist deshalb `8080`. Um möglichst nah an `deployment.md` zu bleiben (Adresse **ohne** Portangabe, also `https://lane1.test` statt `https://lane1.test:8443`), wird Nginx hier bewusst **als Root-Dienst** gestartet (siehe Ende dieses Abschnitts) — das ist bei Homebrew über `sudo brew services` vorgesehen und genau dafür gedacht.

Konfigurationsdatei anlegen — Homebrews Nginx lädt standardmäßig automatisch alle Dateien aus `servers/` (kein manuelles Verlinken wie bei `sites-available`/`sites-enabled` unter Ubuntu nötig):
```bash
nano "$(brew --prefix nginx)/etc/nginx/servers/lane1.conf"
```
Inhalt (`DEIN-BENUTZERNAME` durch `whoami` ersetzen, bzw. den kompletten Pfad zu `apps/web` anpassen):
```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name lane1.test;

    ssl_certificate     /Users/DEIN-BENUTZERNAME/lane1/lane1.test.pem;
    ssl_certificate_key /Users/DEIN-BENUTZERNAME/lane1/lane1.test-key.pem;

    # Weboberfläche (PWA) als statische Dateien ausliefern
    root /Users/DEIN-BENUTZERNAME/lane1/apps/web;
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

    # Health-Check-Endpunkt
    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```
> **Wichtig — `proxy_pass` bewusst OHNE abschließenden Schrägstrich (bei
> `/api/` und `/auth/`):** siehe ausführliche Begründung in `deployment.md`,
> Abschnitt 9 — kurz: mit abschließendem `/` würde nginx das jeweilige
> Präfix beim Weiterleiten entfernen, das Backend erwartet den Pfad aber
> unverändert inkl. Präfix.

Die Zeilen `ssl_certificate`/`ssl_certificate_key` verweisen auf die Dateien, die im nächsten Abschnitt (10) mit `mkcert` erzeugt werden — dieser Abschnitt daher **vor** dem ersten Start von Nginx durchführen.

Konfiguration testen und Nginx **als Root** starten (siehe Erklärung oben — nötig für Port 80/443):
```bash
"$(brew --prefix nginx)/bin/nginx" -t
sudo brew services start nginx
```
Die Ausgabe von `nginx -t` sollte `syntax is ok` und `test is successful` melden.

> Nach jeder künftigen Änderung an `lane1.conf`: `sudo nginx -s reload` (oder `sudo brew services restart nginx`).

---

## 10. Lokal vertrauenswürdiges HTTPS-Zertifikat mit `mkcert`

Anders als bei einer öffentlichen Domain gibt es für `lane1.test` kein Let's-Encrypt-Zertifikat (Let's Encrypt stellt nur für öffentlich auflösbare Domains aus). `mkcert` löst das für lokale Testumgebungen elegant: Es legt eine eigene, lokale Zertifizierungsstelle (CA) an und installiert sie in den Vertrauensspeicher von macOS/Browsern — danach werden von dieser CA ausgestellte Zertifikate genauso anstandslos akzeptiert wie ein „echtes" Let's-Encrypt-Zertifikat, ganz ohne Warnhinweis im Browser.

Einmalig, die lokale CA installieren:
```bash
mkcert -install
```
(Bei Safari/Chrome reicht das aus. Für Firefox — bringt einen eigenen Zertifikatsspeicher mit — wurde oben bereits `nss` mitinstalliert, das `mkcert -install` automatisch mitnutzt.)

Zertifikat für `lane1.test` erzeugen (im Projektordner, damit es zu den Pfaden in der Nginx-Config aus Abschnitt 9 passt):
```bash
cd ~/lane1
mkcert lane1.test
```
Erzeugt `lane1.test.pem` (Zertifikat) und `lane1.test-key.pem` (privater Schlüssel) im aktuellen Ordner — genau die beiden Dateien, auf die die Nginx-Konfiguration aus Abschnitt 9 verweist.

> **Diese Dateien nicht committen** — `*.pem` ist bereits über die bestehende `.gitignore`-Regel `*.log` NICHT automatisch ausgeschlossen; sicherheitshalber selbst darauf achten, sie nicht versehentlich per `git add` einzuchecken (privater Schlüssel, auch wenn er nur lokal gültig ist).

Nach `nginx -s reload` (siehe Ende Abschnitt 9) ist `https://lane1.test` ab jetzt mit Schloss-Symbol ohne jede Warnung erreichbar.

---

## 11. Testen

- `https://lane1.test` im Browser öffnen, Installierbarkeit prüfen (Browser bietet "App installieren" an).
- Schloss-Symbol in der Adressleiste prüfen — **kein** Zertifikatswarnhinweis (dank `mkcert`).
- WLAN kurz ausschalten und testen, dass die App weiterhin funktioniert (Offline-first) — funktioniert trotz reinem Lokalbetrieb genauso wie bei einer echten Domain, da der Service Worker unabhängig von der Erreichbarkeit im Internet arbeitet.
- `https://lane1.test/help/` öffnen und prüfen, dass die Kurzanleitung (nicht die App) angezeigt wird; ebenso `/help/faq.html` und `/help/admin.html`.
- `curl -i https://lane1.test/health` prüfen (`200 OK`, `{"status":"ok",...}`).
- Login testen (Konto aus Schritt 8.1), danach in der Sync-Warteschlange „Jetzt synchronisieren" auslösen.
- Bei Problemen:
  ```bash
  pm2 logs lane1-api
  tail -f "$(brew --prefix nginx)/var/log/nginx/error.log"
  "$(brew --prefix nginx)/bin/nginx" -t
  ```

---

## 12. Backups (optional, aber praktisch für wiederkehrende Tests)

Für eine reine Testumgebung ist ein vollwertiges Backup-Konzept wie in `deployment.md` (Offsite-Kopien, DSGVO-Fristen) meist nicht nötig — trotzdem praktisch, wenn Testdaten (angelegte Vereine, Konten, Trainingspläne) nicht bei jedem Neuaufsetzen verloren gehen sollen:

```bash
mkdir -p ~/lane1-backups
"$(brew --prefix postgresql@16)/bin/pg_dump" -h 127.0.0.1 -U lane1_app lane1 > ~/lane1-backups/lane1-$(date +%F).sql
```
Wiederherstellen (z. B. nach einem `prisma migrate reset`, das versehentlich Testdaten gelöscht hat):
```bash
"$(brew --prefix postgresql@16)/bin/psql" -h 127.0.0.1 -U lane1_app lane1 < ~/lane1-backups/lane1-2026-08-17.sql
```

Für einen automatisierten täglichen Lauf per `cron` gilt derselbe Hinweis wie in `deployment.md`, Abschnitt 12.1 (`-h 127.0.0.1` statt Unix-Socket, damit die passwortbasierte statt der `peer`-Authentifizierung greift, plus `~/.pgpass`) — **zusätzlich** unter macOS zu beachten:

> **macOS-Besonderheit — `cron` braucht „Vollzugriff auf die Festplatte":** Seit macOS Catalina blockiert das Betriebssystem (TCC/„TCC" = Transparency, Consent, and Control) Hintergrundprozessen wie `cron` standardmäßig den Zugriff auf viele Ordner — ein Cronjob kann dadurch lautlos fehlschlagen, obwohl er von Hand im Terminal einwandfrei funktioniert. Falls ein `crontab`-Eintrag nicht wie erwartet läuft: **Systemeinstellungen → Datenschutz & Sicherheit → Vollständiger Festplattenzugriff** öffnen und dort `/usr/sbin/cron` (bzw. das Terminal-Programm, über das `crontab -e` aufgerufen wurde) hinzufügen.

---

## 13. Künftige Updates ausrollen

Identisch zu `deployment.md`, Abschnitt 13:
```bash
cd ~/lane1
git pull
npm install
cd apps/api && npx prisma migrate deploy && cd ../..
npm run build --workspace=apps/api
pm2 restart lane1-api
sudo nginx -s reload
```

> **Update auf/nach Sicherheitsreview 2026-08-27, Befund H1:** siehe
> `deployment.md`, Abschnitt 13 — vor dem ersten `pm2 restart` nach diesem
> Update einmalig `TRUSTED_PROXY_IPS="127.0.0.1"` an `apps/api/.env`
> anhängen, sonst bricht der Neustart mit einer klaren Fehlermeldung ab.

---

## 14. Laufende Wartung

- `brew update && brew upgrade` — regelmäßig, aktualisiert Homebrew-Pakete (Node, PostgreSQL, Nginx, …).
- `brew services list` — zeigt den Status aller über Homebrew verwalteten Hintergrunddienste (Entsprechung zu `systemctl status`/`pm2 status`).
- `pm2 status` / `pm2 monit` — Backend-Prozess im Blick behalten.
- Zertifikate von `mkcert` sind standardmäßig **lange gültig** (mehrere Jahre) — anders als Let's-Encrypt-Zertifikate (90 Tage) ist hier keine automatische Erneuerung nötig.

---

## 15. Testdaten zurücksetzen

Praktisch für eine Testumgebung, die es bei einer echten Server-Anleitung so nicht braucht — die Datenbank zurücksetzen, ohne App/Konfiguration anzufassen (z. B. um wieder bei einem leeren Verein anzufangen):
```bash
cd ~/lane1/apps/api
npx prisma migrate reset --force --skip-seed
cd ../..
```
Löscht den gesamten Datenbankinhalt, legt die Datenbank neu an und wendet die
committete Migrationshistorie erneut vollständig an (`--force` unterdrückt die
interaktive Sicherheitsabfrage, `--skip-seed` lässt die Datenbank wie zuvor
leer statt automatisch Demo-Daten einzufügen) — Schritt 8.1 (Superadmin
anlegen) muss danach wiederholt werden.

Soll die Testumgebung nicht nur zurückgesetzt, sondern komplett entfernt werden, siehe Abschnitt 17.

---

## 16. Kurze Fehlerbehebungs-Checkliste

| Symptom | Wahrscheinliche Ursache | Prüfen |
|---|---|---|
| `lane1.test` löst nicht auf | `/etc/hosts`-Eintrag fehlt/falsch (Abschnitt 2) | `cat /etc/hosts \| grep lane1.test`, `ping -c 1 lane1.test` |
| Browser zeigt Zertifikatswarnung | `mkcert -install` nicht ausgeführt, oder Zertifikat für falschen Namen erzeugt | `mkcert -install` erneut ausführen, `mkcert lane1.test` erneut ausführen, Browser neu starten |
| `nginx: [emerg] bind() to 0.0.0.0:80 failed (13: Permission denied)` | Nginx wurde ohne `sudo` gestartet (Port < 1024 braucht root) | `sudo brew services start nginx` statt `brew services start nginx` |
| „502 Bad Gateway" | Backend läuft nicht | `pm2 status`, `pm2 logs lane1-api` |
| Backend startet gar nicht (`pm2 status` zeigt „errored") | Pflicht-Umgebungsvariable fehlt/ungültig, z. B. `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (`NODE_ENV=production`, siehe Hinweis Abschnitt 5) | `pm2 logs lane1-api` — `env.ts` gibt die genaue fehlende/ungültige Variable aus |
| Login/Registrierung liefert die HTML-Startseite statt einer Fehlermeldung/eines Tokens | `/auth/`-Location-Block in nginx fehlt oder `proxy_pass` mit abschließendem `/` (siehe Warnhinweis Abschnitt 9) | `curl -i https://lane1.test/auth/login -X POST -d '{}'`, Antwort auf `<!DOCTYPE html>` prüfen |
| `psql: error: connection to server ... failed: FATAL: role "lane1_app" does not exist` | Schritt 6 (Datenbank/Benutzer anlegen) übersprungen oder in falscher Datenbank ausgeführt | `psql postgres` → `\du` (zeigt vorhandene Rollen), `\l` (zeigt vorhandene Datenbanken) |
| `command not found: node`/`psql`/`pg_dump` | `$(brew --prefix ...)/bin` nicht im `PATH` (Abschnitt 3) | `echo $PATH`, `~/.zprofile` erneut prüfen/`source`n |
| Cronjob läuft von Hand, aber nicht automatisch | macOS-TCC blockiert `cron` (siehe Hinweis Abschnitt 12) | Systemeinstellungen → Datenschutz & Sicherheit → Vollständiger Festplattenzugriff |
| Änderungen erscheinen nicht | Browser-/Service-Worker-Cache | Hard-Reload (`Cmd+Shift+R`), `CACHE_VERSION` in `sw.js` prüfen |

---

## 17. Deinstallation — den Mac wieder in den ursprünglichen Zustand versetzen

Diese Anleitung hat mehrere Spuren auf dem System hinterlassen — vom Projektordner über Hintergrunddienste bis hin zu einer lokal als vertrauenswürdig installierten Zertifizierungsstelle. Dieser Abschnitt geht sie **in der richtigen Reihenfolge** rückwärts durch (immer zuerst laufende Dienste stoppen, danach erst Konfiguration/Daten löschen — sonst können einzelne Befehle fehlschlagen oder verwaiste Prozesse zurückbleiben). Er ist in Stufen aufgeteilt: **Stufe 1–3 sollte jede/r durchgehen**, der/die die Testumgebung wieder loswerden will. **Stufe 4** ist nur sinnvoll, wenn Homebrew/die Command Line Tools ausschließlich für dieses Projekt installiert wurden.

### 17.1 Stufe 1 — Anwendung stoppen und Autostart entfernen

```bash
pm2 delete lane1-api
pm2 unstartup
```
`pm2 unstartup` entfernt den in Schritt 8 eingerichteten Autostart-Dienst (das von `pm2 startup` unter `~/Library/LaunchAgents/` bzw. `/Library/LaunchDaemons/` angelegte `launchd`-Plist) — gibt der Befehl dabei erneut eine mit `sudo` beginnende Zeile aus, diese **kopieren und ausführen**, sonst bleibt der Autostart-Eintrag bestehen.

```bash
sudo brew services stop nginx
brew services stop postgresql@16
```
Nginx wurde in Schritt 9 bewusst **als Root-Dienst** gestartet (`sudo brew services start nginx`) — deshalb hier auch `sudo` beim Stoppen, sonst bleibt der (dann verwaiste) Root-Prozess weiterlaufen und der nächste `brew`-Befehl meldet ihn fälschlich als „gestoppt", obwohl er es nicht ist.

Kontrolle — es sollte nichts mehr laufen:
```bash
brew services list
pm2 status
```

### 17.2 Stufe 2 — Projektbezogene Konfiguration und Daten entfernen

```bash
rm "$(brew --prefix nginx)/etc/nginx/servers/lane1.conf"
sudo sed -i '' '/lane1\.test/d' /etc/hosts
rm -rf ~/lane1 ~/lane1-backups ~/.pm2
```
- `~/.pm2` enthält PM2s eigene Konfiguration, Logs und den in Schritt 8 gespeicherten Prozess-Snapshot (`pm2 save`) — ohne diesen Schritt bliebe eine (dann bedeutungslose) Erinnerung an `lane1-api` zurück.
- `~/lane1` enthält auch die mit `mkcert` erzeugten Zertifikatsdateien aus Schritt 10 — mit dem Ordner sind die gelöscht. Die zugrundeliegende **lokale Zertifizierungsstelle** selbst (die `mkcert -install` systemweit als vertrauenswürdig hinterlegt hat) ist davon **nicht** betroffen — dafür der nächste Schritt.

**Lokale Zertifizierungsstelle wieder als nicht vertrauenswürdig markieren** (Gegenstück zu `mkcert -install` aus Schritt 10 — ohne diesen Schritt bliebe eine private Root-CA dauerhaft im Vertrauensspeicher von macOS/Browsern, die (nur auf diesem Mac) beliebige weitere Zertifikate ausstellen könnte; das ist der sicherheitsrelevanteste Aufräumschritt in dieser Anleitung):
```bash
mkcert -uninstall
```

PostgreSQL-Rolle und -Datenbank entfernen:
```bash
psql postgres -c "DROP DATABASE IF EXISTS lane1;"
psql postgres -c "DROP USER IF EXISTS lane1_app;"
```

Prüfen, dass Nginx tatsächlich sauber ohne die entfernte Konfigurationsdatei startet, falls es später doch wieder gebraucht wird:
```bash
"$(brew --prefix nginx)/bin/nginx" -t
```

### 17.3 Stufe 3 — Homebrew-Pakete entfernen

```bash
brew uninstall node@22 postgresql@16 nginx mkcert nss
npm uninstall -g pm2
```
> **Wichtig — `brew uninstall postgresql@16` löscht NICHT automatisch die
> Datenbank-Dateien** (Paketmanager entfernen aus Sicherheitsgründen so
> gut wie nie automatisch Nutzdaten, nur das Programm selbst). Der
> eigentliche Datenordner liegt unter `$(brew --prefix)/var/postgresql@16`
> — falls dieser Pfad nach dem Uninstall noch existiert und wirklich
> nichts davon gebraucht wird (z. B. Daten anderer, hier nicht
> beschriebener lokaler Projekte!), zusätzlich:
> ```bash
> rm -rf "$(brew --prefix)/var/postgresql@16"
> ```

`git` wurde in Schritt 3 zwar mitinstalliert, aber bewusst **nicht** oben mit entfernt — es wird auf praktisch jedem Entwickler-Mac ohnehin für andere Zwecke gebraucht (bzw. liegt über die Xcode-Kommandozeilentools sowieso schon vor, siehe unten); bei Bedarf trotzdem möglich mit `brew uninstall git`.

In Schritt 3 wurden außerdem zwei Zeilen an `~/.zprofile` (bzw. `~/.bash_profile`) angehängt, um Node/PostgreSQL in den `PATH` aufzunehmen — diese von Hand entfernen:
```bash
nano ~/.zprofile
```
Die beiden Zeilen suchen und löschen:
```
export PATH="$(brew --prefix node@22)/bin:$PATH"
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
```
(Hier stehen die tatsächlich aufgelösten Pfade, nicht der `$(...)`-Ausdruck selbst — z. B. `/opt/homebrew/opt/node@22/bin` auf Apple Silicon.)

Aufräumen der von Homebrew zurückgelassenen heruntergeladenen Archive/alten Versionen (optional, betrifft nicht nur dieses Projekt):
```bash
brew cleanup
```

### 17.4 Stufe 4 (optional, nur falls ausschließlich für dieses Projekt installiert) — Homebrew und Xcode-Kommandozeilentools

**Nur durchführen, wenn Homebrew und/oder die Xcode-Kommandozeilentools sonst für nichts anderes auf diesem Mac verwendet werden** — beides sind grundlegende, oft von vielen anderen Programmen/Projekten mitbenutzte Werkzeuge; sie zu entfernen kann andere, hier nicht beschriebene Software auf demselben Mac beeinträchtigen.

Homebrew vollständig entfernen (offizielles Deinstallationsskript, Gegenstück zum Installationsbefehl aus Abschnitt 1):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"
```

Xcode-Kommandozeilentools entfernen:
```bash
sudo rm -rf /Library/Developer/CommandLineTools
```

Damit ist der Mac wieder in dem Zustand, in dem er vor Beginn dieser Anleitung war.
