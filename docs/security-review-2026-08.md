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
| H1 | Standard-Superadmin `admin@test.de` / `pwd12345` bei `NODE_ENV=production` | `scripts/setup-codespace.sh` | Hoch — **behoben** |
| H2 | Kein `trustProxy`: Rate-Limiting kollabiert hinter Nginx auf einen globalen Eimer | `apps/api/src/app.ts` | Hoch — **behoben** |
| M1 | `trainerNote` erreicht Athlet:innen-Konten (bestätigt) | `sync.athleteScope.ts` | Mittel — **behoben** |
| M2 | Geburtsdatum/Geschlecht fremder Athlet:innen an Athlet:innen-Konten | `sync.athleteScope.ts` | Mittel — **behoben** |
| M3 | Einladungs-Token landet im Klartext in Zugriffs-/Anwendungslogs | `invitations.route.ts`, `app.ts`, `mailer.ts` | Mittel — **behoben** |
| M4 | SMTP ohne `requireTLS` — stille Klartext-Zustellung möglich | `mail/mailer.ts` | Mittel — **behoben** |
| M5 | Kein Passwortwechsel und keine Passwort-Wiederherstellung | `modules/auth/*` | Mittel — **behoben** |
| N1 | Rolle `athlete` darf `results`/`plans` vereinsweit schreiben und löschen | `sync.permissions.ts` | Niedrig — **behoben** |
| N2 | Namensfelder ohne Längenbegrenzung | `packages/shared-types/src/{auth,invitation}.ts` | Niedrig — **behoben** |
| N3 | Refresh-Token im `localStorage`; API-Basis-URL ebenfalls aus `localStorage` | `apps/web/js/apiClient.js` | Niedrig — **teilweise behoben** |
| N4 | Soft-gelöschtes Konto behält Zugriff bis zum Ablauf des Access Tokens | `plugins/authenticate.ts` | Niedrig — **bewusst akzeptiert, dokumentiert** |
| N5 | Hard-Purge lässt `Comment.authorName` stehen | `jobs/erasure.repository.ts` | Niedrig — **behoben** |
| N6 | Superadmin-Passwort als Kommandozeilenargument | `scripts/createSuperAdmin.ts` | Niedrig |
| N7 | Passwortrichtlinie: nur Mindestlänge 8 | `packages/shared-types/src/invitation.ts` | Niedrig |

---

## Hoch

### H1 — Standard-Superadmin mit öffentlich bekanntem Passwort in Produktion — **behoben**

`scripts/setup-codespace.sh` fragt E-Mail-Adresse und Passwort jetzt
interaktiv ab (Passworteingabe ohne Terminal-Echo, mit Bestätigung), ohne
jeden Default. `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` bleiben als
Umgebungsvariablen für nicht-interaktive Läufe (CI) überschreibbar. Die
abschließende Ausgabe nennt nur noch die E-Mail-Adresse, nie das Passwort.


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

### H2 — Rate-Limiting hinter dem Reverse Proxy: ein Eimer für alle — **behoben**

`apps/api/src/app.ts` setzt jetzt `trustProxy: true` beim Fastify-Konstruktor.
Regressionstest in `apps/api/test/plugins/security.test.ts` (verifiziert,
dass zwei unterschiedliche `X-Forwarded-For`-Clients getrennte
`/auth/refresh`-Rate-Limit-Budgets erhalten).


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

### M1 — `trainerNote` erreicht Athlet:innen-Konten — **behoben**

**Fix:** `apps/api/src/modules/sync/sync.athleteScope.ts:75-90` setzt
`trainerNote: ''` im `sessions`-Zweig, analog zur bestehenden
`notes`-Redaktion beim Store `athletes`. Regressionstests in
`apps/api/test/sync/sync.service.test.ts` (zwei neue Fälle: Redaktion für
Rolle `athlete` auch am eigenen Teilnahme-Eintrag, unverändertes Verhalten
für `trainer`/`admin`).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/modules/sync/sync.athleteScope.ts:43-52`

`scopeChangeForAthlete()` reduzierte für die Rolle `athlete` beim Store
`sessions` das `attendance`-Array korrekt auf den eigenen Eintrag — reichte
`trainerNote` aber unverändert durch. Empirisch bestätigt (Funktion direkt
gegen einen realistischen Payload ausgeführt, vor dem Fix):

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
landete sie dennoch in der lokalen IndexedDB jedes Athleten-Geräts und war
über die DevTools oder einen direkten API-Aufruf im Klartext lesbar.

Das war exakt dieselbe Konstellation, für die derselbe Codepfad wenige Zeilen
weiter unten `athletes.notes` bereits bewusst redigierte — mit einer
Begründung, die wortgleich auf `trainerNote` zutraf („freies
Trainer:innen-Notizfeld … das einzige Modul, das dieses Feld überhaupt
anzeigt, ist auf `roles: ['trainer','admin']` beschränkt"). Die Redaktion war
beim Store `sessions` schlicht nicht mitgezogen worden — siehe **Fix** oben.

---

### M2 — Geburtsdatum und Geschlecht fremder Athlet:innen an Athlet:innen-Konten — **behoben**

**Fix:** `apps/api/src/modules/sync/sync.athleteScope.ts:92-119`. Beim
Implementieren zeigte sich, dass die ursprünglich vorgeschlagene pauschale
Allowlist zu weit gegriffen hätte: `apps/web/js/modules/profile.js`
(`collectMyData()`) nutzt den lokal gesynchten, eigenen Athletendatensatz als
Offline-Ausweichlösung für den DSGVO-Auskunftsexport (Art. 15) — dafür werden
`birthdate`/`gender`/`joinDate` der **eigenen** Person tatsächlich gebraucht.
Der Fix unterscheidet daher nach Eigentümerschaft (`payload.id === athleteId`):
- **Eigener Datensatz:** bleibt vollständig sichtbar, nur `notes` redigiert
  (unverändert zum bisherigen Verhalten).
- **Fremder Datensatz:** auf `TEAM_VISIBLE_ATHLETE_FIELDS` reduziert (`id`,
  `clubId`, `firstName`, `lastName`, `groupId`, `active`, `createdAt`,
  `updatedAt`) — `birthdate`/`gender`/`joinDate`/`notes` fehlen dort komplett,
  statt nur geleert zu sein.

Drei Regressionstests in `apps/api/test/sync/sync.service.test.ts`: `notes`
fehlt am fremden Datensatz vollständig (statt `''`), `birthdate`/`gender`/
`joinDate` fehlen am fremden Datensatz, dieselben drei Felder bleiben am
eigenen Datensatz erhalten.

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/modules/sync/sync.athleteScope.ts:53-66`

Beim Store `athletes` wurde für die Rolle `athlete` nur `notes` redigiert;
der übrige Datensatz ging vollständig heraus. Ebenfalls empirisch bestätigt
(vor dem Fix):

```
ATHLETE -> {
 "id": "a2", "firstName": "Fremde", "lastName": "Person",
 "birthdate": "2012-04-03T00:00:00.000Z", "gender": "w",
 "joinDate": "2020-01-01T00:00:00.000Z", "active": true,
 "notes": ""
}
```

Die Begründung im Code — der Restdatensatz werde „für Team-weite Ansichten wie
Zeiten/Trainingspläne gebraucht (siehe `times.js`/`plans.js`)" — traf auf
`firstName`/`lastName`/`groupId`/`id` zu, nicht auf `birthdate`, `gender` und
`joinDate`. Eine Suche über das gesamte Frontend zeigte, dass diese drei
Felder **ausschließlich** in `apps/web/js/modules/athletes.js` gelesen
wurden — einem Modul mit `roles: ['trainer', 'admin']`.

Im Kontext eines Schwimmvereins waren das überwiegend Geburtsdaten
Minderjähriger, die an jedes Athlet:innen-Gerät des Vereins repliziert
wurden, ohne dass eine einzige Ansicht sie dort verwendete — ein Verstoß
gegen die Datenminimierung (Art. 5 Abs. 1 lit. c DSGVO) und unnötige
Angriffsfläche. Siehe **Fix** oben für die tatsächlich umgesetzte,
eigentümerschaftsbewusste Lösung.

---

### M3 — Einladungs-Token im Klartext in den Logs — **behoben**

**Fix.** Zwei unabhängige Leckpfade, zwei unabhängige Korrekturen — beide
unter der Vorgabe umgesetzt, dass der "Link kopieren"-Weg zum Teilen einer
Einladung über einen anderen Kanal als E-Mail (z. B. WhatsApp) ausdrücklich
erhalten bleiben muss:

1. **Vorschau-Route** (`apps/api/src/modules/invitations/invitations.route.ts:41-65`):
   von `GET /api/invitations/preview/:token` auf
   `POST /api/invitations/preview` mit Token im Body umgestellt (neues
   `InvitationPreviewRequestSchema` in `packages/shared-types/src/invitation.ts`),
   zusätzlich mit einem eigenen Rate-Limit (20/min) versehen. Der geteilte
   Einladungslink selbst ändert sich dadurch NICHT — er transportiert das
   Token weiterhin im URL-**Fragment** (`#/accept-invite/<token>`), das nie
   an den Server gesendet wird; nur der interne API-Aufruf, den das
   Frontend beim Öffnen dieses Links macht (`apps/web/js/apiClient.js:
   getInvitationPreview()`), läuft jetzt über POST. `apps/api/test/invitations/
   invitations.route.test.ts` entsprechend angepasst.

2. **`ConsoleMailSender`** (`apps/api/src/mail/mailer.ts:200-223`): protokolliert
   nicht mehr den vollständigen Link inkl. Token, sondern nur noch
   Empfänger/Verein/Rolle plus einen Hinweis auf den "Link kopieren"-Button.
   Bewusst **keine** Pflicht zu `SMTP_HOST` in Produktion ergänzt (ursprünglich
   als Option 2 vorgeschlagen) — das hätte den dokumentierten, unterstützten
   Betrieb ohne eigenen Mailserver gebrochen (`deployment-github-codespaces.md`/
   `deployment-macos.md`: Einladungen werden dort bewusst manuell geteilt statt
   per E-Mail versendet). Da `admin/admin.js`s Vereinserstellung (anders als
   `modules/userManagement.js`) den frisch erzeugten Link bislang gar nicht
   anzeigte — der jetzt redigierte Server-Log war dort die EINZIGE Quelle für
   den allerersten Admin-Einladungslink ohne SMTP —, zeigt `admin.js` den Link
   jetzt zusätzlich in einem eigenen "Link kopieren"-Dialog an
   (`showInviteLinkModal()`, analog zu `userManagement.js`), robust gegen den
   abweichenden URL-Pfad von `/admin` gegenüber der Haupt-App.

Regressionstests: `apps/api/test/mail/mailer.test.ts` (`ConsoleMailSender`
loggt Empfänger/Verein, aber weder Token noch `inviteUrl`).

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`apps/api/src/modules/invitations/invitations.route.ts:27`,
`apps/api/src/app.ts:58`, `apps/api/src/mail/mailer.ts:190-197`

Der Einladungslink transportierte das Token korrekt im URL-**Fragment**
(`#/accept-invite/<token>`, `invitations.service.ts:buildInviteUrl`) — das
Fragment wird nicht an den Server gesendet, das war richtig gelöst. Die
Vorschau-Route legte es dann aber wieder offen:

```ts
app.get<{ Params: { token: string } }>('/api/invitations/preview/:token', ...)
```

Fastify läuft in Produktion mit `logger: true` und protokolliert für jede
Anfrage `req.url` — das Klartext-Token stand damit in den Anwendungslogs, in
`pm2`-Logfiles und (über die Nginx-Setups aller Deployment-Anleitungen)
zusätzlich im Nginx-Access-Log. Ein Token gilt 7 bzw. 14 Tage, ist nicht an
den Empfänger gebunden und erzeugt beim Einlösen ein Konto mit der in der
Einladung hinterlegten Rolle — bei einer Admin-Einladung also Vollzugriff auf
den Verein. Wer Leserechte auf Logs hat (Log-Aggregation, Backups,
Support-Zugänge), hätte eine noch nicht eingelöste Einladung übernehmen
können.

Zweiter Pfad zum selben Ergebnis: `ConsoleMailSender` protokollierte den
vollständigen Einladungslink inklusive Token, unabhängig von `NODE_ENV`.

---

### M4 — SMTP ohne `requireTLS`: stille Klartext-Zustellung möglich — **behoben**

**Fix:** `apps/api/src/mail/mailer.ts:179` setzt jetzt
`requireTLS: !this.config.secure` beim `nodemailer.createTransport()`-Aufruf
— im dokumentierten Standardfall (`SMTP_SECURE=false`, Port 587) wird
STARTTLS damit erzwungen statt nur optional angeboten; bei `secure: true`
(Port 465, implizites TLS) bleibt die Option unnötig/wirkungslos und wird
folgerichtig nicht gesetzt. Zwei Regressionstests in
`apps/api/test/mail/mailer.test.ts` (`requireTLS: true` bei `secure: false`,
`requireTLS: false` bei `secure: true`).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/mail/mailer.ts:162-170`

```ts
nodemailer.createTransport({
  host, port, secure: this.config.secure,
  auth: this.config.user ? { user, pass } : undefined,
  pool: true,
})
```

Der dokumentierte Standardfall war `SMTP_SECURE=false` auf Port 587, also
STARTTLS. Nodemailer behandelte STARTTLS in dieser Konfiguration
**opportunistisch**: Bot der Server kein `STARTTLS` an — sei es durch
Fehlkonfiguration oder durch einen aktiven Angreifer, der die
Server-Capabilities aus der Antwort streicht (klassischer
STARTTLS-Stripping-Angriff) —, wurde unverschlüsselt weitergesendet, ohne
Fehler und ohne Hinweis. Übertragen worden wären dabei die SMTP-Zugangsdaten
(`SMTP_USER`/`SMTP_PASSWORD`) sowie der Einladungslink samt Token.

---

### M5 — Kein Passwortwechsel, keine Wiederherstellung — **behoben**

**Fix:** Drei neue Endpunkte in `apps/api/src/modules/auth/auth.route.ts`,
abgesichert über die bestehende opake-Token-Infrastruktur
(`generateOpaqueToken`, nur der SHA-256-Hash landet in der DB, analog zu
Refresh- und Einladungs-Tokens):

* **`POST /auth/forgot-password`** — nimmt eine E-Mail-Adresse entgegen und
  antwortet **immer** mit 200 und derselben generischen Meldung, unabhängig
  davon, ob ein Konto existiert (kein User-Enumeration-Vektor). Existiert das
  Konto, wird ein `PasswordResetToken` (neue Tabelle
  `password_reset_tokens`, 60 Minuten TTL, Migration
  `20260826130713_add_password_reset_tokens`) erzeugt und der Versand der
  Reset-Mail bewusst **ohne `await`** angestoßen
  (`auth.service.ts:requestPasswordReset`) — sonst wäre die
  SMTP-Round-Trip-Zeit ein Timing-Seitenkanal, über den sich "Konto
  existiert" von "Konto existiert nicht" unterscheiden ließe.
  Rate-Limit: **3 Anfragen / 15 Minuten** je IP+E-Mail — enger als der
  Login, weil ein Treffer hier tatsächlich einen kostenpflichtigen
  Mail-Versand auslöst.
* **`POST /auth/reset-password`** — validiert das Token (nicht gefunden,
  bereits benutzt und abgelaufen laufen bewusst in **einen** gemeinsamen
  Fehler `InvalidOrExpiredResetTokenError`, analog zu
  `InvalidInvitationError`, um keine der drei Ursachen nach außen zu
  unterscheiden), setzt das neue Passwort, ruft anschließend
  `revokeAllForUser()` auf (ein Passwort-Reset gilt als mögliches
  Kompromittierungssignal — alle bestehenden Sitzungen werden beendet) und
  loggt die anfragende Seite direkt ein (`issueTokens()`, analog zum
  bestehenden `acceptInvitation()`-Verhalten). Rate-Limit: 10/Minute je IP,
  wie `/auth/refresh`.
* **`POST /api/me/password`** — authentifiziert, verifiziert das aktuelle
  Passwort (`InvalidCurrentPasswordError` bei Fehlschlag), setzt danach
  ebenfalls `revokeAllForUser()` **gefolgt von** einem frischen
  `issueTokens()` für die aktuelle Sitzung — andere Geräte/Sitzungen werden
  abgemeldet, das aktuell genutzte Gerät bleibt eingeloggt. Rate-Limit:
  5/Minute, bewusst **nur nach IP** statt IP+Nutzer-ID: die
  `@fastify/rate-limit`-Hook läuft global mit `hook: 'preHandler'` und damit
  **vor** jedem routen-eigenen `preHandler` wie `app.authenticate`
  (`apps/api/src/plugins/security.ts`) — `request.user` ist im
  `keyGenerator` zu diesem Zeitpunkt noch nicht gesetzt; ein Zugriff darauf
  hätte jede Anfrage auf diese Route zum Absturz gebracht.

Frontend (`apps/web/js/modules/authScreens.js`, `profile.js`): ein
„Passwort vergessen?“-Link auf dem Login-Bildschirm führt zu einem
E-Mail-Formular, dessen gesamter Inhalt nach dem Absenden durch eine
generische Bestätigung ersetzt wird (kein Doppel-Submit, keine
unterscheidbare Antwort). Der Link aus der E-Mail
(`#/reset-password/<token>`) öffnet ein Formular für ein neues Passwort
(mit Client-seitigem Abgleich der Wiederholung) und loggt nach Erfolg
automatisch ein. Im Profil-Modul ergänzt eine neue Karte
„Passwort ändern“ mit aktuellem/neuem/Wiederholungs-Passwort; ein falsches
aktuelles Passwort wird sichtbar zurückgemeldet, die laufende Sitzung bleibt
nach einem erfolgreichen Wechsel erhalten.

Vollständig end-to-end gegen eine echte Postgres-Instanz und einen
laufenden Dev-Server im Browser verifiziert (Login → „Passwort
vergessen?" → Formular → generische Bestätigung → Reset-Link →
neues Passwort → Auto-Login → Abmelden/Neu-Login mit dem neuen Passwort;
Profil → Passwort ändern → falsches aktuelles Passwort abgelehnt →
korrekter Wechsel → Sitzung bleibt erhalten → Abmelden/Neu-Login mit dem
geänderten Passwort). Testabdeckung: neue Unit-Tests in
`auth.service.test.ts`, `tokens.test.ts`, `mailer.test.ts`,
`shared-types/test/auth.test.ts`; neue Routen-Tests inkl. Rate-Limits in
`auth.route.test.ts`; Integrationstest in
`test-integration/authService.integration.test.ts` gegen die echte
Prisma-Implementierung.

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
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

### N1 — `athlete` darf `results` und `plans` vereinsweit schreiben — **behoben**

**Fix:** Bewusst entschieden (wie von der ursprünglichen Empfehlung
gefordert) und für `results` umgesetzt: `sync.service.ts:push()` prüft nach
dem Laden des ggf. bestehenden Datensatzes zusätzlich, ob Rolle `athlete`
sich selbst betrifft — sowohl der BESTEHENDE Datensatz (falls vorhanden) als
auch die im Payload gesendete `athleteId` müssen der eigenen `athleteId`
entsprechen, sonst wird das Event mit `status: 'error'` abgelehnt, bevor
irgendetwas geschrieben wird. Das schließt sowohl "fremdes Ergebnis anlegen"
als auch "bestehendes fremdes Ergebnis per Update/Delete übernehmen bzw.
löschen". `trainer`/`admin` bleiben unverändert unbeschränkt.
`plans` bleibt bewusst **unverändert geteilt**: anders als `ResultSchema`
(mit `athleteId`) hat `PlanSchema` keine Eigentümer:in auf Personenebene,
nur `groupId` — ein Trainingsplan ist ein Team-/Gruppendokument, kein
individueller Datensatz, dem sich "eigene athleteId" sinnvoll zuordnen
ließe. Beide Entscheidungen sind jetzt in `sync.permissions.ts` (Kopf- und
Tabellenkommentar) dokumentiert, nicht nur im Code selbst.

Regressionstests: `apps/api/test/sync/sync.service.test.ts` (eigener
`describe`-Block „Zeilenscoping für 'results' bei Rolle 'athlete'" — lehnt
CREATE mit fremder `athleteId` sowie UPDATE/DELETE eines fremden
Datensatzes ab, selbst wenn das Payload die eigene `athleteId` trägt;
erlaubt weiterhin CREATE/UPDATE/DELETE der eigenen Ergebnisse; `trainer`
bleibt unbeschränkt).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
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

### N2 — Namensfelder ohne Längenbegrenzung — **behoben**

**Fix:** `.max(200)` ergänzt bei `CreateClubRequestSchema.name`/`.adminName`
und `AcceptInvitationRequestSchema.name` (`invitation.ts`) sowie
`UpdateMeRequestSchema.name` (`auth.ts`) — analog zu den bereits begrenzten
Namensfeldern in `entities.ts`. Regressionstests in
`packages/shared-types/test/{invitation,auth}.test.ts` (jeweils ein
201-Zeichen-Name wird abgelehnt, ein gültiger weiterhin akzeptiert).

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
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

### N3 — Refresh-Token und API-Basis-URL im `localStorage` — **teilweise behoben**

**Fix:** Nur der zweite, verstärkende Teil des Befunds wurde behoben — der
`lane1-api-base-url`-Override wird jetzt nur noch berücksichtigt (gelesen
UND geschrieben), wenn die Seite selbst gerade von einem lokalen
Entwicklungs-Origin (`localhost`/`127.0.0.1`/`::1`) ausgeliefert wird
(`apps/web/js/apiClient.js: isLocalDevOrigin()`). Eine echte
Produktionsinstanz läuft laut `docs/deployment*.md` immer auf einer
eigenen Domain, nie auf `localhost` — dort greift der Override dadurch
selbst dann nicht mehr, wenn der Schlüssel im `localStorage` gesetzt ist
(z. B. über eine XSS-Lücke). Das Refresh-Token selbst bleibt bewusst
**unverändert** im `localStorage` — das ist die bereits zum
Analysezeitpunkt dokumentierte, akzeptierte Vereinfachung gegenüber einem
httpOnly-Cookie (siehe Fundstelle unten) und war nicht Teil der konkreten
Empfehlung für diesen Befund.

Regressionstests: `apps/web/test/apiClient.test.js` (eigener
`describe`-Block „Origin-Gating" — Override greift auf `localhost`/
`127.0.0.1`, wird auf einem Produktions-Hostname ignoriert bzw. gar nicht
erst geschrieben).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
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

### N4 — Soft-gelöschtes Konto behält Zugriff bis zum Token-Ablauf — **bewusst akzeptiert, dokumentiert**

**Entscheidung:** Kein Code-Fix — der ursprüngliche Befund selbst formuliert
bereits keine `**Empfehlung**` (anders als N1/N2/N3/N5), sondern schließt
mit „ein akzeptierter, üblicher Trade-off … sollte aber als bewusste
Entscheidung dokumentiert sein". Diese Dokumentation wurde jetzt ergänzt:
`apps/api/src/plugins/authenticate.ts` trägt einen ausführlichen Kommentar,
der den Trade-off, seine Konsequenzen (inkl. `/api/sync/push`/`pull`) und
die bewusste Alternative (ein DB-Lookup je authentifizierter Anfrage —
gerade auf den beiden lastintensivsten Endpunkten der App) benennt;
`sync.route.ts` verweist an der entsprechenden Stelle darauf. Kein
Code-Fix, weil ein DB-Lookup bei JEDER authentifizierten Anfrage genau den
Performance-Vorteil kurzlebiger, zustandsloser Access Tokens gegenüber
einer serverseitigen Session-Prüfung aufheben würde — unverhältnismäßig
gegenüber einem 15-Minuten-Zeitfenster, das per Refresh-Token-Widerruf
ohnehin bereits einen erneuten Login/Refresh verhindert.

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
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

### N5 — Hard-Purge lässt `Comment.authorName` stehen — **behoben**

**Fix:** `purgeUserAndDependents()` anonymisiert jetzt zusätzlich
`Comment.authorName` — nicht nur in `plans.comments`/`exercises.comments`
und `plans.days[].sets[].comments` (wie ursprünglich empfohlen), sondern
konsequent auch in `templates.sets[].comments`, das dieselbe
Sets/Blöcke-Struktur verwendet und beim Analysezeitpunkt nicht ausdrücklich
genannt war, aber derselben Lücke unterlag. Bewusst **nicht** an
`user.athleteId` gekoppelt (anders als der bestehende Block für
Ergebnisse/Einträge/Handlungsfelder) — Kommentare stammen ebenso von
Trainer:innen/Admins ohne Athletenprofil. Wie bei der bereits bestehenden
`attendance`-Bereinigung (Befund C4) werden zunächst per `@>`-Containment
bzw. `jsonb_path_exists(..., '$.**.comments[*] ? (@.authorName == $name)')`
(rekursiver Abstieg durch beliebig tief verschachtelte Sets/Blöcke) nur die
TATSÄCHLICH betroffenen Zeilen ermittelt, statt alle Pläne/Übungen/Vorlagen
des Vereins zu laden. Die eigentliche Ersetzung (reine, DB-freie Funktionen
in `jobs/commentAnonymization.ts`, gemeinsam von der Prisma- und der
InMemory-Implementierung genutzt) ersetzt nur `authorName` durch
„Gelöschtes Konto" — der fachliche Kommentartext bleibt erhalten.

**Bekannte Grenze** (dokumentiert in `commentAnonymization.ts`):
`CommentSchema` hat bewusst kein `authorId` (keine serverseitige
Autor:innen-Verifikation, wie bei den übrigen freien Textfeldern des
Datenmodells) — die Zuordnung läuft daher über den zum Löschzeitpunkt
gültigen `User.name`, nicht über eine stabile ID. Bei Namensgleichheit mit
einer anderen, weiterhin aktiven Person würden auch deren Kommentare
mit anonymisiert; ein zwischenzeitlich geänderter Anzeigename der
gelöschten Person selbst bliebe unter dem alten Namen stehen. Diese
Grenze ist vom Datenmodell selbst vorgegeben, nicht neu durch diesen Fix.

Regressionstests: `apps/api/test/jobs/commentAnonymization.test.ts` (reine
Funktionstests, u. a. verschachtelte Block-Sets), erweiterter
`purgeExpiredDeletions.test.ts` (InMemory, inkl. „funktioniert auch ohne
Athletenprofil"), sowie ein neuer Integrationstest in
`test-integration/profileErasure.integration.test.ts` gegen eine echte
Postgres-Instanz (prüft insbesondere die `jsonb_path_exists`-Bedingung
tatsächlich gegen echtes SQL, nicht nur die InMemory-Nachbildung).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
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

1. ~~**H1** — `scripts/setup-codespace.sh`: Default-Zugangsdaten entfernen.~~
   **Behoben.**
2. ~~**H2** — `trustProxy` setzen.~~ **Behoben.**
3. ~~**M1/M2** — `sync.athleteScope.ts` auf eine Feld-Allowlist umstellen.~~
   **Behoben** (M2 mit einer Verfeinerung gegenüber dem ursprünglichen
   Vorschlag — siehe dortiger **Fix**-Abschnitt: Allowlist nur für fremde
   Datensätze, das eigene Athletenprofil bleibt vollständig).
4. ~~**M3/M4** — Token aus den Logs, `requireTLS: true`.~~ **Behoben** (M3
   ohne die ursprünglich vorgeschlagene SMTP_HOST-Pflicht in Produktion —
   siehe dortiger **Fix**-Abschnitt: hätte den dokumentierten
   E-Mail-losen Betrieb mit manuellem Link-Teilen gebrochen).
5. ~~**M5** — Passwortwechsel nachziehen.~~ **Behoben** (siehe dortiger
   **Fix**-Abschnitt).
6. ~~Niedrig eingestufte Befunde bei nächster Berührung.~~ **N1, N2, N3
   (teilweise), N5 behoben; N4 bewusst akzeptiert und dokumentiert** (siehe
   jeweiliger **Fix**-/**Entscheidung**-Abschnitt). Noch offen: **N6**
   (Superadmin-Passwort als CLI-Argument), **N7** (Passwortrichtlinie nur
   Mindestlänge).
