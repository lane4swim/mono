# Lane 1 auf einem Hetzner-Server veröffentlichen — Schritt-für-Schritt-Anleitung

**Für wen ist diese Anleitung?** Für jemanden ohne (oder mit sehr wenig) Erfahrung in Serveradministration. Jeder Schritt wird erklärt — auch *warum* er nötig ist, nicht nur *wie*. Es wird nichts vorausgesetzt außer: ein Computer, eine Internetverbindung und die Bereitschaft, Befehle in ein schwarzes Textfenster ("Terminal") einzutippen.

**Basis dieser Anleitung:** der zuvor erstellte `backend-entwicklungsplan.md` (Monorepo mit `apps/web` = Frontend, `apps/api` = Node.js-Backend, JWT-Auth, Sync-API). Diese Anleitung beschreibt die **Veröffentlichung** dieses Monorepos. Das Frontend (die PWA, die bereits fertig vorliegt) lässt sich schon **heute** eigenständig veröffentlichen — Backend-Schritte sind so markiert, dass klar ist, was erst nach dessen Umsetzung nötig ist.

---

## 0. Überblick: Was am Ende funktioniert

Am Ende dieser Anleitung ist unter einer eigenen Adresse (z. B. `https://training.mein-schwimmverein.de`) erreichbar:

- die Lane-1-Weboberfläche (installierbar als App, funktioniert offline),
- die dazugehörigen Hilfeseiten unter `/help/` (Kurzanleitung, FAQ, Admin-Handbuch — ebenfalls offline nutzbar),
- optional das Node.js-Backend darunter, das die Geräte synchronisiert,
- alles verschlüsselt (HTTPS, kostenloses Zertifikat),
- mit automatischen Neustarts, falls der Server einmal neu startet.

---

## 1. Produktwahl bei Hetzner

Hetzner bietet mehrere Server-Kategorien an. Für dieses Projekt ist die Kategorie **"Cloud" → "Shared vCPU" → Cost-Optimized-Linie (CX)** die richtige Wahl — **nicht** "Dedicated Server"/Robot (das wäre für diesen Zweck deutlich überdimensioniert und teurer).

### Empfehlung: **Hetzner Cloud CX22**

| Eigenschaft | Wert |
|---|---|
| vCPU | 2 |
| Arbeitsspeicher | 4 GB |
| Festplatte | 40 GB NVMe SSD |
| Datenvolumen | 20 TB inklusive (mehr als genug) |
| Preis (Stand Mitte 2026) | ca. **4–5 € netto/Monat** |
| Standort | Nürnberg oder Falkenstein (Deutschland) — Daten bleiben in der EU |
| Betriebssystem | **Ubuntu 24.04 LTS** |

**Warum genau dieses Produkt?**
- Für einen Verein/ein Team mit einigen Dutzend bis wenigen hundert Nutzer:innen ist die Last gering — 2 vCPU/4 GB reichen für Node.js-API, PostgreSQL-Datenbank und das Ausliefern der Weboberfläche gleichzeitig.
- Die "Cost-Optimized"-Linie (CX) bietet 2026 weiterhin das mit Abstand beste Preis-Leistungs-Verhältnis bei Hetzner — die teureren Linien (CPX, CCX) wurden 2026 mehrfach deutlich teurer und lohnen sich für diese Größenordnung nicht.
- Standort Deutschland/EU vereinfacht die DSGVO-Betrachtung, die im Backend-Plan (Abschnitt 12, Datenschutz) ohnehin als offener Punkt genannt wurde.

> **Hinweis:** Hetzner benennt und bepreist seine Cloud-Produkte immer wieder um (2026 z. B. mehrere Preisanpassungen). Schau im Zweifel direkt in der [Hetzner Cloud Console](https://console.hetzner.cloud) nach dem aktuell kleinsten Server der Kategorie **"Shared vCPU" → "Cost-Optimized"** mit ca. 2 vCPU/4 GB RAM — die Bezeichnung kann leicht abweichen (z. B. CX22 oder CX23), die Empfehlung bleibt dieselbe.

Reicht der Server später nicht mehr aus (z. B. viele gleichzeitige Nutzer:innen), lässt er sich in der Hetzner-Konsole mit wenigen Klicks vergrößern ("Rescale"), ohne den Server neu aufsetzen zu müssen.

---

## 2. Hetzner-Konto und Server anlegen

1. Auf **[hetzner.com/cloud](https://www.hetzner.com/cloud)** ein Konto erstellen (E-Mail bestätigen, Zahlungsmethode hinterlegen).
2. In der **Cloud Console** ein neues **Projekt** anlegen, z. B. `lane1-verein`.
3. Im Projekt auf **„Server hinzufügen"** klicken:
   - **Standort:** Nürnberg oder Falkenstein
   - **Image (Betriebssystem):** Ubuntu 24.04
   - **Typ:** Shared vCPU → Cost-Optimized → CX22 (siehe oben)
   - **Netzwerk:** Standardeinstellungen belassen (öffentliche IPv4 + IPv6)
   - **SSH-Key:** siehe Schritt 2.1 — **unbedingt einrichten**, statt mit Passwort zu arbeiten
   - **Firewall:** siehe Schritt 2.2 — vor dem Erstellen direkt zuweisen
   - **Name:** z. B. `lane1-prod`
4. Auf **„Erstellen & Kaufen"** klicken. Nach ca. 30 Sekunden ist der Server einsatzbereit; die öffentliche IP-Adresse wird angezeigt (merken/kopieren, wird ständig gebraucht).

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

Den angezeigten Text (beginnt mit `ssh-ed25519 …`) bei der Server-Erstellung unter **„SSH-Key hinzufügen"** einfügen.

### 2.2 Firewall einrichten

In der Hetzner Cloud Console unter **„Firewalls"** eine neue Firewall anlegen (z. B. `lane1-firewall`) mit folgenden **eingehenden** Regeln, dann dem Server zuweisen:

| Port | Protokoll | Quelle | Zweck |
|---|---|---|---|
| 22 | TCP | Alle | SSH (Serverzugriff) |
| 80 | TCP | Alle | HTTP (wird später auf HTTPS umgeleitet) |
| 443 | TCP | Alle | HTTPS |

Alles andere bleibt gesperrt — das ist bereits eine solide Grundsicherung.

---

## 3. Erste Verbindung zum Server

Terminal (Mac/Linux) bzw. PowerShell (Windows) öffnen:

```bash
ssh root@DEINE-SERVER-IP
```

Beim ersten Verbinden erscheint eine Sicherheitsabfrage ("authenticity of host … can't be established"). Das ist normal beim allerersten Kontakt — mit `yes` bestätigen.

---

## 4. Server absichern (Grundhärtung)

Alle folgenden Befehle **auf dem Server** eingeben (also innerhalb der SSH-Verbindung von Schritt 3).

### 4.1 System aktualisieren
```bash
apt update && apt upgrade -y
```

### 4.2 Eigenen Benutzer statt „root" anlegen
Dauerhaft als `root` zu arbeiten ist riskant (jeder Befehl hat sofort volle Rechte). Stattdessen:
```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```
Der letzte Befehl kopiert den SSH-Key auch für den neuen Benutzer, damit man sich gleich als `deploy` anmelden kann.

Ab jetzt: neues Terminal-Fenster öffnen und testen:
```bash
ssh deploy@DEINE-SERVER-IP
```
Klappt das, kann das alte `root`-Fenster geschlossen werden — ab hier alles als `deploy` ausführen (Befehle, die Systemrechte brauchen, mit vorangestelltem `sudo`).

### 4.3 Firewall auf Betriebssystemebene (zusätzlich zur Hetzner-Firewall)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```
Mit `y` bestätigen.

### 4.4 Schutz gegen automatisierte Anmeldeversuche
```bash
sudo apt install fail2ban -y
```
Läuft mit sinnvollen Standardeinstellungen sofort im Hintergrund.

### 4.5 (Empfohlen) Passwort-Login und root-Login per SSH deaktivieren
```bash
sudo nano /etc/ssh/sshd_config
```
Darin folgende Zeilen suchen/anpassen (mit den Pfeiltasten navigieren, `Strg+O` zum Speichern, `Strg+X` zum Verlassen):
```
PasswordAuthentication no
PermitRootLogin no
```
Danach:
```bash
sudo systemctl restart ssh
```
**Wichtig:** Vorher unbedingt bestätigen, dass die Anmeldung als `deploy` mit SSH-Key funktioniert (Schritt 4.2) — sonst sperrt man sich selbst aus.

---

## 5. Domain einrichten

1. Eine Domain registrieren (falls noch nicht vorhanden), z. B. über Hetzner selbst, INWX oder einen beliebigen Registrar.
2. Beim DNS-Verwalter der Domain (oder in Hetzner DNS, falls dort verwaltet) einen **A-Record** anlegen:
   - Name: `training` (ergibt `training.mein-verein.de`) oder `@` für die Hauptdomain
   - Wert: die öffentliche IP-Adresse des Servers aus Schritt 2
   - TTL: Standardwert belassen
3. DNS-Änderungen brauchen etwas Zeit (meist Minuten, manchmal bis zu einer Stunde). Prüfen mit:
   ```bash
   ping training.mein-verein.de
   ```
   Antwortet die IP des Servers, ist alles bereit für Schritt 10 (HTTPS).

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

> **Wichtig (PostgreSQL 15+, damit auch Ubuntu 24.04/PostgreSQL 16):** Seit
> PostgreSQL 15 hat nur noch der Datenbank-Eigentümer automatisch das Recht,
> im Schema `public` Tabellen anzulegen — `GRANT ALL PRIVILEGES ON DATABASE`
> allein reicht dafür **nicht** mehr. Ohne das zusätzliche `\c lane1` +
> `GRANT ALL ON SCHEMA public` oben bricht Schritt 7.3
> (`prisma db push`) mit `permission denied for schema public` ab.

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
JWT_SIGNING_KEY="<mit openssl erzeugen, siehe unten>"
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
**`SMTP_SECURE` absichtlich nicht gesetzt lassen** — siehe Warnhinweis am
Ende dieses Abschnitts.

**1. Signierschlüssel erzeugen** (mind. 32 Zeichen, zufällig):
```bash
openssl rand -base64 48
```
Die Ausgabe als `JWT_SIGNING_KEY` einsetzen.

**2. RS256-Schlüsselpaar erzeugen** (signiert die Zugriffs-Tokens; in
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

> **Warnhinweis SMTP_SECURE:** Die Variable in der `.env` **nicht**
> explizit auf `false` setzen, obwohl das für Port 587 (STARTTLS) korrekt
> wäre. Die Validierung (`z.coerce.boolean()` in `env.ts`) wandelt jeden
> nicht-leeren Text unabhängig vom Inhalt in `true` um — auch den Text
> `"false"` (eine bekannte Eigenheit von `Boolean("false") === true` in
> JavaScript). Der korrekte Wert `false` gilt nur, wenn die Zeile
> **komplett fehlt** (dann greift der Standardwert). `SMTP_SECURE=true`
> explizit setzen ist dagegen unproblematisch — nur bei Port 465
> (implizites TLS) nötig.
>
> **Hinweis SMTP-Anbieter:** Für die Zugangsdaten reicht in der Regel das
> E-Mail-Postfach des Vereins bzw. ein von dessen Hoster bereitgestelltes
> SMTP-Konto — Hetzner selbst bietet keinen eigenen Mailversand für
> Cloud-Server an (u. a. zur Spam-Prävention sind neue Cloud-Server
> anfangs auf Port 25/465 ausgehend gesperrt); Port 587 (wie oben) ist
> davon nicht betroffen und funktioniert mit jedem gängigen Anbieter.

### 7.3 Datenbank-Schema anlegen
```bash
cd apps/api
npx prisma db push
cd ../..
```
> **Warum `db push` statt `migrate deploy`?** `prisma migrate deploy`
> wendet vorhandene Migrationsdateien aus `apps/api/prisma/migrations/`
> an — dieser Ordner existiert im Repo (Stand dieser Anleitung) **noch
> nicht** (bewusst per `.gitignore` ausgeschlossen, es wurde bislang keine
> erste Migration erzeugt/committet). `migrate deploy` hätte hier also
> nichts zu tun und die Datenbank bliebe leer, ohne dass ein Fehler
> auftritt. `prisma db push` erzeugt das Schema stattdessen direkt aus
> `prisma/schema.prisma`, ohne Migrationshistorie — für die erste
> Inbetriebnahme ausreichend. Sobald das Projekt eine echte
> Migrationshistorie führt (`npx prisma migrate dev --name init` in der
> Entwicklung, Ergebnis eingecheckt), sollte künftig `migrate deploy`
> verwendet werden (u. a. wegen Nachvollziehbarkeit und
> Zero-Downtime-Migrationen bei späteren Schemaänderungen) — dann auch
> Abschnitt 13 entsprechend anpassen.

### 7.4 Backend bauen
```bash
npm run build --workspace=apps/api
```

---

## 8. Backend mit PM2 starten (sobald vorhanden)

> **⚠ Bekannter, verifizierter Bug — der Start unten schlägt beim
> aktuellen Code-Stand IMMER fehl:** `pm2 start dist/index.js` (bzw.
> `node dist/index.js`) bricht sofort beim Start ab, unabhängig von der
> `.env`-Konfiguration. Ursache sind zwei unabhängige Fehler im
> Anwendungscode (nicht in dieser Anleitung behebbar, siehe Details
> unten den Code-Änderungen bedarf):
> 1. `packages/shared-types`/`packages/sync-protocol` verweisen in ihrer
>    `package.json` (`main`/`types`) auf den **TypeScript-Quellcode**
>    (`./src/index.ts`) statt auf kompilierten JavaScript-Code — mit
>    reinem `node` nicht ausführbar (`ERR_MODULE_NOT_FOUND`, da die
>    darin verwendeten relativen `.js`-Importe keine passenden Dateien
>    finden). `npm run dev` (nutzt `tsx`) ist davon nicht betroffen und
>    funktioniert normal.
> 2. `apps/api/src/db/prisma.ts` lädt `@prisma/client` per rohem
>    `require(...)` — in einem ECMAScript-Modul (`"type": "module"`,
>    wie ganz `apps/api`) ist `require` zur Laufzeit nicht definiert
>    (`ReferenceError: require is not defined`), reproduzierbar bei
>    jedem einzelnen Start.
>
> Beide Fehler wurden für diesen Check direkt gegen den kompilierten
> Code verifiziert (nicht nur vermutet). Sie betreffen **jede**
> Ausführung des kompilierten Backends — bare-metal wie im
> `apps/api/Dockerfile`. Bis das im Quellcode behoben ist, lässt sich
> Schritt 8 nicht wie unten beschrieben abschließen.

```bash
cd apps/api
pm2 start dist/index.js --name lane1-api
pm2 save
pm2 startup
```
Der letzte Befehl gibt eine Zeile aus, die mit `sudo` beginnt — diese Zeile **kopieren und einmal ausführen**. Damit startet das Backend automatisch neu, falls der Server neu bootet (z. B. nach einem Hetzner-Wartungsfenster).

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

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Service Worker & Manifest müssen exakt korrekt ausgeliefert werden
    location = /sw.js {
        add_header Cache-Control "no-cache";
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

    # Health-Check-Endpunkt für Monitoring (Hetzner-Load-Balancer/externe
    # Uptime-Checks, siehe Schritt 11) — bewusst außerhalb von /api/, da der
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

### 12.2 Hetzner-Snapshots (komplettes Server-Abbild)
In der Cloud Console unter dem Server → **„Backups"** aktivieren (kleiner Aufpreis, ca. 20 % des Serverpreises) oder manuell **„Snapshot erstellen"** vor größeren Änderungen.

### 12.3 Offsite-Backup (empfohlen)
Die tägliche `.sql`-Datei zusätzlich außerhalb des Servers sichern, z. B. mit einer **Hetzner Storage Box** oder einem einfachen Cronjob, der die Datei per `rsync`/`scp` an einen anderen Ort kopiert — ein Backup, das nur auf demselben Server liegt, hilft bei einem Totalausfall des Servers nicht.

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
> relativen Imports mit `.js`-Endung (TypeScript-Konvention, siehe
> `tsconfig.json`) nicht automatisch zur passenden `.ts`-Datei auf und
> bricht mit `ERR_MODULE_NOT_FOUND` ab; `tsx` übernimmt genau diese
> Auflösung zusätzlich zum reinen Type-Stripping.

---

## 13. Künftige Updates ausrollen

Sobald es Änderungen am Code gibt (neue Version aus Git oder neues ZIP):
```bash
cd /home/deploy/lane1
git pull                                    # oder: neues ZIP hochladen & entpacken
npm install
cd apps/api && npx prisma db push && cd ../..   # siehe Hinweis zu `db push` vs. `migrate deploy` in Schritt 7.3
npm run build --workspace=apps/api
pm2 restart lane1-api
sudo systemctl reload nginx
```
> Sobald das Projekt auf eine committete Migrationshistorie umgestellt hat
> (siehe Hinweis in Schritt 7.3), hier stattdessen
> `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`
> verwenden.

---

## 14. Laufende Wartung

- `sudo apt update && sudo apt upgrade -y` — regelmäßig (z. B. monatlich) für Sicherheitsupdates.
- `sudo apt install unattended-upgrades -y` — automatische Installation kritischer Sicherheitsupdates.
- `htop` — Prozess-/Auslastungsübersicht direkt auf dem Server.
- Hetzner Cloud Console → Server → **„Monitoring"** — CPU/RAM/Netzwerk-Graphen ohne Zusatzinstallation.

---

## 15. Kostenübersicht (grobe Richtwerte, Stand 2026)

| Posten | Kosten |
|---|---|
| Hetzner CX22 Server | ca. 4–5 €/Monat |
| Hetzner Cloud-Backups (optional) | ca. 1 €/Monat |
| Domain | ca. 10–15 €/**Jahr** |
| SSL-Zertifikat (Let's Encrypt) | kostenlos |
| **Gesamt** | **ca. 5–6 €/Monat** + Domain |

---

## 16. Kurze Fehlerbehebungs-Checkliste

| Symptom | Wahrscheinliche Ursache | Prüfen |
|---|---|---|
| Seite lädt gar nicht | DNS zeigt noch nicht auf den Server / Firewall blockiert | `ping domain`, Hetzner-Firewall-Regeln |
| „502 Bad Gateway" | Backend läuft nicht | `pm2 status`, `pm2 logs lane1-api` |
| Backend startet gar nicht (`pm2 status` zeigt „errored") | Pflicht-Umgebungsvariable fehlt/ungültig, z. B. `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` in Produktion nicht gesetzt | `pm2 logs lane1-api` — `env.ts` gibt die genaue fehlende/ungültige Variable aus |
| Backend startet gar nicht, Fehler `ERR_MODULE_NOT_FOUND` oder `ReferenceError: require is not defined` | Bekannter Code-Bug, siehe Warnhinweis am Anfang von Abschnitt 8 — keine `.env`-Ursache, per `.env`-Anpassung nicht behebbar | `pm2 logs lane1-api` |
| Login/Registrierung liefert die HTML-Startseite statt einer Fehlermeldung/eines Tokens | `/auth/`-Location-Block in nginx fehlt oder `proxy_pass` mit abschließendem `/` (siehe Warnhinweis Abschnitt 9) | `curl -i .../auth/login -X POST -d '{}'`, Antwort auf `<!DOCTYPE html>` prüfen |
| Einladungs-E-Mails kommen nicht an | `SMTP_HOST` nicht gesetzt (nur Server-Log) oder `SMTP_SECURE=false` explizit gesetzt (siehe Warnhinweis Abschnitt 7.2) | `pm2 logs lane1-api` auf SMTP-Fehler prüfen, `.env` kontrollieren |
| Kein Schloss-Symbol/HTTPS-Fehler | Zertifikat nicht erneuert oder DNS falsch bei Erstanfrage | `sudo certbot renew --dry-run` |
| Änderungen erscheinen nicht | Browser-/Service-Worker-Cache | Hard-Reload (`Strg+Shift+R`), `CACHE_VERSION` in `sw.js` prüfen |
| „Permission denied" bei SSH | falscher Benutzer/Key | Mit `deploy` statt `root` verbinden, richtigen Key prüfen |
