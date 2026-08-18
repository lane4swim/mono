# Lane 1 testweise über GitHub Codespaces betreiben — Schritt-für-Schritt-Anleitung

**Für wen ist diese Anleitung?** Für einen kurzen Testlauf oder eine Demo direkt aus dem Repository heraus — ganz ohne eigenen Server, eigene Domain oder Portfreigabe im Heimnetz. Jeder Schritt wird erklärt — auch *warum* er nötig ist, nicht nur *wie*. Vorausgesetzt wird nur ein GitHub-Konto mit Zugriff auf dieses Repository und ein Browser.

**Basis dieser Anleitung:** [`deployment.md`](./deployment.md) (Hetzner-Cloud-Variante). Wie schon bei [`deployment-raspberry-pi.md`](./deployment-raspberry-pi.md) und [`deployment-macos.md`](./deployment-macos.md) gilt: **möglichst viel unverändert** übernehmen — gleiche Software, gleiche Konfiguration, gleiche (dort bereits gefundenen und behobenen) Stolperfallen. Abgewichen wird nur, wo Codespaces es zwingend anders macht — und das ist an mehreren Stellen spürbar **einfacher** als bei den anderen drei Varianten, siehe [0.1](#01-unterschiede-zur-hetzner-anleitung-im-überblick).

> **Wichtig — das hier ist bewusst KEIN dauerhaftes Deployment:** Ein Codespace ist für Entwicklung/Tests gedacht, nicht für Produktivbetrieb. Er hält automatisch nach Inaktivität an, verbraucht laufend Nutzungskontingent, und die öffentliche Adresse ändert sich mit jedem neuen Codespace. Für echten, dauerhaften Betrieb siehe `deployment.md` oder `deployment-raspberry-pi.md`.

---

## 0. Überblick: Was am Ende funktioniert

Am Ende dieser Anleitung ist unter einer von GitHub bereitgestellten, temporären HTTPS-Adresse (z. B. `https://verschwommen-code-abcd-8080.app.github.dev`) erreichbar:

- die Lane-1-Weboberfläche (installierbar als App, funktioniert offline),
- die dazugehörigen Hilfeseiten unter `/help/`,
- das Node.js-Backend mit einer echten PostgreSQL-Datenbank — alles **innerhalb desselben Codespace**, nichts davon verlässt die temporäre Umgebung,
- HTTPS **automatisch und kostenlos** über GitHubs Weiterleitung (kein eigenes Zertifikat nötig),
- alles verschwindet spurlos, sobald der Codespace gelöscht wird.

### 0.1 Unterschiede zur Hetzner-Anleitung im Überblick

| Thema | Hetzner-Cloud-Variante | Diese Codespaces-Variante |
|---|---|---|
| Umgebung | gemietete Cloud-VM, dauerhaft | von GitHub bereitgestellter Cloud-Container, **temporär** (hält nach 30 Min. Inaktivität automatisch an) |
| Zugriff | SSH mit eigenem Schlüsselpaar | Terminal direkt im Browser/VS Code, kein SSH nötig |
| Benutzer/Rechte | eigener `deploy`-Benutzer wird angelegt | vorkonfigurierter Benutzer `vscode` mit passwortlosem `sudo` — kein Einrichtungsschritt nötig |
| Projekt auf den Server bringen | `git clone` als eigener Schritt | Repository liegt beim Öffnen des Codespace bereits vollständig im Arbeitsverzeichnis |
| Domain/DNS/Zertifikat | echte Domain, A-Record, Let's-Encrypt-Zertifikat | **entfällt komplett** — GitHub stellt automatisch eine `*.app.github.dev`-Adresse mit gültigem HTTPS-Zertifikat bereit |
| „Firewall"/Portfreigabe | `ufw` + Cloud-Firewall | Sichtbarkeit des weitergeleiteten Ports (Privat/Organisation/Öffentlich) im Ports-Tab — GitHub regelt den Zugriff, kein eigenes Netzwerk zu härten |
| Backend/Nginx/PostgreSQL | — | **identisch**, inkl. aller in `deployment.md` bereits gefundenen Bugfixes (Nginx-`/api/`+`/auth/`-Weiterleitung, PostgreSQL-15-Schema-Rechte, `prisma db push`) |
| Autostart nach Neustart | `pm2 startup` (systemd) | **entfällt** — Codespaces-Container laufen ohne `systemd`; nach jedem Anhalten/Fortsetzen des Codespace werden PostgreSQL/Backend/Nginx stattdessen mit ein paar Befehlen neu gestartet (siehe Abschnitt 13) |
| Backups/DSGVO-Löschfristen | eingerichtet | **entfällt bewusst** — reine Testdaten in einer temporären Umgebung, kein echter Nutzerbetrieb |
| Laufende Kosten | ca. 5–6 €/Monat + Domain | nutzungsabhängiges Kontingent (Core-Stunden/Speicher), oft im kostenlosen Kontingent des GitHub-Kontos enthalten (siehe Abschnitt 15) |

---

## 1. Voraussetzungen

- Ein **GitHub-Konto** mit Lese-/Schreibzugriff auf dieses Repository.
- Ein aktueller Browser (Codespaces läuft vollständig im Browser über eine VS-Code-Oberfläche — die Desktop-App VS Code mit der „GitHub Codespaces"-Erweiterung geht als Alternative genauso).
- Codespaces ist Teil des GitHub-Kontos und nutzt ein monatliches Kontingent an Core-Stunden/Speicher — für die eigentliche Nutzung ist nichts zu installieren, siehe Kostenübersicht (Abschnitt 15).

---

## 2. Codespace erstellen

1. Im Repository auf GitHub oben auf den grünen **„Code"**-Button klicken.
2. Reiter **„Codespaces"** wählen.
3. **„Create codespace on `<branch>`"** klicken (den gewünschten Branch vorher oben im Repository auswählen — für einen reinen Test reicht der Standard-Branch).
4. Für die Maschinengröße (Zahnrad-Symbol neben dem Erstellen-Button, „Change options" bzw. „New with options") reicht die kleinste verfügbare Option (üblicherweise **2-Core/8 GB RAM**) — genau wie bei der Hetzner-CX22-Empfehlung reichen 2 vCPU/4–8 GB für Node.js-API, PostgreSQL-Datenbank und das Ausliefern der Weboberfläche gleichzeitig locker aus.
5. GitHub baut daraufhin automatisch einen Container auf, klont das Repository hinein und öffnet eine vollständige VS-Code-Oberfläche im Browser — das dauert je nach Auslastung ein bis zwei Minuten.

> **Hinweis:** Welche Maschinengrößen zur Auswahl stehen, hängt vom eigenen Konto/der Organisation ab. Im Zweifel die kleinste verfügbare Option wählen — für dieses Projekt reicht sie.

---

## 3. Terminal öffnen

Im Browser-VS-Code oben im Menü **„Terminal" → „New Terminal"** (oder Tastenkürzel `` Strg+` ``). Das Terminal ist bereits im Projektordner geöffnet — kein SSH, kein Login, keine IP-Adresse nötig. Alle folgenden Befehle werden hier eingegeben.

Aktuellen Ordner und Repository-Namen einmal notieren (wird für die Nginx-Konfiguration in Schritt 10 gebraucht):
```bash
pwd
```

---

## 4. Benötigte Software installieren

Der Codespace-Benutzer `vscode` hat bereits passwortlosen `sudo`-Zugriff — kein eigener Benutzer, keine Firewall-Härtung, kein SSH-Setup nötig (siehe Vergleichstabelle oben).

### 4.1 Node.js

Erst prüfen, was im Codespace-Basisimage bereits vorinstalliert ist:
```bash
node -v
```
Das Projekt verlangt laut `package.json` (`engines.node`) nur **mindestens** Version 22 — jede neuere Version erfüllt das ebenfalls. Codespaces-Basisimages bringen über `nvm` meist bereits eine aktuelle Node-Version mit (z. B. `v24.x`), die diese Anforderung schon erfüllt — dann ist **kein weiterer Schritt nötig**, mit dieser Version direkt weitermachen.

Zeigt `node -v` dagegen **gar keine** Version oder etwas **älter als v22**, Node explizit über NodeSource nachinstallieren:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
hash -r
node -v
```
> **Warum reicht ein einfaches `apt install` danach nicht immer?** Ist bereits eine über `nvm` verwaltete Node-Version aktiv, hängt deren Verzeichnis typischerweise weiter vorn im `PATH` als `/usr/bin` — `node -v` würde dann weiterhin die alte `nvm`-Version zeigen, obwohl die NodeSource-Installation erfolgreich war (`hash -r` erzwingt nur, dass die Shell ihren Befehls-Cache neu aufbaut, ändert aber nichts an der `PATH`-Reihenfolge selbst). In dem Fall entweder `nvm use 22` (falls `nvm` vorhanden) oder `/usr/bin/node`/`/usr/bin/npm` explizit statt `node`/`npm` verwenden.

### 4.2 PostgreSQL (Datenbank für das Backend)
```bash
sudo apt install -y postgresql
sudo service postgresql start
```
> **Wichtig — `service` statt `systemctl`:** Codespaces-Container laufen ohne `systemd` als Init-System (typisch für Docker-basierte Entwicklungsumgebungen) — `sudo systemctl start postgresql` würde mit „Failed to connect to bus" fehlschlagen. Der klassische `service`-Befehl (spricht direkt die Init-Skripte an) funktioniert dagegen problemlos. Gilt für den ganzen Rest dieser Anleitung: überall `service` statt `systemctl`.

```bash
sudo su - postgres -c psql
```
> **Warum nicht `sudo -u postgres psql`?** Auf manchen Codespaces-Images ist das für den eigenen Benutzer (`vscode` o. ä.) nicht ohne Passwort erlaubt — `sudo` fragt dann nach dem Passwort **des eigenen Benutzers**, nicht nach einem Datenbank-Passwort. Da für diesen Benutzer in Codespaces aber gar kein Passwort gesetzt ist, schlägt jede Eingabe mit „Sorry, try again" fehl, egal was eingetippt wird. Reines `sudo` (ohne `-u <anderer-benutzer>`, also als root) ist dagegen ohne Passwort erlaubt — der Befehl oben nutzt das aus: `sudo` startet `su - postgres -c psql` als root, und root darf mit `su` ohne Passwort zu jedem Benutzer wechseln.

Innerhalb der PostgreSQL-Konsole (Prompt `postgres=#`):
```sql
CREATE DATABASE lane1;
CREATE USER lane1_app WITH ENCRYPTED PASSWORD 'EIN-TESTPASSWORT-HIER';
GRANT ALL PRIVILEGES ON DATABASE lane1 TO lane1_app;
\c lane1
GRANT ALL ON SCHEMA public TO lane1_app;
\q
```
**Das Passwort notieren** — es wird gleich in der `.env`-Datei gebraucht.

> **Wichtig (PostgreSQL 15+):** Seit PostgreSQL 15 hat nur noch der Datenbank-Eigentümer automatisch das Recht, im Schema `public` Tabellen anzulegen — `GRANT ALL PRIVILEGES ON DATABASE` allein reicht dafür **nicht** mehr. Ohne das zusätzliche `\c lane1` + `GRANT ALL ON SCHEMA public` oben bricht Schritt 7 (`prisma db push`) mit `permission denied for schema public` ab.

### 4.3 Nginx (liefert die Weboberfläche aus und leitet API-Anfragen weiter)
```bash
sudo apt install -y nginx
sudo service nginx stop
```
(Direkt wieder anhalten — Nginx läuft mit der Standardkonfiguration und würde sonst Port 80 belegen, den wir hier gar nicht brauchen; die eigene Konfiguration kommt in Schritt 10.)

### 4.4 PM2 (hält das Node.js-Backend während der Codespace-Sitzung am Laufen)
```bash
sudo npm install -g pm2
```

Git ist im Codespace bereits vorinstalliert, ein separater Schritt zum „Projekt auf den Server bringen" entfällt (siehe Abschnitt 5).

---

## 5. Projekt-Abhängigkeiten installieren

Das Repository liegt bereits vollständig im Arbeitsverzeichnis (siehe Schritt 3) — nur die npm-Abhängigkeiten fehlen noch:
```bash
npm install
```
Führt npm dank der Workspace-Konfiguration für alle Pakete (`apps/web`, `apps/api`, `packages/*`) in einem Rutsch aus.

---

## 6. Umgebungsvariablen konfigurieren (`.env`)

```bash
cp apps/api/.env.example apps/api/.env
```

Bevor die Datei bearbeitet wird: die spätere öffentliche Adresse berechnen. Codespaces stellt dafür den Namen des eigenen Codespace automatisch als Umgebungsvariable bereit — Port `8080` ist der in Schritt 10 verwendete Nginx-Port:
```bash
echo "https://${CODESPACE_NAME}-8080.app.github.dev"
```
Die Ausgabe kopieren (wird gleich zweimal gebraucht) — genau dieselbe Adresse taucht später auch im „Ports"-Tab auf (siehe Schritt 11), falls hier etwas nicht zusammenpasst, gilt die dort angezeigte Adresse.

```bash
nano apps/api/.env
```
`apps/api/.env.example` enthält bereits alle bekannten Variablen mit
Erklärung (vollständiges, verbindliches Schema samt Validierung:
`apps/api/src/config/env.ts`). Mindestens folgende Werte setzen bzw. anpassen:
```
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://lane1_app:EIN-TESTPASSWORT-HIER@localhost:5432/lane1"
JWT_SIGNING_KEY="<mit openssl erzeugen, siehe unten>"
JWT_PRIVATE_KEY="<mit openssl erzeugen, siehe unten>"
JWT_PUBLIC_KEY="<mit openssl erzeugen, siehe unten>"
CORS_ORIGIN="https://DEIN-CODESPACE-NAME-8080.app.github.dev"
FRONTEND_BASE_URL="https://DEIN-CODESPACE-NAME-8080.app.github.dev"
```
(`CORS_ORIGIN`/`FRONTEND_BASE_URL`: die oben berechnete Adresse einsetzen, **ohne** abschließenden Schrägstrich.)

**SMTP (optional für einen reinen Test):** Ohne `SMTP_HOST` wird eine Einladung nur ins Server-Log geschrieben statt tatsächlich per E-Mail versendet — für einen Testlauf meist ausreichend (der Einladungslink lässt sich trotzdem direkt in der Nutzerverwaltungs-Oberfläche kopieren, siehe `apps/web/help/admin.html`). Soll der komplette Versandweg mitgetestet werden, denselben SMTP-Block wie in `deployment.md`, Abschnitt 7.2 eintragen — inklusive des dortigen Warnhinweises zu `SMTP_SECURE` (**nicht** explizit auf `false` setzen). Ein Hinweis speziell für Cloud-Umgebungen wie Codespaces: Manche Cloud-Anbieter sperren ausgehende Verbindungen auf klassischen Mail-Ports (25/465) zur Spam-Prävention — Port 587 (wie im SMTP-Block vorgesehen) ist davon in aller Regel nicht betroffen; schlägt der Versand dennoch fehl, ist eine anbieterseitige Sperre eine mögliche Ursache.

**1. Signierschlüssel erzeugen** (mind. 32 Zeichen, zufällig):
```bash
openssl rand -base64 48
```
Die Ausgabe als `JWT_SIGNING_KEY` einsetzen.

**2. RS256-Schlüsselpaar erzeugen** (in Produktion — und damit auch hier, da `NODE_ENV=production` gesetzt ist — PFLICHT):
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
`JWT_PUBLIC_KEY` in Anführungszeichen einsetzen. Anschließend die
temporären PEM-Dateien löschen:
```bash
rm /tmp/jwt_private.pem /tmp/jwt_public.pem
```

---

## 7. Datenbank-Schema anlegen

```bash
cd apps/api
npx prisma db push
cd ../..
```
> **Warum `db push` statt `migrate deploy`?** `prisma migrate deploy` wendet vorhandene Migrationsdateien aus `apps/api/prisma/migrations/` an — dieser Ordner existiert im Repo (Stand dieser Anleitung) **noch nicht** (bewusst per `.gitignore` ausgeschlossen). `migrate deploy` hätte hier also nichts zu tun und die Datenbank bliebe leer, ohne dass ein Fehler auftritt. `prisma db push` erzeugt das Schema stattdessen direkt aus `prisma/schema.prisma`, ohne Migrationshistorie — für einen Testlauf ausreichend.

---

## 8. Backend bauen

```bash
npm run build --workspace=apps/api
```
Baut dabei automatisch auch die gemeinsamen Pakete (`packages/shared-types`, `packages/sync-protocol`) in der richtigen Reihenfolge mit (über `prebuild`-Skripte in den jeweiligen `package.json`).

---

## 9. Backend mit PM2 starten

```bash
cd apps/api
pm2 start dist/index.js --name lane1-api
cd ../..
```
Kontrolle:
```bash
pm2 status
pm2 logs lane1-api --lines 30 --nostream
```
> Kein `pm2 startup`/`pm2 save` hier — das würde einen `systemd`-Autostart-Dienst einrichten, den es in diesem Container nicht gibt (siehe Warnhinweis in Schritt 4.2). Nach jedem Anhalten/Fortsetzen des Codespace müssen PostgreSQL und PM2 stattdessen kurz neu gestartet werden — siehe Abschnitt 13.

### 9.1 Ersten Superadmin anlegen (einmalig)

Identisch zu `deployment.md`, Abschnitt 8.1 — ohne diesen Schritt kann sich niemand einloggen, da es keine offene Registrierung gibt:
```bash
cd apps/api
npm run create-superadmin -- --email=admin@test.de --password='EIN-TESTPASSWORT' --name="Test Admin"
cd ../..
```
Mit diesem Konto danach unter `<deine-codespace-adresse>/admin` anmelden (siehe `apps/web/help/admin.html`) und dort den ersten (Test-)Verein anlegen.

---

## 10. Nginx konfigurieren

Konfigurationsdatei anlegen:
```bash
sudo nano /etc/nginx/sites-available/lane1
```
Inhalt (`/workspaces/DEIN-REPO-NAME` durch die Ausgabe von `pwd` aus Schritt 3 ersetzen):
```nginx
server {
    listen 8080;
    server_name _;

    # Weboberfläche (PWA) als statische Dateien ausliefern
    root /workspaces/DEIN-REPO-NAME/apps/web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
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
> **Warum Port 8080 statt 80?** Port 80 (wie in den anderen drei Anleitungen) braucht Root-Rechte zum Binden — in Codespaces unnötig: GitHubs Portweiterleitung funktioniert mit **jedem** Port, den ein Prozess öffnet, HTTPS kommt automatisch von GitHubs Seite dazu (siehe Schritt 11). Ein unprivilegierter Port spart den Umweg über `sudo`/root-Dienste komplett.
>
> **`proxy_pass` bewusst OHNE abschließenden Schrägstrich (bei `/api/` und `/auth/`):** siehe ausführliche Begründung in `deployment.md`, Abschnitt 9 — kurz: mit abschließendem `/` würde nginx das jeweilige Präfix beim Weiterleiten entfernen, das Backend erwartet den Pfad aber unverändert inkl. Präfix.

Aktivieren und testen:
```bash
sudo ln -s /etc/nginx/sites-available/lane1 /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo service nginx start
```
`nginx -t` sollte `syntax is ok` und `test is successful` melden — nur dann fortfahren.

---

## 11. Port veröffentlichen

Im unteren Panel von VS Code (neben „Terminal", „Problems", „Output") den Reiter **„PORTS"** öffnen — sobald Nginx läuft, erkennt Codespaces Port 8080 meist automatisch und bietet ihn zur Weiterleitung an; falls nicht, **„Forward a Port"** klicken und `8080` eintragen.

1. In der Zeile für Port 8080 mit der rechten Maustaste **„Port Visibility"** wählen.
2. **„Public"** wählen, damit die Adresse ohne GitHub-Login erreichbar ist (z. B. um sie mit anderen zum Testen zu teilen) — Standard ist **„Private"** (nur mit eigenem GitHub-Login erreichbar), für einen rein persönlichen Test auch ausreichend und die sicherere Wahl.
3. Auf das Weltkugel-Symbol (**„Open in Browser"**) klicken, oder die Adresse aus der Spalte „Forwarded Address" kopieren — genau die Adresse, die in Schritt 6 in `CORS_ORIGIN`/`FRONTEND_BASE_URL` eingetragen wurde.

> **Wichtig:** Stimmen die Adresse hier und die in der `.env` eingetragene nicht exakt überein (z. B. weil der Codespace-Name doch anders lautet als erwartet), `apps/api/.env` entsprechend korrigieren und das Backend neu starten: `pm2 restart lane1-api`. Ein CORS-Mismatch äußert sich sonst als Fehler beim Login, obwohl das Backend selbst einwandfrei läuft.

---

## 12. Testen

- Die in Schritt 11 geöffnete Adresse im Browser aufrufen.
- `curl -i https://DEIN-CODESPACE-NAME-8080.app.github.dev/health` prüfen (`200 OK`, `{"status":"ok",...}`) — bestätigt, dass Backend UND Nginx-Weiterleitung grundsätzlich funktionieren, bevor der eigentliche Login getestet wird.
- `/help/` öffnen und prüfen, dass die Kurzanleitung (nicht die App) angezeigt wird.
- Login testen (Konto aus Schritt 9.1), danach in der Sync-Warteschlange „Jetzt synchronisieren" auslösen.
- Bei Problemen:
  ```bash
  pm2 logs lane1-api --lines 50 --nostream
  sudo tail -n 50 /var/log/nginx/error.log
  sudo nginx -t
  ```

---

## 13. Codespace anhalten & fortsetzen

Ein Codespace hält **automatisch nach 30 Minuten Inaktivität** an (einstellbar in den eigenen GitHub-Einstellungen, 5 Minuten bis 4 Stunden) — das beendet den Container, verbraucht ab dann kein Core-Stunden-Kontingent mehr, löscht aber **nichts**: Beim nächsten Öffnen ist der komplette Zustand (Datenbank-Inhalte, `.env`, installierte Pakete) noch da.

**Nach jedem Fortsetzen** (Codespace im Browser erneut öffnen) müssen PostgreSQL, Nginx und das Backend manuell neu gestartet werden — anders als bei den anderen drei Anleitungen gibt es hier keinen `systemd`-Autostart (siehe Hinweis in Schritt 4.2 und 9):
```bash
sudo service postgresql start
sudo service nginx start
cd apps/api && pm2 start dist/index.js --name lane1-api ; cd ../..
```
(`pm2 start` mit demselben `--name` ist unproblematisch, falls der Prozess aus einer vorigen Sitzung noch als „gestoppt" gelistet ist — PM2 startet ihn dann einfach neu.)

Manuell anhalten (statt auf die 30-Minuten-Grenze zu warten, z. B. am Ende eines Testtages) über die Codespaces-Übersicht: **github.com/codespaces** → bei der jeweiligen Zeile auf die drei Punkte → **„Stop codespace"**.

---

## 14. Aufräumen — Codespace löschen

Anders als bei den anderen drei Anleitungen gibt es hier **keine** mehrstufige Deinstallation (keine Zertifizierungsstelle, keine Paketverwaltung, keine Konfigurationsdateien im eigenen System) — der gesamte Container inkl. Datenbank, installierter Software und `.env`-Datei existiert ausschließlich innerhalb des Codespace:

1. **github.com/codespaces** öffnen.
2. Bei der jeweiligen Zeile auf die drei Punkte → **„Delete"**.

Damit ist alles restlos entfernt — nichts davon hat außerhalb des Codespace Spuren hinterlassen (kein Eintrag in `/etc/hosts`, keine installierte Software, kein Zertifikat auf dem eigenen Rechner). Ungenutzte Codespaces werden von GitHub zusätzlich nach einer gewissen Zeit automatisch gelöscht (Standard: 30 Tage nach dem letzten Anhalten, einstellbar).

---

## 15. Kostenübersicht

Codespaces wird nutzungsabhängig abgerechnet — nach **Core-Stunden** (während der Codespace läuft, abhängig von der gewählten Maschinengröße) und **Speicherplatz** (GB-Monate, auch während der Codespace angehalten ist). Persönliche GitHub-Konten (Free/Pro) erhalten monatlich ein kostenloses Kontingent an Core-Stunden und Speicher; ein einzelner, gelegentlicher Testlauf mit einer 2-Core-Maschine bleibt für die meisten Konten innerhalb dieses kostenlosen Kontingents.

> Genaue, aktuelle Zahlen (Kontingent, Preis je Core-Stunde/GB-Monat) ändern sich gelegentlich — im Zweifel direkt unter [github.com/settings/billing](https://github.com/settings/billing) (eigener Verbrauch) bzw. [docs.github.com/billing/managing-billing-for-github-codespaces](https://docs.github.com/en/billing/managing-billing-for-github-codespaces) (aktuelle Preisliste) nachsehen.

Ein angehaltener (nicht gelöschter) Codespace verbraucht weiterhin Speicherkontingent, aber keine Core-Stunden — für längere Pausen zwischen Testläufen lohnt sich trotzdem eher das Löschen (Abschnitt 14) und bei Bedarf ein frischer Codespace, da diese Anleitung ohnehin in wenigen Minuten komplett reproduzierbar ist.

---

## 16. Kurze Fehlerbehebungs-Checkliste

| Symptom | Wahrscheinliche Ursache | Prüfen |
|---|---|---|
| Geöffnete Adresse zeigt eine GitHub-Anmeldeseite statt der App | Port-Sichtbarkeit steht auf „Private" | Ports-Tab → Port 8080 → „Port Visibility" → „Public" (siehe Schritt 11) |
| „502 Bad Gateway" | Backend läuft nicht (z. B. nach Fortsetzen des Codespace vergessen neu zu starten) | `pm2 status`, `pm2 logs lane1-api --nostream`, siehe Abschnitt 13 |
| Seite lädt gar nicht / Verbindung wird abgelehnt | Nginx läuft nicht oder Port nicht weitergeleitet | `sudo service nginx status`, Ports-Tab prüfen (Schritt 11) |
| `sudo systemctl start postgresql` meldet „Failed to connect to bus" | Kein `systemd` im Container (siehe Hinweis Schritt 4.2) | `sudo service postgresql start` statt `systemctl` verwenden |
| `sudo -u postgres psql` fragt nach einem Passwort, jede Eingabe scheitert mit „Sorry, try again" | `sudo -u <anderer-benutzer>` erfordert auf diesem Image ein Passwort für den eigenen Benutzer — das aber in Codespaces gar nicht gesetzt ist (siehe Warnhinweis Schritt 4.2) | `sudo su - postgres -c psql` statt `sudo -u postgres psql` verwenden |
| `node -v` zeigt nach der NodeSource-Installation weiterhin die alte/vorinstallierte Version (z. B. `v24.x` statt `v22.x`) | Kein Fehler — `nvm` (im Basisimage vorinstalliert) hängt weiter vorn im `PATH` als `/usr/bin`; da `package.json` nur `>=22` verlangt, erfüllt die angezeigte Version die Anforderung trotzdem meist bereits | Version mit `engines.node` in `package.json` vergleichen (`>=22` reicht); bei echtem Bedarf `/usr/bin/node`/`/usr/bin/npm` explizit verwenden, siehe Hinweis Schritt 4.1 |
| Backend startet gar nicht (`pm2 status` zeigt „errored") | Pflicht-Umgebungsvariable fehlt/ungültig, z. B. `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` nicht gesetzt | `pm2 logs lane1-api --nostream` — `env.ts` gibt die genaue fehlende/ungültige Variable aus |
| Login schlägt fehl, Konsole zeigt einen CORS-Fehler | `CORS_ORIGIN`/`FRONTEND_BASE_URL` in `.env` stimmen nicht exakt mit der tatsächlichen Codespace-Adresse überein | Adresse im Ports-Tab mit `.env` vergleichen (siehe Warnhinweis Schritt 11), danach `pm2 restart lane1-api` |
| Login/Registrierung liefert die HTML-Startseite statt einer Fehlermeldung/eines Tokens | `/auth/`-Location-Block in nginx fehlt oder `proxy_pass` mit abschließendem `/` (siehe Warnhinweis Schritt 10) | `curl -i .../auth/login -X POST -d '{}'`, Antwort auf `<!DOCTYPE html>` prüfen |
| Alle Daten/Einstellungen plötzlich weg | Codespace wurde gelöscht (manuell oder automatisch nach 30 Tagen Inaktivität) | Neuen Codespace erstellen, diese Anleitung erneut durchgehen (dauert wenige Minuten) |
| Änderungen erscheinen nicht | Browser-/Service-Worker-Cache | Hard-Reload (`Strg+Shift+R`), `CACHE_VERSION` in `sw.js` prüfen |
