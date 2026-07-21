# Backend-Entwicklungs- und Integrationsplan — Lane 1

**Stand:** Juli 2026 · **Status:** Phasen 0–4 vollständig umgesetzt, inkl. DSGVO-Auskunft/-Löschung (Art. 15 + 17) und Superadmin-Oberfläche — siehe Abschnitt 0 · **Ausgangslage:** Offline-first PWA (IndexedDB, Outbox-Pattern) · **Ziel:** echtes Node.js-Backend zur Mehrgeräte-/Mehrbenutzer-Synchronisation, mit JWT-Authentifizierung, Deployment als Monorepo

---

## 0. Umsetzungsstand auf einen Blick

Dieses Dokument war ursprünglich ein reiner Planungsstand vor Beginn der
Implementierung. Es wurde jetzt durchgängig aktualisiert, um den
**tatsächlichen** Stand widerzuspiegeln — inkl. der Stellen, an denen die
Umsetzung bewusst von der ursprünglichen Planung abgewichen ist, und der
Themen, die erst während der Umsetzung entstanden sind (DSGVO-Auskunft/
-Löschung, Superadmin-Oberfläche, echter E-Mail-Versand, Tombstones).

| Phase | Status |
|---|---|
| 0 — Monorepo-Grundgerüst | ✅ Abgeschlossen |
| 1 — Auth-Backend | ✅ Abgeschlossen |
| 2 — Datenmodell & Migrationen | ✅ Abgeschlossen |
| 3 — Sync-API | ✅ Abgeschlossen |
| 4 — Frontend-Integration | ✅ Abgeschlossen |
| DSGVO: Auskunft & Löschung (nicht Teil der ursprünglichen Phasen 0–4) | ✅ Abgeschlossen |
| Superadmin-Oberfläche „/admin" (nicht Teil der ursprünglichen Phasen 0–4) | ✅ Abgeschlossen |
| 5 — Sicherheitshärtung & weitere Tests | ◐ Teilweise (siehe Abschnitt 12) |
| 6 — Erweiterungen (optional) | ○ Nicht begonnen |

Details je Abschnitt unten; Abschnitt 11 (Phasenplan) und Abschnitt 12
(Offene Punkte) wurden komplett neu gefasst.

---

## 1. Ausgangslage und Zielsetzung

Lane 1 läuft heute vollständig offline-first im Browser: Alle Daten liegen in IndexedDB, jede Änderung wird zusätzlich als Event in einer lokalen Sync-Warteschlange (`syncQueue`-Store, Outbox-Pattern) protokolliert. Zu Beginn dieses Plans simulierte die Demo-Version die Übertragung dieser Events nur lokal — das ist **inzwischen nicht mehr der Fall** (siehe Abschnitt 8).

Ziel dieses Plans war es, ein echtes Backend zu entwickeln, das:

1. **Mehrere Geräte und Nutzer:innen** eines Vereins/Teams über eine zentrale Datenhaltung synchron hält,
2. eine **echte Authentifizierung** (statt des früheren Profil-Umschalters) auf Basis von **JWT** bereitstellt,
3. die im Frontend vorbereitete **Sync-Warteschlange** mit einer passenden **Push/Pull-API** bedient,
4. als **Monorepo** zusammen mit dem Frontend entwickelt, versioniert und deployed werden kann.

**Alle vier Ziele sind erreicht.** Zusätzlich kamen während der Umsetzung zwei Themenfelder hinzu, die im ursprünglichen Plan nicht vorgesehen waren, sich aber als notwendig erwiesen: eine **Superadmin-Oberfläche** zum Anlegen neuer Vereine (Abschnitt 13) und eine **vollständige DSGVO-Auskunfts-/Löschfunktion** (Abschnitt 14).

---

## 2. Monorepo-Architektur

### 2.1 Tooling-Entscheidung — tatsächlich umgesetzt

| Option | Bewertung | Umgesetzt? |
|---|---|---|
| **npm Workspaces** | Bereits Teil von npm, keine Zusatzabhängigkeit | ✅ Ja — alleinige Basis |
| **+ Turborepo** (ergänzend) | Caching von Build/Test-Läufen | ❌ **Nicht umgesetzt** — die CI-Laufzeiten blieben klein genug, dass sich der zusätzliche Konfigurationsaufwand bisher nicht gelohnt hat. Kann bei Bedarf nachgerüstet werden, ohne die Workspace-Struktur zu ändern. |
| Nx | Mehr Overhead als nötig | ❌ Nicht in Betracht gezogen |

**Ergebnis:** npm Workspaces allein reicht für die aktuelle Projektgröße (3 Pakete, 1 App) völlig aus.

### 2.2 Verzeichnisstruktur — tatsächlicher Stand

```
lane1-monorepo/
├─ package.json                 # Workspace-Root
├─ .github/workflows/ci.yml     # CI: Typecheck, Lint, Test, Build
├─ docker-compose.yml           # lokale Entwicklung: API + Postgres
│
├─ apps/
│  ├─ web/                      # PWA-Frontend
│  │  ├─ index.html, js/, css/, sw.js, manifest.json …
│  │  ├─ admin/                 # NEU: eigenständige, nur-online Superadmin-Oberfläche (Abschnitt 13)
│  │  └─ package.json
│  │
│  └─ api/                      # Node.js-Backend
│     ├─ src/
│     │  ├─ index.ts, app.ts    # Server-Einstiegspunkt, Fastify-App-Setup
│     │  ├─ config/             # env.ts (Zod-validiert)
│     │  ├─ auth/               # JWT (jose), Passwort-Hashing (hash-wasm/argon2id), Token-Utilities
│     │  ├─ mail/                # NEU: Mailer-Abstraktion (SMTP/Konsole/In-Memory) für Einladungs-E-Mails
│     │  ├─ jobs/                # NEU: zeitversetzter Purge-Job (DSGVO-Löschung, Abschnitt 14)
│     │  ├─ modules/
│     │  │  ├─ auth/            # /auth/*, /api/me, /api/me/export, /api/me
│     │  │  ├─ invitations/     # /api/clubs, /api/invitations (inkl. Mitgliederzahlen)
│     │  │  ├─ sync/            # /api/sync/push, /api/sync/pull
│     │  │  ├─ profile/          # NEU: DSGVO-Export/Löschanfrage-Gateway
│     │  │  └─ health/
│     │  ├─ db/                 # entityRegistry.ts (SyncStore -> Prisma-Delegate), prisma.ts (lazy Client)
│     │  └─ plugins/             # authenticate, authorize, security (CORS/Helmet/Rate-Limit)
│     ├─ prisma/
│     │  ├─ schema.prisma
│     │  └─ seed.ts
│     ├─ scripts/                # createSuperAdmin.ts, purgeDeletedData.ts (Cron)
│     ├─ test/                   # Spiegelt src/-Struktur, In-Memory-Repositories je Modul
│     ├─ tsconfig.json           # Production-Build (nur src/)
│     ├─ tsconfig.typecheck.json # NEU: Typprüfung inkl. test/, scripts/, prisma/ (Abschnitt 12)
│     └─ package.json
│
├─ packages/
│  ├─ shared-types/             # gemeinsame TS-Typen/Zod-Schemas (DTOs), u. a. entities.ts, syncEvent.ts, auth.ts, invitation.ts
│  ├─ shared-config/            # gemeinsames eslint/tsconfig
│  └─ sync-protocol/            # Konfliktregeln je Store-Kategorie, von web UND api importiert
│
└─ docs/
   └─ backend-plan.md           # dieses Dokument
```

**Abweichung vom ursprünglichen Plan:** Keine separaten Ressourcen-Module je fachlichem Store (`athletes/`, `competitions/`, …) — diese laufen wie geplant ausschließlich über die generische Sync-API (Abschnitt 6), ein Extra-Modul je Store hätte hier keinen Mehrwert geboten und wurde konsequent nicht angelegt.

### 2.3 Versionierung & Releases

- **Changesets wurden nicht eingeführt** — bei einer einzelnen deploybaren API-App (kein separat zu versionierendes Paket-Ökosystem) reichte eine einfache, manuell gepflegte Versionsnummer in `apps/api/package.json` (aktuell `0.2.0`).
- Frontend-Releases bleiben wie geplant statisch deploybar.

---

## 3. Technologie-Stack Backend — tatsächlich verwendet

| Bereich | Geplant | Tatsächlich | Anmerkung |
|---|---|---|---|
| Laufzeit | Node.js 22 LTS | ✅ Node.js 22 | wie geplant |
| Sprache | TypeScript | ✅ TypeScript (strict, `noUncheckedIndexedAccess`) | wie geplant |
| HTTP-Framework | Fastify | ✅ Fastify 5 | wie geplant |
| Datenbank | PostgreSQL | ✅ PostgreSQL | wie geplant |
| ORM | Prisma | ✅ Prisma 5 | wie geplant |
| Validierung | Zod | ✅ Zod, über `packages/shared-types` mit dem Frontend geteilt | wie geplant |
| JWT-Bibliothek | `fast-jwt` **oder** `@fastify/jwt` (offen) | **`jose`** | Entscheidung fiel auf `jose`: aktiver gepflegt, unterstützt RS256 nativ ohne Zusatzpakete, funktioniert identisch in Node und (potenziell künftig) Edge-Runtimes |
| Passwort-Hashing | argon2 | **`hash-wasm`** (argon2id) | reine WASM-Implementierung statt nativer Bindings — vermeidet plattformspezifische Build-Probleme beim Deployment |
| E-Mail-Versand | *nicht Teil des ursprünglichen Plans* | **`nodemailer`** | siehe Abschnitt 13 — wurde für den Einladungsversand der Superadmin-Oberfläche nötig |
| Tests | Vitest + Supertest | **Vitest allein** (über Fastifys `app.inject()`, kein echter HTTP-Server nötig) | Supertest erwies sich als unnötig — Fastifys eingebautes `inject()` deckt HTTP-Level-Tests vollständig ab |
| Logging | Pino | ✅ Pino (Fastify-nativ, `logger: env.NODE_ENV !== 'test'`) | wie geplant |

---

## 4. Datenmodell: Mapping IndexedDB → Server

Die bestehenden IndexedDB-Stores wurden wie geplant direkt in Server-Tabellen übertragen. Beide geplanten Ergänzungen wurden umgesetzt:

1. **Mandantenfähigkeit:** Tabelle `clubs`, jede fachliche Tabelle trägt `clubId`.
2. **Soft Deletes:** `deletedAt`-Zeitstempel auf jeder fachlichen Tabelle.

| IndexedDB-Store | Server-Tabelle | Umgesetzt wie geplant? |
|---|---|---|
| `users` | `users` | ✅ — zusätzlich: `consentGivenAt`/`consentVersion` (DSGVO-Einwilligung), `deletedAt` (siehe Abschnitt 14) |
| `athletes` | `athletes` | ✅ |
| `groups` | `groups` | ✅ |
| `competitions` | `competitions` | ✅ |
| `entries` | `startlist_entries` | ✅ |
| `results` | `results` | ✅ |
| `exercises` | `exercises` | ✅ — `equipment`/`tags` als `text[]`, keine eigene M:N-Tabelle nötig |
| `templates` | `templates` | ✅ — `sets` als `jsonb` |
| `plans` | `plans` | ✅ — `days` als `jsonb` |
| `sessions` | `sessions` | ✅ — `attendance` als `jsonb` |
| `actionItems` | `action_items` | ✅ |
| `syncQueue` | *kein 1:1-Pendant* | ✅ ersetzt durch `SyncedEvent` (Idempotenz-Ledger, siehe Abschnitt 6) |

**Zusätzlich, nicht im ursprünglichen Plan vorgesehen:**

- `Invitation` — einladungsbasierte Registrierung (Abschnitt 5)
- `RefreshToken` — Token-Rotation/-Widerruf (Abschnitt 5)
- `DataDeletionRequest` — DSGVO-Löschanfragen (Abschnitt 14)
- `SyncTombstone` — Löschmarkierungen unabhängig vom eigentlichen Datensatz (Abschnitt 14)

**Primärschlüssel:** wie geplant — Client-generierte UUIDs bleiben durchgängig als Primärschlüssel erhalten, keine ID-Übersetzung beim ersten Sync nötig.

**Wichtige Ergänzung zu Fremdschlüssel-Beziehungen (nicht im ursprünglichen Plan bedacht):** Modelle, die auf `User` verweisen (`RefreshToken`, `DataDeletionRequest`, `Invitation.invitedById`), benötigen explizites `onDelete`-Verhalten (`Cascade` bzw. `SetNull`) — sonst schlägt das tatsächliche Löschen eines Kontos (Abschnitt 14) an der referenziellen Integrität fehl. Das wurde erst beim Implementieren der DSGVO-Löschung bemerkt und nachträglich korrigiert.

---

## 5. Authentifizierung & Autorisierung (JWT)

### 5.1 Flow — mit einer wichtigen Planänderung

```
Einladung annehmen → POST /auth/register   (Token aus Einladungslink, Name, Passwort, Einwilligung)
Login              → POST /auth/login      (E-Mail, Passwort, Einwilligung)
                       ⇒ { accessToken, refreshToken }
Token-Refresh      → POST /auth/refresh    (refreshToken)
                       ⇒ { accessToken, refreshToken }  (Rotation, altes Token wird invalidiert)
Logout             → POST /auth/logout     (refreshToken wird serverseitig invalidiert)
```

**Wichtige Abweichung vom ursprünglichen Plan:** Es gibt **keine offene Selbstregistrierung** — der ursprüngliche Plan sah `POST /auth/register` mit direkt übergebener Rolle vor („Registrierung neuer Trainer:innen/Admins i. d. R. durch bestehenden Admin eingeladen, nicht offen zugänglich"). Umgesetzt wurde das konsequenter als ursprünglich skizziert: **jede** Kontoerstellung läuft ausschließlich über einen zeitlich befristeten Einladungslink (`Invitation`-Tabelle, `POST /api/invitations` bzw. `POST /api/clubs` für den allerersten Admin eines neuen Vereins). `POST /auth/register` nimmt daher als Eingabe **kein** `role`-Feld entgegen, sondern einen Einladungs-Token — Rolle, Verein und E-Mail-Adresse kommen ausschließlich aus der bereits bestehenden Einladung. Details siehe Abschnitt 13.

**Weitere, im ursprünglichen Plan nicht vorgesehene Ergänzung:** Sowohl Login als auch Einladungsannahme verlangen ein explizites `consent: true` (DSGVO-Einwilligung zur Datenverarbeitung) — wird bei jedem Login erneut mitgeschickt und mit Zeitstempel/Versionsnummer (`CURRENT_CONSENT_VERSION`) auf dem Nutzerkonto vermerkt.

### 5.2 Token-Design — wie geplant umgesetzt

| Token | Lebensdauer | Speicherort Client | Inhalt (Claims) |
|---|---|---|---|
| **Access Token** | 15 Min. (`JWT_ACCESS_TTL_SECONDS`) | im Speicher (JS-Modulvariable), **nicht** localStorage | `sub`, `role`, `clubId`, `athleteId`, `iat`, `exp` |
| **Refresh Token** | 30 Tage (`JWT_REFRESH_TTL_DAYS`), rotierend | **`localStorage`** (siehe unten) | opakes Zufalls-Token, serverseitig gehasht in `refresh_tokens` |

**Bewusste Abweichung vom ursprünglichen Plan:** Der Plan sah einen `httpOnly`/`Secure`/`SameSite=Strict`-Cookie für das Refresh Token vor. Umgesetzt wurde stattdessen **`localStorage`**, mit dem Refresh Token direkt im JSON-Antwortkörper von `/auth/login`/`/auth/register`/`/auth/refresh` — **das Backend setzt und erwartet an keiner Stelle ein Cookie** (kein `@fastify/cookie` im Einsatz). Grund: Eine echte Cookie-Lösung hätte serverseitiges Setzen mit korrektem `Domain`/`SameSite`-Handling für die konkrete Deployment-Topologie (Frontend und Backend ggf. auf unterschiedlichen Subdomains) erfordert, was für den aktuellen Umfang als unnötige Komplexität bewertet wurde. Das Access Token bleibt wie geplant ausschließlich im Speicher.

- **Signaturverfahren:** ✅ RS256, wie geplant (`jose`-Bibliothek, siehe Abschnitt 3).
- **Rotation & Revocation:** ✅ wie geplant, `RefreshToken`-Tabelle mit `tokenHash`/`expiresAt`/`revokedAt`; zusätzlich `revokeAllForUser()` für die DSGVO-Löschung (Abschnitt 14).
- **Passwort-Hashing:** ✅ argon2id via `hash-wasm` (siehe Abschnitt 3 zur Begründung).
- **Rollenprüfung:** ✅ `requireRole(...)`-PreHandler in `plugins/authorize.ts`, exakt wie geplant.
- **Rate Limiting:** ✅ auf `/auth/login`, 5 Versuche/Minute je IP+E-Mail.

### 5.3 Beispiel Access-Token-Payload

```json
{
  "sub": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "role": "trainer",
  "clubId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "athleteId": null,
  "iat": 1752150000,
  "exp": 1752150900
}
```

---

## 6. API-Design für die Synchronisierung — vollständig umgesetzt wie geplant

Die Sync-API wurde exakt nach dem ursprünglichen Entwurf umgesetzt: Push (Abschnitt 6.1), Pull (Abschnitt 6.2), Idempotenz über die Event-`id`, Konfliktantwort inkl. `serverVersion`.

### 6.1 Push

```
POST /api/sync/push
Authorization: Bearer <accessToken>

Body:
{
  "events": [
    {
      "id": "…",              // Idempotenz-Schlüssel, identisch mit der lokalen syncQueue-id
      "store": "athletes",
      "entityId": "…",
      "action": "update",      // create | update | delete
      "payload": { ... },       // vollständiger Datensatz (bei delete: null)
      "clientUpdatedAt": "2026-07-10T09:15:00.000Z"
    }
  ]
}

Response 200:
{
  "results": [
    { "eventId": "…", "status": "applied" },
    { "eventId": "…", "status": "conflict", "serverVersion": { ... } },
    { "eventId": "…", "status": "error", "message": "…" }
  ]
}
```

- **Idempotenz:** ✅ wie geplant, über die `SyncedEvent`-Tabelle (Prisma-Modell, entspricht der ursprünglich skizzierten `processed_events`-Tabelle).
- **Payload-Validierung:** zusätzlich zum ursprünglichen Plan — jedes Payload wird gegen das passende Zod-Schema aus `packages/shared-types` (`ENTITY_SCHEMAS`) geprüft, bevor es angewendet wird.
- **Vereins-Scoping:** ein Event darf nur Daten des eigenen Vereins betreffen — wird serverseitig anhand des JWT-Claims erzwungen, nicht anhand eines Client-Parameters.

### 6.2 Pull

```
GET /api/sync/pull?since=2026-07-10T08:00:00.000Z&cursor=<opak>
Authorization: Bearer <accessToken>

Response 200:
{
  "changes": [
    { "store": "results", "entityId": "…", "action": "update", "payload": { ... }, "updatedAt": "…" },
    { "store": "athletes", "entityId": "…", "action": "delete", "payload": null, "updatedAt": "…" }
  ],
  "nextCursor": "…",
  "hasMore": false
}
```

**Ergänzung gegenüber dem ursprünglichen Plan (siehe Abschnitt 14):** `action: "delete"` wird nicht nur anhand von `deletedAt` auf dem eigentlichen Datensatz gemeldet, sondern zusätzlich anhand eigenständiger **Tombstones** — schlanker Löschmarkierungen (nur `entityId`+Zeitpunkt, keine Personendaten), die auch dann noch existieren, wenn der zugrunde liegende Datensatz durch den DSGVO-Purge-Job bereits endgültig und unwiderruflich entfernt wurde. Ohne diese Ergänzung hätte ein Gerät, das länger als die Aufbewahrungsfrist offline bleibt, nie erfahren, dass eine Person/ihre Daten gelöscht wurden.

### 6.3 Wann wird synchronisiert?

✅ Wie geplant umgesetzt: Button „Jetzt synchronisieren" in der Sync-Warteschlange löst `push()` dann `pull()` aus (`apps/web/js/syncClient.js`).

**Wichtiger, beim Implementieren gefundener Bugfix (nicht im ursprünglichen Plan antizipiert):** `pull()` darf eingehende Änderungen **nicht** über die normalen lokalen `put()`/`remove()`-Funktionen übernehmen, da diese automatisch ein neues Outbox-Event erzeugen — sonst würde jede vom Server abgeholte Änderung sofort wieder zurückgesendet (Endlosschleife). Löst durch neue `putWithoutSync()`/`removeWithoutSync()`-Funktionen in `db.js`.

### 6.4 Endpunkt-Übersicht — tatsächlicher Stand

| Methode & Pfad | Zweck | Auth | Status ggü. Plan |
|---|---|---|---|
| `POST /auth/register` | Einladung annehmen, Konto aktivieren | Einladungs-Token | ✅ umgesetzt (Rolle/Verein kommen aus der Einladung, nicht als Client-Eingabe — siehe Abschnitt 5.1) |
| `POST /auth/login` | Login, Token-Ausstellung | – | ✅ umgesetzt (zusätzlich: Pflichtfeld `consent`) |
| `POST /auth/refresh` | Access-Token erneuern | Refresh Token (Body, nicht Cookie — siehe Abschnitt 5.2) | ✅ umgesetzt |
| `POST /auth/logout` | Refresh Token invalidieren | Access Token | ✅ umgesetzt |
| `GET /api/me` | Eigenes Profil | Access Token | ✅ umgesetzt |
| `PATCH /api/me` | Eigene Personendaten ändern | Access Token | ✅ umgesetzt |
| `GET /api/me/export` | DSGVO-Auskunft (Art. 15) | Access Token | ✅ **nicht im ursprünglichen Plan**, siehe Abschnitt 14 |
| `DELETE /api/me` | DSGVO-Löschanfrage (Art. 17) | Access Token | ✅ **nicht im ursprünglichen Plan**, siehe Abschnitt 14 |
| `POST /api/sync/push` | Lokale Änderungen hochladen | Access Token | ✅ umgesetzt |
| `GET /api/sync/pull` | Serverseitige Änderungen abholen | Access Token | ✅ umgesetzt |
| `POST /api/clubs` | Verein + ersten Admin anlegen | Access Token (superadmin) | ✅ **nicht im ursprünglichen Plan**, siehe Abschnitt 13 |
| `GET /api/clubs` | Vereinsliste inkl. Mitgliederzahlen | Access Token (superadmin) | ✅ **nicht im ursprünglichen Plan**, siehe Abschnitt 13 |
| `POST/GET/DELETE /api/invitations` | Einladungen verwalten | Access Token (admin/superadmin) | ✅ **nicht im ursprünglichen Plan**, siehe Abschnitt 13 |
| `GET /api/export` (Voll-Export, geplant) | — | — | ❌ **nicht umgesetzt** — durch `GET /api/me/export` (personenbezogen statt vollständig) funktional abgelöst |
| `GET /api/users` | Liste bestehender Vereinsmitglieder, sortiert nach Rolle | Access Token (admin/superadmin) | ✅ **nicht im ursprünglichen Plan**, ergänzt nach Abschluss der übrigen Phasen |

Der Grundsatz „keine granularen REST-Endpunkte pro fachlicher Ressource, Sync-API ist der einzige Schreibpfad" wurde konsequent eingehalten.

---

## 7. Konfliktbehandlung — wie geplant umgesetzt

| Store-Kategorie | Strategie | Umgesetzt? |
|---|---|---|
| Stammdaten (`athletes`, `groups`, `exercises`, `sessions` u. a.) | Last-Write-Wins nach Zeitstempel | ✅ |
| Ergebnisse (`results`) | Nie überschreiben — bei Konflikt neuer Datensatz statt Update | ✅ — **wichtiger, beim Testen gefundener Bug:** die neue Zeile darf nicht dieselbe (kollidierende) Client-ID wiederverwenden, sonst überschreibt sie serverseitig doch die ursprüngliche Zeile. Behoben durch serverseitig neu vergebene ID, die dem Client über `serverVersion.id` mitgeteilt wird. |
| Trainingspläne/-vorlagen (`plans`, `templates`) | Last-Write-Wins auf Dokumentebene | ✅ |

Implementiert in `packages/sync-protocol` (`resolveConflict()`), von `apps/api` und potenziell künftig auch client-seitig importierbar — wie im ursprünglichen Plan als eigenständiges Paket vorgesehen, um Drift zwischen Client- und Server-Logik zu vermeiden.

---

## 8. Integration mit dem bestehenden Frontend — vollständig umgesetzt

| Ursprünglich geplante Datei | Tatsächliche Umsetzung |
|---|---|
| `js/sync-client.js` | ✅ als `js/syncClient.js` — `push()`/`pull()` gegen die echte API, inkl. des in Abschnitt 6.3 beschriebenen Bugfixes |
| `js/modules/syncQueue.js` | ✅ `runSimulatedSync()` durch `syncClient.runSync()` ersetzt |
| `js/state.js` | ✅ echter Login-Flow (`login()`, `acceptInvitation()`, `logout()`, `restoreSession()`) statt Profil-Umschalter |
| `js/modules/profile.js` | ✅ `updateProfile()` ruft `PATCH /api/me`; zusätzlich (nicht geplant): Export-/Löschbuttons rufen `GET /api/me/export`/`DELETE /api/me` auf (Abschnitt 14) |
| `js/app.js` | ✅ Login-Bildschirm vor dem App-Shell, solange kein gültiges Access Token vorliegt |

**Neue Datei, nicht im ursprünglichen Plan:** `js/apiClient.js` — einziger Ort für HTTP-Aufrufe ans Backend, Token-Verwaltung, automatisches Refresh+Retry bei 401.

Die App bleibt wie geplant auch ohne Backend-Verbindung voll nutzbar.

---

## 9. Sicherheit

- ✅ CORS: nur die konfigurierte Frontend-Origin, via `@fastify/cors`.
- ✅ Validierung: jede Route validiert mit Zod-Schemas aus `packages/shared-types`.
- ✅ Rate Limiting: `@fastify/rate-limit`, global sowie verschärft auf `/auth/login`.
- ✅ Security-Header: `@fastify/helmet`.
- ✅ Secrets ausschließlich über Umgebungsvariablen (`.env`, `.env.example` als Vorlage, nie eingecheckt).
- **HTTPS:** nicht Teil dieses Repositories — liegt in der Verantwortung des Deployments (siehe Hetzner-Anleitung, Nginx-Reverse-Proxy mit Let's-Encrypt-Zertifikat).
- ✅ **DSGVO-Hinweis vollständig umgesetzt** (ursprünglich nur als Hinweis vermerkt): Auskunfts- und Löschfunktion existieren jetzt serverseitig vollständig, siehe Abschnitt 14. Ein Auftragsverarbeitungsvertrag mit dem Hosting-Anbieter bleibt weiterhin eine organisatorische (nicht technische) Aufgabe außerhalb dieses Repositories.

---

## 10. Deployment & Infrastruktur

- ✅ **CI (GitHub Actions):** `.github/workflows/ci.yml` — führt bei jedem Push Typecheck, Lint, Test und Build für alle Workspaces aus (siehe Abschnitt 12 zur nachträglich ergänzten Typecheck-Stufe).
- ✅ **Containerisierung:** `apps/api/Dockerfile`, `docker-compose.yml` im Root für lokale Entwicklung.
- ✅ **Migrationen:** `prisma migrate deploy` als Deployment-Schritt (siehe `hetzner-deployment-anleitung.md`).
- **Hosting:** Statt der ursprünglich verglichenen verwalteten Anbieter (Fly.io/Railway) wurde eine **eigene vServer-Lösung (Hetzner) mit Docker** gewählt und in einer separaten Anleitung (`hetzner-deployment-anleitung.md`) dokumentiert — Begründung: geringere laufende Kosten für einen einzelnen Verein, Wartungsaufwand als vertretbar bewertet.
- **Neu, nicht im ursprünglichen Plan:** Der Purge-Cron-Job (`npm run purge-deleted-data`, Abschnitt 14) muss zusätzlich zum eigentlichen App-Deployment eingerichtet werden — Details in der Hetzner-Anleitung und in Abschnitt 14 unten.

---

## 11. Phasenplan — tatsächlicher Verlauf

| Phase | Inhalt | Ursprünglich geschätzt | Status |
|---|---|---|---|
| **0 — Monorepo-Grundgerüst** | Workspace-Setup, `apps/api`-Skelett, CI-Pipeline, Docker-Compose | 2–3 Tage | ✅ Abgeschlossen |
| **1 — Auth-Backend** | Einladungsbasierte Registrierung, Login/Refresh/Logout, JWT-Ausstellung, Passwort-Hashing | 3–5 Tage | ✅ Abgeschlossen — Registrierung strenger als ursprünglich geplant (siehe Abschnitt 5.1) |
| **2 — Datenmodell & Migrationen** | Prisma-Schema für alle Stores, Seed-Skript analog `seed.js` | 3–4 Tage | ✅ Abgeschlossen |
| **3 — Sync-API** | `/sync/push`, `/sync/pull`, Idempotenz, Konfliktlogik je Store-Kategorie | 5–7 Tage | ✅ Abgeschlossen, inkl. Tombstone-Ergänzung (Abschnitt 14) |
| **4 — Frontend-Integration** | `sync-client.js`, echter Login-Screen, `syncQueue.js` an echte API anbinden | 4–6 Tage | ✅ Abgeschlossen |
| **— DSGVO: Auskunft & Löschung** *(nicht Teil der ursprünglichen Phasen)* | `GET /api/me/export`, `DELETE /api/me`, zeitversetzter Purge-Job, Tombstones | — | ✅ Abgeschlossen |
| **— Superadmin-Oberfläche „/admin"** *(nicht Teil der ursprünglichen Phasen)* | Vereine + erste Admins anlegen, Mitgliederzahlen, echter E-Mail-Versand | — | ✅ Abgeschlossen |
| **5 — Sicherheitshärtung & weitere Tests** | Rate-Limiting ✅, Security-Header ✅, Integrationstests ✅ (257 Tests), Lasttests ❌ | 3–5 Tage | ◐ Teilweise — siehe Abschnitt 12 |
| **6 — Erweiterungen (optional)** | Realtime-Push, mobile Push-Benachrichtigungen | nach Bedarf | ○ Nicht begonnen |

---

## 12. Offene Punkte & Risiken — aktualisiert

Die ursprüngliche Liste (gleichzeitige Bearbeitung, Migration bestehender Nutzer:innen, Kosten/Hosting, DSGVO) ist inzwischen größtenteils gegenstandslos oder gelöst. Aktueller Stand:

- **`purgeExpiredDeletions` läuft nicht automatisch:** Das CLI-Skript (`npm run purge-deleted-data`) muss per Cron auf dem Zielserver eingerichtet werden — der Code ist fertig und getestet, die Einrichtung liegt beim Deployment.
- **Lasttests fehlen** (Teil von Phase 5, nicht begonnen): Die Sync-API wurde funktional umfassend getestet (Idempotenz, Konflikte, Pagination), aber nicht unter Last (viele gleichzeitige Geräte/große Batches).
- **Gerät bleibt länger offline als die DSGVO-Aufbewahrungsfrist** (Standard 30 Tage): Wird durch Tombstones (Abschnitt 14) für **Löschungen** abgedeckt; ein analoger Mechanismus für andere Edge Cases (z. B. sehr lange Offline-Zeiten allgemein, unabhängig von Löschungen) wurde nicht gesondert untersucht.
- **Gleichzeitige Bearbeitung desselben Datensatzes** durch mehrere Trainer:innen bleibt mit Last-Write-Wins nur grob gelöst (unverändert gegenüber der ursprünglichen Einschätzung) — ein feingranulareres Merging wäre eine spätere Ausbaustufe.
- **Wichtiger Prozess-Fund während der Umsetzung (nicht im ursprünglichen Plan antizipiert):** Der Produktions-Build (`tsc -p tsconfig.json`) erfasst bewusst nur `src/` — dadurch blieben Typfehler in `test/`, `scripts/` und `prisma/` lange unentdeckt, obwohl die Tests selbst (Vitest/esbuild, ohne Typprüfung) grün liefen. Behoben durch eine zusätzliche `tsconfig.typecheck.json` samt `npm run typecheck`-Schritt in der CI — sollte bei künftigen Backend-Projekten von Anfang an mit eingeplant werden.
- **Kosten/Hosting:** durch die Entscheidung für einen eigenen vServer (Abschnitt 10) mit überschaubaren, planbaren Kosten gegenüber der ursprünglichen Unsicherheit weitgehend geklärt.
- **DSGVO/Datenschutz:** technische Seite (Auskunft, Löschung, Einwilligung) vollständig umgesetzt (Abschnitt 14). Die **rechtliche** Prüfung (Auftragsverarbeitungsvertrag mit dem Hosting-Anbieter, ggf. Einwilligung der Erziehungsberechtigten bei minderjährigen Athlet:innen) bleibt weiterhin eine organisatorische Aufgabe außerhalb dieses Repositories.

---

## 13. Superadmin-Oberfläche „/admin" (nicht Teil der ursprünglichen Phasen 0–4)

Während der Umsetzung stellte sich heraus, dass das Anlegen neuer Vereine
und deren erster Admin-Konten eine **eigenständige, bewusst nur online
verfügbare** Oberfläche braucht, getrennt vom offline-first App-Shell:

- **`apps/web/admin/`** (`index.html` + `admin.js`) — eigenständiges
  Skript ohne eigenen Service Worker; im Haupt-Service-Worker (`sw.js`)
  wird `/admin/*` explizit von Cache/Precache/Offline-Fallback
  ausgeschlossen (ein root-registrierter Service Worker hätte diesen Pfad
  sonst automatisch mit im Geltungsbereich).
- **`POST /api/clubs`** legt einen Verein **und** die Einladung für dessen
  ersten Admin in einem Zug an.
- **`GET /api/clubs`** liefert je Verein zusätzlich `memberCounts`
  (Admins/Trainer:innen/Athlet:innen, ermittelt per
  `prisma.user.groupBy()`, nur aktive Konten).
- **Echter E-Mail-Versand** (`apps/api/src/mail/mailer.ts`):
  `SmtpMailSender` (nodemailer) für den Produktivbetrieb,
  `ConsoleMailSender` als Ausweichlösung ohne SMTP-Konfiguration
  (protokolliert die Einladung samt Link statt eines Absturzes),
  `InMemoryMailSender` für Tests. Konfiguration über `SMTP_*`-
  Umgebungsvariablen und `FRONTEND_BASE_URL` (Basis-URL für den
  Einladungslink in der E-Mail).
- **Einladungslink erneuern:** Da das Klartext-Token serverseitig nur
  gehasht gespeichert wird (analog zu Passwörtern), lässt sich ein
  einmal erzeugter Link nicht nachträglich erneut anzeigen. Die
  Nutzerverwaltung bietet daher „Link erneuern" an — widerruft die alte
  Einladung und stellt eine neue mit identischen Daten aus.

---

## 14. DSGVO: Auskunft & Löschung (Art. 15 + 17) — nicht Teil der ursprünglichen Phasen 0–4

Der ursprüngliche Plan erwähnte DSGVO nur als Hinweis unter „Sicherheit"
(Abschnitt 9). Vollständig umgesetzt wurden:

| Endpunkt | Zweck |
|---|---|
| `GET /api/me/export` | Recht auf Auskunft (Art. 15) — bündelt eigenes Profil + (falls verknüpft) Athletenprofil, Ergebnisse, Startlisteneinträge, Handlungsfelder, Anwesenheitseinträge als JSON |
| `DELETE /api/me` | Recht auf Löschung (Art. 17) — sofortiger Soft-Delete + Widerruf aller Sitzungen, liefert das Datum der endgültigen Löschung (`purgeAfter`) |

**Zweistufiger Löschprozess:**

1. `DELETE /api/me` löst sofort einen Soft-Delete aus (Konto + verknüpfte
   fachliche Daten bekommen `deletedAt`, alle Refresh Tokens werden
   widerrufen) und legt einen `DataDeletionRequest` mit `purgeAfter` an
   (Standard: 30 Tage, konfigurierbar über `DATA_ERASURE_RETENTION_DAYS`).
2. Ein täglicher Cron-Job (`npm run purge-deleted-data`, siehe Abschnitt
   12) führt den endgültigen, unwiderruflichen Hard-Purge aus, sobald
   `purgeAfter` erreicht ist — löscht RefreshTokens, Athletenprofil samt
   Ergebnissen/Startlisteneinträgen/Handlungsfeldern, entfernt die
   Anwesenheits-Einträge aus den JSON-Anwesenheitslisten aller
   Trainingseinheiten des Vereins, und zuletzt den `User`-Datensatz selbst.

**Grenzfall „Gerät war länger offline als die Aufbewahrungsfrist" — zwei
zusätzliche Verbesserungen:**

1. **Tombstones** (`SyncTombstone`-Modell): schlanke Löschmarkierungen
   (nur `clubId`/`store`/`entityId`/`deletedAt`, keine Personendaten,
   bewusst ohne Fremdschlüssel-Beziehung), die der Purge-Job vor jedem
   endgültigen Löschen anlegt. `GET /api/sync/pull` meldet Löschungen
   jetzt auch anhand dieser Tombstones — so erfährt ein Gerät, das
   während der **gesamten** Aufbewahrungsfrist nie online war, trotzdem
   noch von der Löschung.
2. **Verständliche Fehlermeldung statt rohem Datenbankfehler:** Versucht
   ein solches Gerät danach trotzdem, neue Daten für die endgültig
   gelöschte Person zu pushen, scheitert das an der Datenbank-
   Fremdschlüsselbeziehung (Prisma-Fehlercode `P2003`).
   `describeSyncError()` in `sync.service.ts` erkennt das gezielt und
   liefert eine klare Meldung statt der rohen Postgres-Fehlermeldung.

**Frontend:** „Mein Profil" ruft beide Endpunkte direkt auf. Der
Export-Button fällt bei nicht erreichbarem Server auf einen Export der
lokal zwischengespeicherten Daten zurück; der Lösch-Button verlangt eine
erfolgreiche Server-Antwort, bevor der lokale Cache aufgeräumt wird — ein
fehlgeschlagener Serveraufruf darf nie dazu führen, dass nur lokal etwas
verschwindet, während das Konto serverseitig unverändert weiterbesteht
(diese Reihenfolge wurde erst nach einem entdeckten Bug in einer früheren
Fassung so festgelegt).

---

## 15. Testabdeckung — Stand

| Workspace | Tests |
|---|---|
| `apps/api` | 186 |
| `packages/shared-types` | 75 |
| `packages/sync-protocol` | 9 |
| **Gesamt** | **270** |

CI-Pipeline (`.github/workflows/ci.yml`): Typecheck (`tsconfig.typecheck.json`, inkl. `test/`/`scripts/`/`prisma/`) → Lint → Test → Build, für alle Workspaces.
