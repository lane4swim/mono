# Sicherheitsreview — Lane 1 Monorepo (August 2026)

Umfang: `apps/api`, `apps/web`, `packages/*`, Deployment-/CI-Konfiguration.
Schwerpunkt: Authentifizierung/Autorisierung, Mandantentrennung (`clubId`),
Datenminimierung, Injection, Secrets-Handling, Abhängigkeiten.

**Vorbemerkung.** Die Codebasis ist erkennbar mehrfach sicherheitsreviewt worden
und in den klassischen Kategorien sauber: argon2id mit OWASP-Parametern, RS256
mit opaken, gehashten Refresh-Tokens inkl. Rotation und Reuse-Detection,
Timing-Angleichung im Login, durchgängiges `clubId`-Scoping in der
Sync-Schicht (inkl. `where: { id, clubId }` bei jedem Schreibzugriff),
Whitelist-basierte Rechte-Matrix, `.strict()`-Zod-Schemas gegen
Mass-Assignment, parametrisiertes SQL, Container ohne root, `npm audit` als
blockierender CI-Schritt (aktuell: 0 Befunde in Produktionsabhängigkeiten).

Die folgenden Befunde betreffen daher überwiegend **Lücken zwischen bereits gut
gebauten Teilen** sowie die **Betriebs-/Deployment-Ebene** — nicht die
Kernlogik.

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|---|---|---|
| H1 | Standard-Superadmin `admin@test.de` / `pwd12345` bei `NODE_ENV=production` | `scripts/setup-codespace.sh` | Hoch |
| H2 | Kein `trustProxy`: Rate-Limiting kollabiert hinter Nginx auf einen globalen Eimer | `apps/api/src/app.ts` | Hoch |
| M1 | `trainerNote` erreicht Athlet:innen-Konten (bestätigt) | `sync.athleteScope.ts` | Mittel |
| M2 | Geburtsdatum/Geschlecht fremder Athlet:innen an Athlet:innen-Konten | `sync.athleteScope.ts` | Mittel |
| M3 | Einladungs-Token landet im Klartext in Zugriffs-/Anwendungslogs | `invitations.route.ts`, `app.ts`, `mailer.ts` | Mittel |
| M4 | SMTP ohne `requireTLS` — stille Klartext-Zustellung möglich | `mail/mailer.ts` | Mittel |
| M5 | Kein Passwortwechsel und keine Passwort-Wiederherstellung | `modules/auth/*` | Mittel |
| N1 | Rolle `athlete` darf `results`/`plans` vereinsweit schreiben und löschen | `sync.permissions.ts` | Niedrig |
| N2 | Namensfelder ohne Längenbegrenzung | `packages/shared-types/src/{auth,invitation}.ts` | Niedrig |
| N3 | Refresh-Token im `localStorage`; API-Basis-URL ebenfalls aus `localStorage` | `apps/web/js/apiClient.js` | Niedrig |
| N4 | Soft-gelöschtes Konto behält Zugriff bis zum Ablauf des Access Tokens | `plugins/authenticate.ts` | Niedrig |
| N5 | Hard-Purge lässt `Comment.authorName` stehen | `jobs/erasure.repository.ts` | Niedrig |
| N6 | Superadmin-Passwort als Kommandozeilenargument | `scripts/createSuperAdmin.ts` | Niedrig |
| N7 | Passwortrichtlinie: nur Mindestlänge 8 | `packages/shared-types/src/invitation.ts` | Niedrig |

---

## Hoch

### H1 — Standard-Superadmin mit öffentlich bekanntem Passwort in Produktion

`scripts/setup-codespace.sh:170-171`

```bash
SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-admin@test.de}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-pwd12345}"
```

Dasselbe Skript schreibt zuvor `NODE_ENV=production` in `apps/api/.env`
(Zeile 119) und veröffentlicht die Anwendung anschließend über Nginx auf Port
8080. Wer `bash scripts/setup-codespace.sh` ohne gesetzte Umgebungsvariablen
ausführt — der dokumentierte Normalfall, die Variablen sind nur als optionale
Überschreibung erwähnt —, erhält eine **produktiv konfigurierte Instanz mit
einem Superadmin-Konto, dessen Zugangsdaten im Repository stehen**. Die Rolle
`superadmin` darf Vereine anlegen und Admin-Einladungen für **jeden** Verein
ausstellen (`invitations.service.ts`: `ACTION_ROLES.issueAdminInvitation`) —
also faktisch Vollzugriff auf alle Mandanten.

Verschärfend: Das Skript gibt die Zugangsdaten am Ende zusätzlich im Klartext
aus (`echo "Superadmin-Login: ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}"`),
womit sie in Terminal-Scrollback und CI-Logs landen.

**Empfehlung:** Kein Default. Fehlen `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`,
entweder mit klarer Meldung abbrechen oder ein Zufallspasswort
(`openssl rand -base64 24`) erzeugen und **einmalig** ausgeben. Die
Klartext-Ausgabe am Skriptende entfernen. Zusätzlich prüfen, ob
`NODE_ENV=production` für ein Codespace-Testsetup überhaupt richtig ist.

---

### H2 — Rate-Limiting hinter dem Reverse Proxy: ein Eimer für alle

`apps/api/src/app.ts:58-60`, `apps/api/src/plugins/security.ts:78-96`,
`apps/api/src/modules/auth/auth.route.ts:54`

Fastify wird ohne `trustProxy` gebaut:

```ts
const app = Fastify({ logger: env.NODE_ENV !== 'test' });
```

Sämtliche Deployment-Anleitungen (`docs/deployment.md`,
`deployment-raspberry-pi.md`, `deployment-macos.md`,
`deployment-github-codespaces.md`, `scripts/setup-codespace.sh`) stellen Nginx
davor und setzen `X-Forwarded-For` korrekt. Ohne `trustProxy` **ignoriert
Fastify diesen Header**: `request.ip` ist für jede Anfrage die Adresse des
Proxys, in allen genannten Setups `127.0.0.1`.

Folgen für die drei Limits:

* **Globales Limit (100/min, `plugins/security.ts`):** gilt effektiv für die
  gesamte Installation zusammen, nicht pro Client. Ein einzelner Client kann
  damit alle anderen Nutzer:innen des Vereins aussperren — ein triviales
  Denial-of-Service ohne jede Vorbedingung.
* **`/auth/refresh` und `/auth/logout` (je 10/min):** ebenfalls global. Zehn
  Token-Erneuerungen pro Minute für den gesamten Verein — bei 15-Minuten-Access-
  Tokens und mehreren aktiven Geräten ist das bereits im Normalbetrieb knapp,
  und ein einzelner Client kann die Sitzungserneuerung für alle blockieren.
* **`/auth/login` (5/min, Key `IP:E-Mail`):** die E-Mail-Komponente trägt hier
  weiterhin, ein gezielter Brute-Force auf *ein* Konto bleibt begrenzt. Die
  IP-Komponente ist jedoch wirkungslos — genau die Verteilung auf viele Konten,
  gegen die der kombinierte Schlüssel laut Kommentar schützen soll, ist
  dadurch wieder unbegrenzt möglich.

**Empfehlung:** `Fastify({ trustProxy: true, ... })` setzen (bzw. gezielter:
die konkrete Proxy-Adresse/CIDR statt `true`, damit `X-Forwarded-For` nicht von
beliebigen Direktverbindungen gefälscht werden kann, falls Port 3000 je
erreichbar ist). Ergänzend: ein Test, der bei gesetztem `X-Forwarded-For` zwei
unterschiedliche `request.ip`-Werte nachweist.

---

## Mittel

### M1 — `trainerNote` erreicht Athlet:innen-Konten

`apps/api/src/modules/sync/sync.athleteScope.ts:43-52`

`scopeChangeForAthlete()` reduziert für die Rolle `athlete` beim Store
`sessions` das `attendance`-Array korrekt auf den eigenen Eintrag — reicht
`trainerNote` aber unverändert durch. Empirisch bestätigt (Funktion direkt
gegen einen realistischen Payload ausgeführt):

```
SESSION -> {
 "id": "s1", "clubId": "c1",
 "trainerNote": "GEHEIM: Anna wirkt demotiviert, Elterngespraech noetig",
 "attendance": [ { "athleteId": "me", "present": true, "rpe": 7, "note": "meine Notiz" } ]
}
```

`trainerNote` ist ein freies Trainer:innen-Notizfeld (`TrainingSessionSchema`,
bis 5.000 Zeichen). Die Oberfläche behandelt es konsequent als coach-intern:
`apps/web/js/modules/sessions.js:81` rendert es ausschließlich in
`renderDetail()`, und `render()` verzweigt für `role === 'athlete'` vorher nach
`renderAthleteView()`, das die Notiz nicht anzeigt. Über `GET /api/sync/pull`
landet sie dennoch in der lokalen IndexedDB jedes Athleten-Geräts und ist über
die DevTools oder einen direkten API-Aufruf im Klartext lesbar.

Das ist exakt dieselbe Konstellation, für die derselbe Codepfad wenige Zeilen
weiter unten `athletes.notes` bewusst redigiert — mit einer Begründung, die
wortgleich auf `trainerNote` zutrifft („freies Trainer:innen-Notizfeld … das
einzige Modul, das dieses Feld überhaupt anzeigt, ist auf
`roles: ['trainer','admin']` beschränkt"). Die Redaktion wurde beim Store
`sessions` schlicht nicht mitgezogen.

**Empfehlung:** Im `sessions`-Zweig `trainerNote: ''` setzen, analog zu
`notes` beim Store `athletes`.

---

### M2 — Geburtsdatum und Geschlecht fremder Athlet:innen an Athlet:innen-Konten

`apps/api/src/modules/sync/sync.athleteScope.ts:53-66`

Beim Store `athletes` wird für die Rolle `athlete` nur `notes` redigiert; der
übrige Datensatz geht vollständig heraus. Ebenfalls empirisch bestätigt:

```
ATHLETE -> {
 "id": "a2", "firstName": "Fremde", "lastName": "Person",
 "birthdate": "2012-04-03T00:00:00.000Z", "gender": "w",
 "joinDate": "2020-01-01T00:00:00.000Z", "active": true,
 "notes": ""
}
```

Die Begründung im Code — der Restdatensatz werde „für Team-weite Ansichten wie
Zeiten/Trainingspläne gebraucht (siehe `times.js`/`plans.js`)" — trifft auf
`firstName`/`lastName`/`groupId`/`id` zu, nicht auf `birthdate`, `gender` und
`joinDate`. Eine Suche über das gesamte Frontend zeigt, dass diese drei Felder
**ausschließlich** in `apps/web/js/modules/athletes.js` gelesen werden
(Zeilen 79, 123, 131, 134, 135, 174-202) — einem Modul mit
`roles: ['trainer', 'admin']`.

Im Kontext eines Schwimmvereins sind das überwiegend Geburtsdaten
Minderjähriger, die an jedes Athlet:innen-Gerät des Vereins repliziert werden,
ohne dass eine einzige Ansicht sie dort verwendet. Datenschutzrechtlich ist das
ein Verstoß gegen die Datenminimierung (Art. 5 Abs. 1 lit. c DSGVO), technisch
schlicht überflüssige Angriffsfläche.

**Empfehlung:** Für die Rolle `athlete` beim Store `athletes` auf die
tatsächlich genutzten Felder reduzieren (Allowlist statt Denylist —
konsistent zum Whitelist-Prinzip in `sync.permissions.ts`), z. B.
`id`, `clubId`, `firstName`, `lastName`, `groupId`, `active`, `createdAt`,
`updatedAt`. Eine Allowlist hat zusätzlich den Vorteil, dass ein künftig neu
hinzugefügtes Athletenfeld nicht automatisch mit herausgeht.

---

### M3 — Einladungs-Token im Klartext in den Logs

`apps/api/src/modules/invitations/invitations.route.ts:27`,
`apps/api/src/app.ts:58`, `apps/api/src/mail/mailer.ts:190-197`

Der Einladungslink transportiert das Token korrekt im URL-**Fragment**
(`#/accept-invite/<token>`, `invitations.service.ts:buildInviteUrl`) — das
Fragment wird nicht an den Server gesendet, das ist richtig gelöst. Die
Vorschau-Route legt es dann aber wieder offen:

```ts
app.get<{ Params: { token: string } }>('/api/invitations/preview/:token', ...)
```

Fastify läuft in Produktion mit `logger: true` und protokolliert für jede
Anfrage `req.url` — das Klartext-Token steht damit in den Anwendungslogs, in
`pm2`-Logfiles und (über die Nginx-Setups aller Deployment-Anleitungen)
zusätzlich im Nginx-Access-Log. Ein Token gilt 7 bzw. 14 Tage, ist nicht an
den Empfänger gebunden und erzeugt beim Einlösen ein Konto mit der in der
Einladung hinterlegten Rolle — bei einer Admin-Einladung also Vollzugriff auf
den Verein. Wer Leserechte auf Logs hat (Log-Aggregation, Backups,
Support-Zugänge), kann eine noch nicht eingelöste Einladung übernehmen.

Zweiter Pfad zum selben Ergebnis: `ConsoleMailSender` protokolliert den
vollständigen Einladungslink inklusive Token. `SMTP_HOST` ist in
`config/env.ts` optional und wird für `NODE_ENV=production` **nicht** erzwungen
— eine Produktivinstallation ohne SMTP-Konfiguration schreibt also
sämtliche Einladungs-Token ins Log, statt sie zu versenden.

**Empfehlung:**
1. Vorschau auf `POST /api/invitations/preview` mit Token im Body umstellen
   (Body wird nicht geloggt), oder das Token per `redact`-Option des
   Fastify-Loggers aus `req.url` entfernen.
2. In `loadEnv()` analog zu `JWT_PRIVATE_KEY`/`CORS_ORIGIN` abbrechen, wenn
   `NODE_ENV=production` und `SMTP_HOST` leer ist — `ConsoleMailSender` ist
   ausdrücklich als Entwicklungshilfe gedacht.
3. Die Route zusätzlich mit einem eigenen Rate-Limit versehen (derzeit greift
   nur das globale Limit, siehe H2).

---

### M4 — SMTP ohne `requireTLS`: stille Klartext-Zustellung möglich

`apps/api/src/mail/mailer.ts:162-170`

```ts
nodemailer.createTransport({
  host, port, secure: this.config.secure,
  auth: this.config.user ? { user, pass } : undefined,
  pool: true,
})
```

Der dokumentierte Standardfall ist `SMTP_SECURE=false` auf Port 587, also
STARTTLS. Nodemailer behandelt STARTTLS in dieser Konfiguration
**opportunistisch**: Bietet der Server kein `STARTTLS` an — sei es durch
Fehlkonfiguration oder durch einen aktiven Angreifer, der die
Server-Capabilities aus der Antwort streicht (klassischer
STARTTLS-Stripping-Angriff) —, wird unverschlüsselt weitergesendet, ohne
Fehler und ohne Hinweis. Übertragen werden dabei die SMTP-Zugangsdaten
(`SMTP_USER`/`SMTP_PASSWORD`) sowie der Einladungslink samt Token.

**Empfehlung:** `requireTLS: true` ergänzen, wenn `secure === false`. Das
erzwingt STARTTLS und lässt den Versand mit einem Fehler scheitern, statt
still ins Klartext-Fallback zu fallen.

---

### M5 — Kein Passwortwechsel, keine Wiederherstellung

`apps/api/src/modules/auth/auth.route.ts`, `packages/shared-types/src/auth.ts`

`UpdateMeRequestSchema` erlaubt `name`, `email`, `locale` — kein Passwort. Eine
Suche über `apps/` und `packages/` findet weder einen Endpunkt noch ein
Frontend-Formular für Passwortwechsel oder Passwort-Reset. Ein Passwort wird
ausschließlich einmalig bei `acceptInvitation()` gesetzt.

Konsequenzen:

* Bei einem kompromittierten Passwort (Phishing, Wiederverwendung, geteiltes
  Gerät) gibt es **keinen Weg zur Rotation** — auch nicht über einen Admin.
  Das einzige Mittel wäre eine Kontolöschung nach Art. 17 und eine neue
  Einladung, was sämtliche verknüpften Daten mit purgt.
* Ein vergessenes Passwort sperrt dauerhaft aus. Es existiert kein
  „Passwort vergessen"-Pfad.
* Die Reuse-Detection in `refresh()` widerruft bei Verdacht auf Token-Diebstahl
  korrekt **alle** Sitzungen — die Betroffenen können danach aber nur mit
  demselben, potenziell kompromittierten Passwort zurück.

**Empfehlung:** `POST /api/me/password` mit `currentPassword` + `newPassword`
ergänzen (Neuvalidierung des alten Passworts, danach
`revokeAllForUser()` außer der aktuellen Sitzung). Ein Reset-per-E-Mail-Flow
kann die bestehende Token-Infrastruktur (`generateOpaqueToken` / gehashte
Speicherung / TTL) nahezu unverändert wiederverwenden.

---

## Niedrig

### N1 — `athlete` darf `results` und `plans` vereinsweit schreiben

`apps/api/src/modules/sync/sync.permissions.ts:85-86`

`results` und `plans` sind als `shared` eingetragen: alle drei Rollen lesen
**und** schreiben. Damit kann jedes Athlet:innen-Konto per direktem
`POST /api/sync/push` die Ergebnisse **aller** Vereinsmitglieder ändern oder
löschen (`action: 'delete'`) sowie sämtliche Trainingspläne des Vereins
manipulieren. Die Begründung in der Tabelle („`times.js` zeigt/bearbeitet für
ALLE Rollen identisch die volle Liste") ist als Abbildung der heutigen
Oberfläche korrekt — die Frage ist, ob die Oberfläche das so soll.

Kein Mandantenbruch (`clubId`-Scoping greift), aber ein Integritätsrisiko
innerhalb des Vereins, das sich nicht rekonstruieren lässt: es gibt kein
Audit-Log, das festhielte, wer einen Datensatz zuletzt verändert hat.

**Empfehlung:** Bewusst entscheiden und dokumentieren. Falls Athlet:innen
tatsächlich nur eigene Zeiten eintragen sollen, ist `results` ein Kandidat für
eine zeilenbezogene Prüfung beim Push (analog zu `scopeChangeForAthlete()` beim
Pull): Schreibzugriff nur, wenn `payload.athleteId === requester.athleteId`.

### N2 — Namensfelder ohne Längenbegrenzung

`packages/shared-types/src/invitation.ts:37,39,109`, `auth.ts:59`

`CreateClubRequestSchema.name`, `.adminName`,
`AcceptInvitationRequestSchema.name` und `UpdateMeRequestSchema.name` sind
`z.string().min(1)` ohne `.max()`. Das steht im Gegensatz zu `entities.ts`, wo
jedes Textfeld und jedes Array bewusst begrenzt wurde — mit einer Begründung,
die hier genauso gilt („Fastifys 1-MB-Bodylimit begrenzt den Schaden zwar auf
HTTP-Ebene, aber ein einzelnes, absichtlich riesiges Feld hätte trotzdem
unbemerkt akzeptiert und dauerhaft gespeichert werden können"). `User.name`
wird in jeder Mitgliederliste gerendert, `Club.name` zusätzlich in den
E-Mail-Betreff geschrieben.

**Empfehlung:** `.max(200)` analog zu den übrigen Namensfeldern.

### N3 — Refresh-Token und API-Basis-URL im `localStorage`

`apps/web/js/apiClient.js:24-66`

Der Access Token liegt korrekt nur im Speicher; das Refresh-Token liegt im
`localStorage` — als bewusste, dokumentierte Vereinfachung gegenüber einem
httpOnly-Cookie. Bei einem XSS ist damit nicht nur die laufende Sitzung
betroffen, sondern die Sitzung über bis zu 30 Tage hinweg.

Verstärkend: `getApiBaseUrl()` liest die Ziel-URL **aller** Requests inklusive
`Authorization: Bearer`-Header ebenfalls aus dem `localStorage`
(`lane1-api-base-url`). Wer diesen Schlüssel setzen kann, leitet damit
sämtliche Tokens an einen fremden Host um. Als reines Entwicklungswerkzeug ist
das vertretbar; ein `origin`-Whitelist-Check bzw. eine Beschränkung auf
`NODE_ENV !== 'production'`-Builds wäre günstiger.

Die Nginx-CSP (`script-src 'self'`, `connect-src 'self'`) mindert beides
deutlich — `connect-src 'self'` würde eine Umleitung auf einen fremden Host
sogar blockieren. Deshalb niedrig eingestuft.

### N4 — Soft-gelöschtes Konto behält Zugriff bis zum Token-Ablauf

`apps/api/src/plugins/authenticate.ts:24-38`

`app.authenticate` verifiziert ausschließlich die JWT-Signatur und fragt die
Datenbank nie. `requestErasure()` setzt zwar `deletedAt` und widerruft alle
Refresh-Tokens, das bereits ausgestellte Access Token bleibt aber bis zu
`JWT_ACCESS_TTL_SECONDS` (Standard: 15 Minuten) gültig — und `/api/sync/push`
sowie `/api/sync/pull` konsultieren den Nutzer-Datensatz ebenfalls nicht. Ein
gerade gelöschtes Konto kann in diesem Fenster also weiterhin Vereinsdaten
lesen und schreiben. Dasselbe gilt für eine künftige Rollenänderung: die Rolle
steht im Token, nicht in der Datenbankabfrage.

Für 15 Minuten ist das ein akzeptierter, üblicher Trade-off kurzlebiger
Access-Tokens — sollte aber als bewusste Entscheidung dokumentiert sein.

### N5 — Hard-Purge lässt `Comment.authorName` stehen

`apps/api/src/jobs/erasure.repository.ts:43-160`

`purgeUserAndDependents()` löscht Nutzer, Athletenprofil, Ergebnisse,
Startlisteneinträge, Handlungsfelder und die Anwesenheitszeilen aus dem
`attendance`-JSONB. Nicht erfasst wird `Comment.authorName` — der
Klarname der Person, eingebettet in `plans.comments`, `exercises.comments` und
`plans.days[].sets[].comments` (siehe `CommentSchema` in `entities.ts`; das
Feld wird laut Kommentar dort „vom Frontend beim Anlegen aus dem eingeloggten
Konto übernommen"). Nach einem vollständigen Art.-17-Purge bleiben diese Namen
samt Kommentartext dauerhaft in der Datenbank.

**Empfehlung:** Im selben `$executeRaw`-Stil wie beim `attendance`-Feld die
betroffenen `comments`-Arrays anonymisieren (`authorName` → „Gelöschtes
Konto"), statt sie zu entfernen — der fachliche Kommentartext bleibt so
erhalten.

### N6 — Superadmin-Passwort als Kommandozeilenargument

`apps/api/scripts/createSuperAdmin.ts:18-40`

`--password=...` landet in `process.argv` und ist damit für jeden Prozess auf
demselben Host über `ps aux` sichtbar sowie in der Shell-History. Für ein
Bootstrapping-Skript vertretbar, aber eine Abfrage über `stdin` (verdeckt) oder
eine Umgebungsvariable wäre sauberer.

### N7 — Passwortrichtlinie nur über die Mindestlänge

`packages/shared-types/src/invitation.ts:110`

`password: z.string().min(8)` ist die einzige Anforderung — keine Obergrenze
(argon2id verarbeitet beliebig lange Eingaben, was bei 64 MiB Speicherkosten
pro Versuch als DoS-Vektor taugt), kein Abgleich gegen bekannte
Kompromittierungen. Für den Anwendungsfall angemessen; eine Obergrenze
(z. B. `.max(200)`) und ein Hinweis auf Passphrasen im Frontend wären eine
günstige Verbesserung.

---

## Geprüft und ohne Befund

Der Vollständigkeit halber — folgende Bereiche wurden gezielt untersucht und
sind sauber:

* **Mandantentrennung (`clubId`).** `findById()`/`update()`/`softDelete()` sind
  konsequent gescoped, `where: { id, clubId }` auch innerhalb der Transaktion
  in `applyAndMarkProcessed()`. Das Nachladen der Payloads in
  `listChangedSince()` (Schritt 3) filtert zwar nicht selbst auf `clubId`,
  bezieht seine IDs aber ausschließlich aus der bereits gescopten
  Wasserstands-Abfrage (Schritt 1) — kein Leck.
* **Fremdschlüssel über Vereinsgrenzen.** `assertForeignKeysWithinClub()` deckt
  alle Referenzfelder inkl. der verschachtelten `exerciseId` in
  `templates.sets`/`plans.days[].sets` ab und liefert für „existiert nicht" und
  „gehört fremdem Verein" bewusst dieselbe Meldung (kein Existenz-Orakel).
* **Mass Assignment.** Alle Entity-Schemas sind `.strict()`, und `push()`
  verwendet konsequent `ctx.validatedPayload` statt des Roh-Payloads;
  `createdAt`/`updatedAt` werden vor jeder Verwendung entfernt.
  `UpdateMeRequestSchema` kann keine `role`/`clubId` setzen (Zod strippt
  unbekannte Schlüssel).
* **Privilege Escalation über Einladungen.** `InvitationRoleSchema` schließt
  `superadmin` aus; `assertCanIssueRole()` erlaubt Admin-Einladungen nur
  `superadmin`; `resolveTargetClubId()` ignoriert eine mitgeschickte fremde
  `clubId` für die Rolle `admin`; die `athleteId` wird gegen den Zielverein
  geprüft. Rolle/Verein stammen bei `acceptInvitation()` ausschließlich aus dem
  serverseitigen Einladungsdatensatz.
* **SQL Injection.** Beide `$queryRaw`/`$executeRaw`-Stellen
  (`profile.repository.ts`, `erasure.repository.ts`) sind Tagged Templates mit
  parametrisierten Werten.
* **XSS im Frontend.** Nur fünf `innerHTML`-Stellen. `dom.js:icon()` ist
  ausdrücklich auf konstante Icon-Strings beschränkt; `charts.js` escapt
  Element-Inhalte und interpoliert nur intern gesetzte Farbkonstanten in
  Attribute; alles andere läuft über `el()`, das `createTextNode()` und
  `setAttribute()` nutzt. Kein `eval`, kein `new Function`,
  kein `document.write`.
* **HTML-Injection in E-Mails.** `escapeHtml()` in `mailer.ts` deckt
  `& < > " '` vollständig ab.
* **Prototype Pollution.** `isKnownStore()` nutzt zwar `in` (das die
  Prototypkette einschließt), wird aber ausschließlich mit bereits
  Zod-validierten `SyncStoreSchema`-Enum-Werten aufgerufen. Der
  Bibliotheks-Import in `libraryTransfer.js` baut jeden Datensatz aus explizit
  aufgezählten Feldern neu auf.
* **Service Worker.** `/api/`, `/auth/` und `/admin` sind vom Caching
  ausgenommen; `fetchAndCache()` speichert nur `res.type === 'basic'`.
* **CORS/Header.** `CORS_ORIGIN='*'` wird in Produktion beim Start abgelehnt;
  Helmet mit vollständig expliziter Default-Deny-CSP und `useDefaults: false`.
* **Abhängigkeiten.** `npm audit --omit=dev`: 0 Befunde. Der blockierende
  CI-Schritt ist vorhanden und korrekt konfiguriert.
* **Container.** Multi-Stage-Build, Laufzeit-Image ohne Dev-Abhängigkeiten,
  `USER node`.

---

## Empfohlene Reihenfolge

1. **H1** — `scripts/setup-codespace.sh`: Default-Zugangsdaten entfernen.
   Einzeiler, größte Wirkung.
2. **H2** — `trustProxy` setzen. Ebenfalls ein Einzeiler, stellt drei
   Rate-Limits gleichzeitig wieder her.
3. **M1/M2** — `sync.athleteScope.ts` auf eine Feld-Allowlist umstellen. Beide
   Befunde in einer Änderung, mit Tests gegen die konkreten Payloads.
4. **M3/M4** — Token aus den Logs (`redact` oder POST-Vorschau),
   `SMTP_HOST` in Produktion erzwingen, `requireTLS: true`.
5. **M5** — Passwortwechsel nachziehen.
6. Niedrig eingestufte Befunde bei nächster Berührung.
