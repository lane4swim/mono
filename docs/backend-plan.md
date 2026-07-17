# Backend-Entwicklungs- und Integrationsplan — Lane 1

**Stand:** Juli 2026 · **Ausgangslage:** Offline-first PWA (IndexedDB, Outbox-Pattern bereits implementiert) · **Ziel:** echtes Node.js-Backend zur Mehrgeräte-/Mehrbenutzer-Synchronisation, mit JWT-Authentifizierung, Deployment als Monorepo

---

## 1. Ausgangslage und Zielsetzung

Lane 1 läuft heute vollständig offline-first im Browser: Alle Daten liegen in IndexedDB, jede Änderung wird zusätzlich als Event in einer lokalen Sync-Warteschlange (`syncQueue`-Store, Outbox-Pattern) protokolliert. Die Demo-Version simuliert die Übertragung dieser Events nur lokal.

Ziel dieses Plans ist es, ein echtes Backend zu entwickeln, das:

1. **Mehrere Geräte und Nutzer:innen** eines Vereins/Teams über eine zentrale Datenhaltung synchron hält,
2. eine **echte Authentifizierung** (statt des bisherigen Profil-Umschalters) auf Basis von **JWT** bereitstellt,
3. die bereits im Frontend vorbereitete **Sync-Warteschlange** mit einer passenden **Push/Pull-API** bedient,
4. als **Monorepo** zusammen mit dem bestehenden Frontend entwickelt, versioniert und deployed werden kann.

Der Plan ist in Phasen gegliedert (Abschnitt 12) und kann schrittweise umgesetzt werden, ohne dass die bestehende Offline-Funktionalität des Frontends zwischenzeitlich unterbrochen wird — das Frontend bleibt bei jeder Phase eigenständig lauffähig.

---

## 2. Monorepo-Architektur

### 2.1 Tooling-Entscheidung

| Option | Bewertung |
|---|---|
| **npm Workspaces** | Bereits Teil von npm, keine Zusatzabhängigkeit, reicht für Dependency-Sharing zwischen Paketen |
| **+ Turborepo** (ergänzend) | Caching von Build/Test-Läufen, parallele Task-Ausführung, sinnvoll sobald CI-Laufzeiten spürbar werden |
| Nx | Mächtiger, aber deutlich mehr Konzepte/Overhead als für dieses Projekt nötig |

**Empfehlung:** npm Workspaces als Basis, Turborepo ab Phase 3 ergänzen, sobald mehrere Pakete parallel gebaut/getestet werden.

### 2.2 Verzeichnisstruktur

```
lane1/
├─ package.json                 # Workspace-Root, definiert workspaces[]
├─ turbo.json                   # Pipeline-Konfiguration (Phase 3+)
├─ .github/workflows/ci.yml     # CI: Lint, Test, Build je Paket
├─ .env.example
├─ docker-compose.yml           # lokale Entwicklung: API + Postgres
│
├─ apps/
│  ├─ web/                      # bestehendes PWA-Frontend (dieses Projekt)
│  │  ├─ index.html, js/, css/, sw.js, manifest.json …
│  │  └─ package.json
│  │
│  └─ api/                      # neues Node.js-Backend
│     ├─ src/
│     │  ├─ index.ts            # Server-Einstiegspunkt
│     │  ├─ app.ts              # Fastify/Express-App-Setup (Middleware, Routen)
│     │  ├─ config/             # Env-Validierung, Konstanten
│     │  ├─ auth/               # JWT-Ausstellung/-Prüfung, Passwort-Hashing
│     │  ├─ modules/
│     │  │  ├─ auth/            # /auth/* Routen + Service + Repository
│     │  │  ├─ sync/            # /sync/push, /sync/pull
│     │  │  ├─ athletes/        # optionale direkte Ressourcen-Endpunkte
│     │  │  ├─ competitions/
│     │  │  └─ …                # je Store ein Modul, siehe Abschnitt 5
│     │  ├─ db/
│     │  │  ├─ schema.prisma    # oder Drizzle-Schema
│     │  │  └─ migrations/
│     │  └─ plugins/            # Rate-Limiting, Helmet, CORS, Logging
│     ├─ test/
│     ├─ Dockerfile
│     └─ package.json
│
├─ packages/
│  ├─ shared-types/             # gemeinsame TS-Typen/Zod-Schemas (DTOs)
│  │  └─ src/{user,athlete,plan,syncEvent}.ts
│  ├─ shared-config/            # gemeinsames eslint/tsconfig/prettier
│  └─ sync-protocol/            # Push/Pull-Vertragsdefinition + Konfliktregeln,
│                                 von web UND api importiert — verhindert
│                                 Drift zwischen Client- und Server-Logik
│
└─ docs/
   └─ backend-plan.md           # dieses Dokument
```

**Warum ein eigenes `sync-protocol`-Paket?** Die Konfliktlogik (Abschnitt 8) und die Event-Struktur müssen auf Client und Server exakt übereinstimmen. Als gemeinsam importiertes Paket statt Copy-Paste-Code lässt sich das nicht versehentlich auseinanderdriften.

### 2.3 Versionierung & Releases

- **Changesets** (`@changesets/cli`) für unabhängige Versionierung von `apps/api` und `apps/web` innerhalb desselben Repos.
- Frontend-Releases bleiben wie bisher statisch deploybar (kein Versionszwang mit Backend), Backend folgt eigenem SemVer.

---

## 3. Technologie-Stack Backend

| Bereich | Wahl | Begründung |
|---|---|---|
| Laufzeit | **Node.js 22 LTS** | Deckt sich mit dem restlichen Stack, kein Sprachwechsel |
| Sprache | **TypeScript** | Typsicherheit für DTOs, die mit `packages/shared-types` geteilt werden |
| HTTP-Framework | **Fastify** | Schneller als Express, eingebaute Schema-Validierung, aktives Plugin-Ökosystem (JWT, CORS, Rate-Limit, Helmet-Äquivalent) |
| Datenbank | **PostgreSQL** | Relational, transaktionssicher — wichtig für Konfliktauflösung beim Sync; JSONB-Spalten für verschachtelte Strukturen (z. B. Trainingsplan-Tage mit Blöcken) |
| ORM/Query | **Prisma** | Migrationen, typsichere Queries, gute DX; Alternative Drizzle bei Wunsch nach mehr SQL-Nähe |
| Validierung | **Zod** | Gleiche Bibliothek lässt sich (mit Anpassungen) gedanklich auf Frontend-seitige Validierung übertragen |
| Auth | **JWT** (`fast-jwt` oder `@fastify/jwt`) + **argon2** fürs Passwort-Hashing | Siehe Abschnitt 6 |
| Tests | **Vitest** + **Supertest** | Einheitliches Test-Tooling über das Monorepo hinweg |
| Logging | **Pino** (Fastify-nativ) | Strukturierte Logs, geringer Overhead |

---

## 4. Datenmodell: Mapping IndexedDB → Server

Die bestehenden IndexedDB-Stores übertragen sich direkt in Server-Tabellen. Zwei Ergänzungen sind für den Mehrbenutzer-/Mehrgeräte-Betrieb nötig:

1. **Mandantenfähigkeit:** neue Tabelle `clubs` (ein Verein/Team), jede fachliche Tabelle bekommt `club_id`. Ohne diese Abgrenzung könnten sich Daten verschiedener Vereine vermischen, sobald das Backend mehr als einen Verein bedient.
2. **Soft Deletes:** statt Hard-Delete ein `deleted_at`-Zeitstempel — nötig, damit ein "Löschen" auf einem Gerät beim Pull auf einem anderen Gerät als Löschung ankommt, statt einfach zu fehlen.

| IndexedDB-Store | Server-Tabelle | Besonderheiten |
|---|---|---|
| `users` | `users` | Passwort-Hash statt Klartext-Profil; `locale`, `role`, `club_id` bleiben |
| `athletes` | `athletes` | unverändert übernehmbar |
| `groups` | `groups` | unverändert |
| `competitions` | `competitions` | unverändert |
| `entries` | `startlist_entries` | unverändert (Wettkampfnummer/Lauf/Bahn) |
| `results` | `results` | `is_pb` weiterhin client-berechnet, serverseitig nur gespeichert |
| `exercises` | `exercises` | `equipment` als `text[]`-Spalte oder eigene M:N-Tabelle `exercise_equipment` |
| `templates` | `templates` | `sets` als `jsonb` (verschachtelte Blöcke bleiben strukturgleich zum Frontend) |
| `plans` | `plans` | `days` als `jsonb` (gleiche Begründung) |
| `sessions` | `sessions` | `attendance` als `jsonb` |
| `actionItems` | `action_items` | unverändert |
| `syncQueue` | *kein 1:1-Pendant* | wird durch die Sync-API ersetzt/bedient, siehe Abschnitt 7 |

**Primärschlüssel:** Die bereits im Frontend erzeugten Client-UUIDs (`uid()` in `db.js`) werden **beibehalten** und dienen als Primärschlüssel auf dem Server. Das ist entscheidend: Ein offline angelegter Datensatz braucht dadurch keine ID-Übersetzung beim ersten Sync und bleibt über alle Geräte hinweg eindeutig identifizierbar.

Jede Tabelle erhält zusätzlich: `updated_at` (bereits im Frontend vorhanden), `created_at`, `deleted_at` (nullable), `club_id`.

---

## 5. Authentifizierung & Autorisierung (JWT)

### 5.1 Flow

```
Registrierung  →  POST /auth/register   (E-Mail, Passwort, Name, Rolle*)
Login          →  POST /auth/login      (E-Mail, Passwort)
                    ⇒ { accessToken, refreshToken }
Token-Refresh  →  POST /auth/refresh    (refreshToken)
                    ⇒ { accessToken, refreshToken }  (Rotation, altes Token wird invalidiert)
Logout         →  POST /auth/logout     (refreshToken wird serverseitig invalidiert)
```
\* Registrierung neuer Trainer:innen/Admins i. d. R. durch bestehenden Admin eingeladen, nicht offen zugänglich — Athlet:innen-Konten analog.

### 5.2 Token-Design

| Token | Lebensdauer | Speicherort Client | Inhalt (Claims) |
|---|---|---|---|
| **Access Token** | kurz (15 Min.) | im Speicher (JS-Variable), **nicht** localStorage — mindert XSS-Risiko | `sub` (userId), `role`, `clubId`, `athleteId?`, `iat`, `exp` |
| **Refresh Token** | lang (30 Tage), rotierend | `httpOnly`, `Secure`, `SameSite=Strict` Cookie | opakes Zufalls-Token, serverseitig in `refresh_tokens`-Tabelle gehasht gespeichert |

- **Signaturverfahren:** RS256 (asymmetrisch) statt HS256 — erlaubt künftig, den öffentlichen Schlüssel an weitere Dienste zu verteilen, ohne das Signier-Secret zu teilen.
- **Rotation & Revocation:** Bei jedem `/auth/refresh` wird das alte Refresh-Token invalidiert und ein neues ausgestellt (Rotation). Tabelle `refresh_tokens` mit `token_hash`, `user_id`, `expires_at`, `revoked_at` ermöglicht sofortigen Entzug (z. B. bei Passwortänderung oder Diebstahlverdacht).
- **Passwort-Hashing:** argon2id (Parameter nach OWASP-Empfehlung), niemals bcrypt mit zu niedrigem Cost-Faktor.
- **Rollenprüfung:** Fastify-Hook (`preHandler`) liest `role`/`clubId` aus dem validierten Access Token und vergleicht mit den im Frontend bereits bekannten Rollen (`trainer`, `admin`, `athlete`) sowie der angefragten `club_id` — verhindert Zugriff über Vereinsgrenzen hinweg.
- **Rate Limiting** auf `/auth/login` (z. B. 5 Versuche/Minute je IP+E-Mail) gegen Brute-Force.

### 5.3 Beispiel Access-Token-Payload

```json
{
  "sub": "usr_8f2a1c",
  "role": "trainer",
  "clubId": "club_442b",
  "athleteId": null,
  "iat": 1752150000,
  "exp": 1752150900
}
```

---

## 6. API-Design für die Synchronisierung

Die Sync-API muss zum bestehenden **Outbox-Pattern** im Frontend passen: Der Client sammelt lokale Änderungen als Events (`syncQueue`) und muss sie **senden** (Push) können; umgekehrt muss der Client Änderungen **abholen** können, die auf anderen Geräten/durch andere Nutzer:innen entstanden sind (Pull).

### 6.1 Push — lokale Events an den Server senden

```
POST /api/sync/push
Authorization: Bearer <accessToken>

Body:
{
  "events": [
    {
      "id": "evt_a1b2",              // ID aus syncQueue, dient als Idempotenz-Schlüssel
      "store": "athletes",
      "entityId": "ath_9f3c",
      "action": "update",            // create | update | delete
      "payload": { ... },             // vollständiger Datensatz (bei delete: null)
      "clientUpdatedAt": "2026-07-10T09:15:00.000Z"
    }
  ]
}

Response 200:
{
  "results": [
    { "eventId": "evt_a1b2", "status": "applied" },
    { "eventId": "evt_c3d4", "status": "conflict", "serverVersion": { ... } },
    { "eventId": "evt_e5f6", "status": "error", "message": "validation_failed" }
  ]
}
```

- **Idempotenz:** Die `id` jedes Events ist eindeutig (bereits clientseitig als UUID erzeugt). Der Server führt eine `processed_events`-Tabelle (oder Unique-Constraint) mit dieser ID — ein wiederholt gesendetes Event (z. B. nach Verbindungsabbruch mitten in der Antwort) wird nicht doppelt angewendet.
- **Batch-Verarbeitung:** Events werden in der gesendeten Reihenfolge innerhalb einer Datenbank-Transaktion pro Event verarbeitet; ein einzelner Fehler blockiert nicht den ganzen Batch (Response enthält pro Event einen eigenen Status — spiegelt exakt die "pending/synced/error"-Zustände, die die Sync-Warteschlange im Frontend bereits kennt).

### 6.2 Pull — serverseitige Änderungen abholen

```
GET /api/sync/pull?since=2026-07-10T08:00:00.000Z&cursor=<opak>
Authorization: Bearer <accessToken>

Response 200:
{
  "changes": [
    { "store": "results", "entityId": "res_77", "action": "update", "payload": { ... }, "updatedAt": "…" },
    { "store": "athletes", "entityId": "ath_12", "action": "delete", "payload": null, "updatedAt": "…" }
  ],
  "nextCursor": "…",
  "hasMore": false
}
```

- **`since`/`cursor`:** Der Client speichert den zuletzt erhaltenen Cursor lokal (z. B. in `meta`-Store, der in `db.js` bereits als Store-Name existiert, bisher ungenutzt) und fragt beim nächsten Pull nur Änderungen danach ab.
- **Pagination:** `hasMore`/`nextCursor` für den Fall vieler Änderungen (z. B. nach langer Offline-Zeit).
- **Scope:** Nur Daten des eigenen `club_id` werden zurückgegeben (serverseitig über den JWT-Claim erzwungen, nicht über Client-Parameter).

### 6.3 Wann wird synchronisiert?

- Automatisch beim `online`-Browser-Event und periodisch (z. B. alle 60 s) im Vordergrund.
- Manuell über den bereits vorhandenen Button „Jetzt synchronisieren" in der Sync-Warteschlange (ersetzt die aktuelle Simulation 1:1 durch echte Push-Aufrufe).
- Reihenfolge pro Sync-Zyklus: **erst Push, dann Pull** — eigene Änderungen zuerst hochladen, damit sie nicht durch einen Pull-Konflikt mit dem eigenen, noch nicht gesendeten Stand kollidieren.

### 6.4 Endpunkt-Übersicht

| Methode & Pfad | Zweck | Auth |
|---|---|---|
| `POST /auth/register` | Konto anlegen (i. d. R. nur Admin-Einladung) | – / Admin |
| `POST /auth/login` | Login, Token-Ausstellung | – |
| `POST /auth/refresh` | Access-Token erneuern | Refresh-Cookie |
| `POST /auth/logout` | Refresh-Token invalidieren | Access Token |
| `GET /api/me` | Eigenes Profil (für „Mein Profil"-Modul) | Access Token |
| `PATCH /api/me` | Eigene Personendaten ändern (Name, E-Mail, Sprache) | Access Token |
| `POST /api/sync/push` | Lokale Änderungen hochladen | Access Token |
| `GET /api/sync/pull` | Serverseitige Änderungen abholen | Access Token |
| `GET /api/export` | Voll-Export (optional, ergänzt bestehenden JSON-Export) | Access Token, Admin |

Bewusst **keine** granularen REST-Endpunkte pro Ressource (`/athletes/:id` etc.) als primärer Weg — die Sync-API ist der einzige Schreibpfad, um Konfliktlogik nicht doppelt (einmal für Sync, einmal für Direkt-CRUD) pflegen zu müssen. Optionale schreibgeschützte Ressourcen-Endpunkte (z. B. für einen künftigen Reporting-Export) können ergänzt werden, ohne die Sync-Logik zu berühren.

---

## 7. Konfliktbehandlung

Konflikt = Server hat für dieselbe `entityId` bereits eine neuere `updated_at`, als das eingehende Event als `clientUpdatedAt` mitbringt.

| Store-Kategorie | Strategie | Begründung |
|---|---|---|
| Stammdaten (`athletes`, `groups`, `exercises`, `templates`) | **Last-Write-Wins** nach Zeitstempel | Konflikte selten, Verlust unkritisch |
| Ergebnisse (`results`) | **Nie überschreiben** — bei Konflikt wird ein neuer Datensatz angelegt statt eines Updates | Eine Zeitmessung darf nie stillschweigend verschwinden |
| Trainingspläne/-vorlagen (`plans`, `templates`) mit verschachtelten Sets/Blöcken | Last-Write-Wins auf Dokumentebene (ganzes `jsonb`-Feld) | Feingranulares Merging der Blockstruktur wäre komplex; UI zeigt bei Konflikt einen Hinweis „wurde zwischenzeitlich geändert" an, sobald das Frontend das auswertet (spätere Ausbaustufe) |
| Anwesenheit/Feedback (`sessions`) | Last-Write-Wins je Einheit | Einheit wird i. d. R. nur von einer Person (Trainer:in) gepflegt |

Bei jedem Konflikt liefert die Push-Antwort `serverVersion` mit zurück (Abschnitt 6.1) — das Frontend kann diese perspektivisch dem Nutzer zur manuellen Klärung anzeigen, aktuell reicht automatisches Last-Write-Wins plus Protokollierung.

---

## 8. Integration mit dem bestehenden Frontend

| Bestehende Datei | Anpassung |
|---|---|
| `js/db.js` | Neues Modul `js/sync-client.js`: führt `push()`/`pull()` gegen die neue API aus, nutzt dabei die bereits vorhandenen `getSyncQueue()`/`updateSyncEvent()`-Funktionen |
| `js/modules/syncQueue.js` | `runSimulatedSync()` durch echten Aufruf von `sync-client.js` ersetzen — UI (Status/Badges/Retry) bleibt unverändert, da sie bereits auf `status: pending/synced/error` basiert |
| `js/state.js` | Profil-Umschalter durch echten Login-Flow ersetzen; `getCurrentUser()` liest Nutzerdaten aus dem validierten Access Token / `/api/me` |
| `js/modules/profile.js` | `updateProfile()` ruft zusätzlich `PATCH /api/me` auf, damit Namensänderungen serverseitig ankommen |
| `js/app.js` | Login-Bildschirm vor dem eigentlichen App-Shell ergänzen, solange kein gültiges Access Token vorliegt |

**Wichtig:** Die App bleibt auch ohne Backend-Verbindung voll nutzbar (Kern der Offline-first-Philosophie) — das Backend ergänzt Synchronisation, ersetzt aber nicht die lokale IndexedDB als primäre Datenquelle im Browser.

---

## 9. Sicherheit

- **HTTPS** verpflichtend (auch lokal via mkcert für Cookie-Tests, da `Secure`-Cookies HTTPS voraussetzen).
- **CORS**: nur die bekannte Frontend-Origin erlauben, `credentials: true` für den Refresh-Cookie.
- **Validierung**: jede Route validiert Body/Query mit Zod-Schemas aus `packages/shared-types` — dieselben Schemas können (mit Anpassung) auch clientseitig vor dem Absenden prüfen.
- **Rate Limiting** global (z. B. `@fastify/rate-limit`) sowie verschärft auf `/auth/*`.
- **Security-Header** (`@fastify/helmet`-Äquivalent).
- **Secrets** ausschließlich über Umgebungsvariablen (`.env`, niemals eingecheckt); getrennte Signier-Schlüssel je Umgebung.
- **DSGVO-Hinweis:** Einige Daten (RPE, Handlungsfelder/Gesundheitsnotizen) sind sensibel — Auftragsverarbeitungsvertrag mit Hosting-Anbieter und eine Lösch-/Export-Funktion pro betroffener Person (bereits im Frontend als JSON-Export vorhanden, serverseitig zu ergänzen) frühzeitig einplanen.

---

## 10. Deployment & Infrastruktur

- **CI (GitHub Actions):** ein Workflow, der bei jedem Push `lint`, `test`, `build` für alle Workspaces ausführt (Turborepo cached dabei unveränderte Pakete).
- **Containerisierung:** `apps/api/Dockerfile` (Multi-Stage-Build: install → build → schlankes Runtime-Image); `docker-compose.yml` im Root für lokale Entwicklung (API + Postgres, ein Kommando zum Hochfahren).
- **Migrationen:** `prisma migrate deploy` als eigener CI/CD-Schritt vor dem Rollout einer neuen API-Version.
- **Hosting-Optionen** (Kurzvergleich):

  | Anbieter | Eignung |
  |---|---|
  | Fly.io / Railway / Render | Schnellster Einstieg, verwaltete Postgres-Instanz inklusive, gut für Vereins-Budget |
  | Eigener vServer (z. B. Hetzner) + Docker | Günstiger im Betrieb, mehr Wartungsaufwand |

  Empfehlung für den Start: verwalteter Anbieter (Fly.io/Railway), da Team ohne dedizierten Ops-Aufwand auskommt.
- **Environments:** `dev` (lokal, docker-compose), `staging` (vor jedem Release), `prod`.
- **Frontend-Deployment** bleibt unverändert statisch (z. B. Netlify/eigener Webspace) — nur die API-Basis-URL wird als Build-/Runtime-Konfiguration injiziert.

---

## 11. Phasenplan

| Phase | Inhalt | Groker Aufwand* |
|---|---|---|
| **0 — Monorepo-Grundgerüst** | Workspace-Setup, `apps/api`-Skelett, CI-Pipeline, Docker-Compose | 2–3 Tage |
| **1 — Auth-Backend** | Register/Login/Refresh/Logout, JWT-Ausstellung, Passwort-Hashing, `users`-Tabelle inkl. `club_id` | 3–5 Tage |
| **2 — Datenmodell & Migrationen** | Prisma-Schema für alle Stores (Abschnitt 4), Seed-Skript analog `seed.js` | 3–4 Tage |
| **3 — Sync-API** | `/sync/push`, `/sync/pull`, Idempotenz, Konfliktlogik je Store-Kategorie | 5–7 Tage |
| **4 — Frontend-Integration** | `sync-client.js`, echter Login-Screen, `syncQueue.js` an echte API anbinden | 4–6 Tage |
| **5 — Sicherheitshärtung & Tests** | Rate-Limiting, Security-Header, Integrationstests für Sync/Konflikte, Lasttests | 3–5 Tage |
| **6 — Erweiterungen (optional)** | Realtime-Push (WebSocket/SSE), Mehrvereins-Verwaltung/Admin-UI, mobile Push-Benachrichtigungen | nach Bedarf |

\* Grobe Richtwerte für ein bis zwei Entwickler:innen; dienen der Priorisierung, nicht als verbindliches Angebot.

---

## 12. Offene Punkte & Risiken

- **Gleichzeitige Bearbeitung desselben Datensatzes** durch mehrere Trainer:innen ist mit Last-Write-Wins nur grob gelöst — bei tatsächlichem Bedarf wäre ein feingranulareres Merging (z. B. auf Ebene einzelner Trainingsplan-Sätze) eine spätere Ausbaustufe.
- **Erstmalige Migration bestehender Nutzer:innen** von lokalen Demo-Profilen zu echten Konten braucht einen einmaligen, sauber kommunizierten Übergang (z. B. „Konto erstellen" beim ersten Start nach Backend-Anbindung).
- **Kosten/Hosting** sollten früh mit dem Verein abgestimmt werden, da ein Dauerbetrieb (auch bei kleinem Datenvolumen) laufende Kosten verursacht, die die aktuelle rein clientseitige Version nicht hat.
- **DSGVO/Datenschutz:** rechtliche Prüfung (Auftragsverarbeitung, Einwilligungen für Athlet:innen bzw. deren Erziehungsberechtigte bei Minderjährigen) sollte vor Phase 4 (produktiver Betrieb mit echten Personendaten) abgeschlossen sein.
