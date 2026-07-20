# Lane 1 — Monorepo

Trainingsmanagement für Schwimmteams. Dieses Repository enthält das
Frontend (offline-first PWA) und das Node.js-Backend als gemeinsames
Monorepo (npm Workspaces), gemäß `docs/backend-plan.md`.

**Aktueller Umsetzungsstand:** Alle vier Phasen des Backend-Entwicklungsplans
sind umgesetzt. `apps/api` bietet **einladungsbasierte** Registrierung
(keine offene Selbstregistrierung mehr) mit Login/Refresh/Logout via JWT
(RS256, argon2id-Passwort-Hashing, rotierende Refresh Tokens) sowie ein
geschütztes `/api/me`. Neue Rolle **Superadministrator** legt Vereine an
und lädt deren ersten Admin ein; Admins laden Trainer:innen/Athlet:innen
ihres Vereins ein — beides über zeitlich befristete Einladungslinks. Das
vollständige fachliche Datenmodell (athletes, groups, competitions,
Startlisten-Einträge, results, exercises, templates, plans, sessions,
action items) liegt als Prisma-Schema vor, inkl. Mandantenfähigkeit
(`clubId`), Soft-Deletes und einem Seed-Skript analog zu
`apps/web/js/seed.js`. Die generische Sync-API (`POST /api/sync/push`,
`GET /api/sync/pull`) ist implementiert (Idempotenz, Konfliktlogik je
Store-Kategorie, Vereins-Scoping). **`apps/web` ist jetzt vollständig mit
`apps/api` verbunden** (Phase 4): echter Login-/Einladungsannahme-Bildschirm
statt des früheren lokalen Profil-Umschalters, die Sync-Warteschlange
synchronisiert wirklich mit dem Backend, und die Nutzerverwaltung
(Vereine/Einladungen) ruft die echten Endpunkte auf.

## Bekannte offene Punkte

- **Kein `GET /api/users`-Endpunkt:** Die Nutzerverwaltung im Frontend kann
  daher keine Liste bestehender Vereinsmitglieder anzeigen (nur Vereine und
  Einladungen).
- **`purgeExpiredDeletions` läuft nicht automatisch** — das CLI-Skript
  (`npm run purge-deleted-data`) muss per Cron eingerichtet werden (siehe
  Abschnitt „DSGVO: Auskunft & Löschung" unten); ohne eingerichteten Cron
  bleiben zur Löschung vorgemerkte Konten dauerhaft im Soft-Delete-Zustand.

## Struktur

```
apps/
  web/     PWA-Frontend (fertig, offline-first, kein Build-Schritt)
  api/     Node.js-Backend (Fastify) — Phase-0-Skelett
packages/
  shared-types/    gemeinsame Zod-Schemas/DTOs (User, SyncEvent, …)
  sync-protocol/   Konfliktregeln für die künftige Sync-API
  shared-config/   gemeinsame ESLint-/Prettier-/tsconfig-Basis
docs/
  backend-plan.md  vollständiger Backend-Entwicklungs- und Integrationsplan
```

## Voraussetzungen

- Node.js ≥ 22
- Docker + Docker Compose (für lokale PostgreSQL-Instanz)

## Erste Schritte

```bash
npm install                 # installiert alle Workspaces auf einmal
cp apps/api/.env.example apps/api/.env
# In apps/api/.env: JWT_SIGNING_KEY mit `openssl rand -base64 48` erzeugen
```

### Backend lokal starten (mit Datenbank via Docker)

```bash
docker compose up -d postgres     # nur die Datenbank starten
npm run dev:api                   # Backend mit Hot-Reload (tsx watch)
curl http://localhost:3000/health # sollte {"status":"ok",...} liefern
```

### Frontend lokal starten

```bash
npm run dev:web
# öffnet einen einfachen statischen Server auf http://localhost:5173
```

### Alles zusammen über Docker Compose

```bash
npm run docker:up
```

## Tests

```bash
npm test          # führt die Tests aller Workspaces aus (Vitest)
```

Enthaltene automatisierte Tests (Phase 0 + Phase 1 + Phase 2, 187 insgesamt):

| Workspace | Tests |
|---|---|
| `packages/shared-types` | Validierung der User-, SyncEvent-, Auth- und **Entities-Schemas** (gültige/ungültige Payloads je fachlichem Modell, inkl. Sets/Wiederholungsblöcke, Registry-Vollständigkeit) |
| `packages/sync-protocol` | Konfliktregeln je Store-Kategorie (last-write-wins, never-overwrite) |
| `apps/api` | Health-Check, Env-Validierung, Passwort-Hashing (argon2id), JWT-Signierung/-Verifikation (RS256), komplette Auth-Business-Logik (einladungsbasierte Registrierung/Login/Refresh-Rotation/Logout/Profil) sowie die komplette Autorisierungsmatrix für Vereine/Einladungen — alles mit In-Memory-Repositories, HTTP-Ebene inkl. Rate-Limiting auf `/auth/login`, geschütztes `/api/me`, **Entity-Registry-Vollständigkeit (SyncStore → Prisma-Delegate) sowie referenzielle Integrität der Seed-Demodaten** |

**Hinweis zur Testarchitektur:** `apps/api` nutzt ein Repository-Pattern
(`modules/auth/auth.repository.ts`, `modules/invitations/invitations.repository.ts`)
— die Business-Logik hängt von Interfaces ab, nicht direkt von Prisma. Tests
laufen daher komplett ohne Datenbank gegen die `*.repository.memory.ts`-
Implementierungen; Prisma wird produktiv verwendet, sobald kein
Test-Override übergeben wird.

## Einladungsbasierte Registrierung (Phase 1, überarbeitet)

Es gibt **keine offene Selbstregistrierung** mehr. Ein neues Konto entsteht
ausschließlich durch Einlösen eines gültigen, zeitlich befristeten
Einladungs-Tokens:

- **Superadministrator:in** — legt Vereine an (`POST /api/clubs`) und erhält
  dabei automatisch eine Admin-Einladung für den neuen Verein. Gehört selbst
  zu keinem Verein (`clubId: null`).
- **Admin** — lädt Trainer:innen/Athlet:innen des **eigenen** Vereins ein
  (`POST /api/invitations`); eine abweichende `clubId` im Request wird
  serverseitig ignoriert.
- Einladungen sind **einmalig verwendbar** und **zeitlich befristet**
  (Admin-Einladungen 14 Tage, Trainer:in-/Athlet:in-Einladungen 7 Tage,
  siehe `apps/api/src/app.ts`) und können jederzeit widerrufen werden.

### Den allerersten Superadmin anlegen (Bootstrapping)

Da es keine offene Registrierung gibt, muss das erste Superadmin-Konto
direkt angelegt werden:

```bash
cd apps/api
npm run create-superadmin -- --email=admin@dachverband.de --password='...' --name="Max Mustermann"
```

### Auth-/Einladungs-Endpunkte

| Methode & Pfad | Zweck | Berechtigung | Rate-Limit |
|---|---|---|---|
| `POST /auth/register` | Einladung einlösen (Token + Name + Passwort) | öffentlich, Token erforderlich | 10/Min |
| `POST /auth/login` | Login, liefert Access-/Refresh-Token | öffentlich | 5/Min je IP+E-Mail |
| `POST /auth/refresh` | Refresh Token einlösen (rotierend) | — | — |
| `POST /auth/logout` | Refresh Token invalidieren | — | — |
| `GET`/`PATCH /api/me` | Eigenes Profil lesen/ändern | eingeloggt | — |
| `POST /api/clubs` | Verein anlegen + erste Admin-Einladung | superadmin | — |
| `GET /api/clubs` | Alle Vereine auflisten | superadmin | — |
| `POST /api/invitations` | Trainer:in/Athlet:in einladen (admin), Admin einladen (superadmin) | admin, superadmin | — |
| `GET /api/invitations` | Eigene (admin) bzw. alle (superadmin) Einladungen auflisten | admin, superadmin | — |
| `DELETE /api/invitations/:id` | Einladung widerrufen | admin (eigener Verein), superadmin | — |
| `GET /api/invitations/preview/:token` | Einladung vor Annahme einsehen (E-Mail/Rolle/Verein) | öffentlich | — |

RS256-Schlüsselpaar: in `development`/`test` wird automatisch ein
Wegwerf-Schlüsselpaar pro Prozessstart erzeugt; in `production` **Pflicht**
über `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (Erzeugung siehe `apps/api/.env.example`).

## Fachliches Datenmodell (Phase 2)

Vollständiges Prisma-Schema für alle in `apps/web/js/db.js` bereits
verwendeten Stores — Mapping siehe `docs/backend-plan.md`, Abschnitt 4:

| IndexedDB-Store (Frontend) | Prisma-Modell | Server-Tabelle |
|---|---|---|
| `groups` | `Group` | `groups` |
| `athletes` | `Athlete` | `athletes` |
| `competitions` | `Competition` | `competitions` |
| `entries` | `StartlistEntry` | `startlist_entries` |
| `results` | `Result` (inkl. optionaler `laps`-Rundenzeiten) | `results` |
| `exercises` | `Exercise` | `exercises` |
| `templates` | `Template` (Sets/Blöcke als `Json`) | `templates` |
| `plans` | `Plan` (Tage als `Json`) | `plans` |
| `sessions` | `TrainingSession` (Anwesenheit als `Json`) | `sessions` |
| `actionItems` | `ActionItem` | `action_items` |

Jedes Modell trägt `clubId` (Mandantenfähigkeit) und `deletedAt`
(Soft-Delete, von der Sync-API in Phase 3 genutzt). Client-generierte
UUIDs bleiben als Primärschlüssel erhalten.

**Gemeinsame Vertragsdefinition:** `packages/shared-types/src/entities.ts`
enthält für jedes Modell ein passendes Zod-Schema — inklusive einer
Registry `ENTITY_SCHEMAS` (SyncStore → Schema), die die Sync-API (Phase 3)
direkt nutzt, um eingehende Sync-Events generisch zu validieren, statt für
jeden Store einen eigenen Validierungspfad zu brauchen. Auf API-Seite
übernimmt `apps/api/src/db/entityRegistry.ts` dieselbe Rolle für die
Zuordnung SyncStore → Prisma-Delegate.

**Migrationen:** In dieser Sandbox-Umgebung ohne Internetzugriff auf
`binaries.prisma.sh` konnten `prisma validate`/`prisma migrate dev` nicht
ausgeführt werden (identische Einschränkung wie schon in Phase 0). Das
Schema wurde sorgfältig von Hand geprüft; die erste Migration entsteht
normal mit vollem Internetzugriff:

```bash
cd apps/api
npm run prisma:migrate -- --name init
```

**Seed-Daten:** `apps/api/prisma/seed.ts` spiegelt inhaltlich
`apps/web/js/seed.js` (ein Demo-Verein, sechs Athlet:innen, vier
Nutzer:innen inkl. Superadmin, Übungskatalog, zwei Vorlagen, ein
Trainingsplan, zwei Einheiten, drei Handlungsfelder, zwei Wettkämpfe).
Ausführen mit:

```bash
npm run prisma:seed --workspace=apps/api
```

Die referenzielle Integrität der Demo-Daten (z. B. „jede Übungs-Referenz
in einer Vorlage zeigt auf eine existierende Übung") ist unabhängig von
einer Datenbank durch reine Unit-Tests abgedeckt
(`test/prisma/seedData.test.ts`) — `buildDemoData()` ist bewusst als reine
Funktion von der eigentlichen Prisma-Schreiblogik getrennt.

**Bewusst nicht Teil von Phase 2:** REST-/CRUD-Endpunkte für diese
Ressourcen (z. B. `/api/athletes`). Der primäre Schreibpfad ist laut Plan
die generische Sync-API (Phase 3); direkte Ressourcen-Endpunkte bleiben
optional und würden die Sync-Logik nicht berühren.

## Sync-API (Phase 3)

Generische Push/Pull-Synchronisierung über alle zehn fachlichen Stores
hinweg — kein separater Codepfad je Store:

| Endpunkt | Zweck |
|---|---|
| `POST /api/sync/push` | Lokale Änderungen hochladen (Idempotenz über Event-`id`, Payload-Validierung über `ENTITY_SCHEMAS`, Vereins-Scoping) |
| `GET /api/sync/pull` | Änderungen anderer Geräte/Nutzer:innen des eigenen Vereins abholen (paginiert, cursor-basiert) |

**Konfliktlogik** (`packages/sync-protocol`, bereits seit Phase 0 fertig):
last-write-wins für die meisten Stores, „nie überschreiben" (neuer
Datensatz mit neuer Server-id statt Überschreiben) für `results` — eine
Zeitmessung soll nie stillschweigend verschwinden. Nur `trainer`, `admin`
und `athlete` dürfen synchronisieren; `superadmin` wird abgewiesen (gehört
zu keinem Verein).

## DSGVO: Auskunft & Löschung (Art. 15 + 17)

Vervollständigt die bereits in Phase 1 vorbereitete Consent-Infrastruktur
(`consentGivenAt`/`consentVersion` auf `User`, `DataDeletionRequest`-Modell):

| Endpunkt | Zweck |
|---|---|
| `GET /api/me/export` | Recht auf Auskunft (Art. 15) — bündelt eigenes Profil + (falls verknüpft) Athletenprofil, Ergebnisse, Startlisteneinträge, Handlungsfelder, Anwesenheitseinträge als JSON |
| `DELETE /api/me` | Recht auf Löschung (Art. 17) — sofortiger Soft-Delete + Widerruf aller Sitzungen, liefert das Datum der endgültigen Löschung (`purgeAfter`) |

**Zweistufiger Löschprozess:**
1. `DELETE /api/me` löst sofort einen Soft-Delete aus (Konto + verknüpfte
   fachliche Daten bekommen `deletedAt` gesetzt, alle Refresh Tokens werden
   widerrufen) und legt einen `DataDeletionRequest` mit `purgeAfter` an
   (Standard: 30 Tage, konfigurierbar über `DATA_ERASURE_RETENTION_DAYS`).
2. Ein täglicher Cron-Job führt den endgültigen, unwiderruflichen Hard-Purge
   aus, sobald `purgeAfter` erreicht ist:
   ```bash
   0 3 * * * cd /pfad/zu/apps/api && npm run purge-deleted-data >> /var/log/lane1-purge.log 2>&1
   ```
   Löscht dabei: RefreshTokens, (falls verknüpft) Athletenprofil samt
   Ergebnissen/Startlisteneinträgen/Handlungsfeldern, entfernt die
   Anwesenheits-Einträge dieser Person aus den JSON-Anwesenheitslisten
   aller Trainingseinheiten des Vereins, und zuletzt den `User`-Datensatz
   selbst (per `onDelete: Cascade` verschwindet der `DataDeletionRequest`
   damit automatisch mit).

**Grenzfall „Gerät war länger offline als die Aufbewahrungsfrist" — zwei
Verbesserungen:**

1. **Tombstones** (`SyncTombstone`-Modell): Bevor der Purge-Job eine Zeile
   unwiderruflich löscht, legt er eine schlanke Löschmarkierung an (nur
   `clubId`/`store`/`entityId`/`deletedAt`, keine Personendaten, bewusst
   ohne Fremdschlüssel-Beziehung). `GET /api/sync/pull` (siehe
   `sync.gateway.ts`) meldet Löschungen jetzt auch anhand dieser
   Tombstones — so erfährt ein Gerät, das während der **gesamten**
   Aufbewahrungsfrist nie online war, trotzdem noch von der Löschung,
   obwohl die eigentliche Zeile physisch längst weg ist.
2. **Verständliche Fehlermeldung statt roher Datenbank-Fehler:** Versucht
   ein solches Gerät danach trotzdem, einen neuen Datensatz für die
   endgültig gelöschte Person zu pushen, scheitert das an der
   Datenbank-Fremdschlüsselbeziehung (Prisma-Fehlercode `P2003`).
   `sync.service.ts`s `describeSyncError()` erkennt das gezielt und liefert
   eine klare Meldung („… existiert nicht mehr …") statt der rohen
   Postgres-Fehlermeldung.

**Frontend:** „Mein Profil" ruft beide Endpunkte direkt auf. Der
Export-Button fällt bei nicht erreichbarem Server auf einen Export der
lokal zwischengespeicherten Daten zurück (mit entsprechendem Hinweis); der
Lösch-Button verlangt eine erfolgreiche Server-Antwort, bevor der lokale
Cache aufgeräumt wird — ein fehlgeschlagener Serveraufruf darf nie dazu
führen, dass nur lokal etwas verschwindet, während das Konto serverseitig
unverändert weiterbesteht.

## Frontend-Integration (Phase 4)

`apps/web` ist jetzt vollständig mit `apps/api` verbunden:

- **`js/apiClient.js`** — einziger Ort für HTTP-Aufrufe ans Backend.
  **Bewusst vollständig cookie-frei:** `/auth/login`, `/auth/register` und
  `/auth/refresh` liefern Access- und Refresh-Token direkt im JSON-Body
  zurück (kein `Set-Cookie`, kein `@fastify/cookie` im Backend); das
  Access Token bleibt nur im Speicher (Modulvariable, mindert XSS-Risiko),
  das Refresh Token wird in `localStorage` persistiert
  (`getStoredRefreshToken()`/`setTokens()`/`clearTokens()`), damit
  `restoreSession()` die Sitzung nach einem Seiten-Reload wiederherstellen
  kann. Automatisches Refresh+Retry bei 401. API-Basis-URL überschreibbar
  für lokale Entwicklung: `localStorage.setItem('lane1-api-base-url', 'http://localhost:3000')`.
- **`js/state.js`** — echte Sitzung statt lokalem Profil-Umschalter:
  `login()`, `acceptInvitation()`, `logout()`, `restoreSession()`.
- **`js/modules/authScreens.js`** — Login-Bildschirm (E-Mail/Passwort +
  DSGVO-Einwilligungs-Checkbox, Pflichtfeld gemäß Backend) sowie die
  Einladungsannahme (`#/accept-invite/<token>` — zeigt Rolle/Verein aus
  `GET /api/invitations/preview/:token`, danach Name+Passwort+Einwilligung).
- **`js/syncClient.js`** — löst die frühere Simulation in
  `modules/syncQueue.js` ab: `push()`/`pull()` gegen die echte Sync-API.
  **Wichtiger Bugfix während der Umsetzung:** `pull()` schreibt eingehende
  Änderungen über neue `putWithoutSync()`/`removeWithoutSync()`-Funktionen
  in `db.js`, NICHT über die normalen `put()`/`remove()` — sonst hätte
  jede vom Server abgeholte Änderung sofort wieder ein neues lokales
  Outbox-Event erzeugt (Endlosschleife aus Push/Pull).
- **`js/modules/userManagement.js`** — ruft jetzt `POST/GET /api/clubs`
  und `POST/GET/DELETE /api/invitations` echt auf, statt den Ablauf nur
  lokal zu simulieren.
- **`js/seed.js`** — lokale Fake-Konten (users/clubs/invitations) werden
  nicht mehr geseedet, da Login jetzt ein echtes Backend-Konto braucht;
  fachliche Demo-Daten (Athlet:innen, Wettkämpfe, …) bleiben als
  Offline-Cache-Inhalt bestehen.

Alle drei Verifikationsschritte (Login-Fluss, Einladungsannahme-Fluss,
Push/Pull-Rundlauf) wurden mit einer echten DOM-Simulation
(jsdom + fake-indexeddb + gemocktem `fetch`) end-to-end getestet.

## Superadmin-Oberfläche unter „/admin"

Eigenständige, **nur online verfügbare** Oberfläche unter `apps/web/admin/`
— bewusst getrennt vom normalen, offline-first App-Shell:

- **`admin/index.html` + `admin/admin.js`** — eigenständiges Skript, das
  nur wiederverwendet, was KEINE IndexedDB-Abhängigkeit hat
  (`apiClient.js`, `utils.js`, `i18n.js`). Registriert keinen eigenen
  Service Worker.
- **`sw.js`** wurde so angepasst, dass Anfragen unter `/admin/*` **nie**
  aus dem Cache bedient, **nie** selbst zwischengespeichert werden und bei
  einem Netzwerkfehler **nicht** auf das gecachte Haupt-App-Shell
  zurückfallen — sonst hätte der root-registrierte Service Worker des
  Hauptsystems `/admin` automatisch mit im Geltungsbereich gehabt.
- **Nur Superadmin-Login:** Meldet sich ein Konto mit einer anderen Rolle
  an, wird sofort wieder abgemeldet und eine klare Fehlermeldung gezeigt.
- **Vereine anlegen** (`POST /api/clubs`) — löst jetzt einen **echten
  E-Mail-Versand** der Einladung aus (siehe unten), nicht mehr nur einen
  anzuzeigenden Link.
- **Vereinsübersicht** (`GET /api/clubs`) zeigt je Verein die Anzahl
  aktiver Admins, Trainer:innen und Athlet:innen.

**Einladungs-E-Mail-Versand** (`apps/api/src/mail/mailer.ts`):
Repository-Pattern wie überall im Backend — `SmtpMailSender` (nodemailer)
für den echten Versand, `ConsoleMailSender` als Ausweichlösung, wenn kein
SMTP konfiguriert ist (protokolliert die Einladung samt Link statt eines
Absturzes — praktisch für lokale Entwicklung/Demo), `InMemoryMailSender`
für Tests. Konfiguration über `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM_EMAIL`/`SMTP_FROM_NAME` sowie
`FRONTEND_BASE_URL` (Basis-URL für den Einladungslink in der E-Mail) —
siehe `.env.example`.

**Mitgliederzahlen je Verein**: `GET /api/clubs` liefert jetzt zusätzlich
`memberCounts: { admin, trainer, athlete }` — ermittelt per
`prisma.user.groupBy()`, zählt nur aktive (nicht gelöschte) Konten.

## Build

```bash
npm run build      # baut alle Workspaces (packages zuerst, dann apps/api)
```

## Nächste Schritte

Phasen 0–4 des Plans (`docs/backend-plan.md`, Abschnitt 11) sind
umgesetzt, ebenso die DSGVO-Auskunfts-/Löschfunktion (Art. 15 + 17). Es
verbleiben: Phase 5 (weitere Sicherheitshärtung & Tests, siehe „Bekannte
offene Punkte" oben) und Phase 6 (optionale Erweiterungen, z. B.
Echtzeit-Sync, `GET /api/users`).

Für die Veröffentlichung auf einem Hetzner-Server siehe die separat
erstellte `hetzner-deployment-anleitung.md`.
