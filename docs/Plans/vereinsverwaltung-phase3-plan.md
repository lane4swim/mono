# Plan: Vereinsverwaltung — Phase 3 (Abschnitt 5 des Feature-Brainstorms)

Umsetzungsplan für Phase 3 aus `docs/future-features-brainstorm.md` (Abschnitt
„Priorisierung: Phasenplanung"): Abschnitt 5, bestehend aus zwei
Einzelfeatures — 5.1 Mehrere Gruppen-Trainer:innen/Vertretungsregelung,
5.2 Audit-Log für sicherheitsrelevante Aktionen. Analog zu
`docs/Plans/trainingsplanung-phase1-plan.md` ein konkreter Umsetzungsplan,
direkt begleitend zur Implementierung geschrieben (kein reines
Vorab-Dokument).

## Umsetzungsstand

**Phase 3 ist damit vollständig umgesetzt** (beide Teile).

| Teil | Status |
|---|---|
| 5.1 Mehrere Gruppen-Trainer:innen/Vertretungsregelung | **umgesetzt** — siehe Abschnitt 1.6 |
| 5.2 Audit-Log für sicherheitsrelevante Aktionen | **umgesetzt** — siehe Abschnitt 2.7 |

## 0. Ausgangslage

- **Es gibt aktuell KEINE Gruppen-Trainer-Zuordnung überhaupt** — weder
  1:n noch n:m. `Group` (`apps/api/prisma/schema.prisma`) hat kein
  Trainer-Feld; die Rolle `trainer` hat bereits heute club-weiten
  Lesezugriff auf ALLE Gruppen des eigenen Vereins
  (`sync.permissions.ts: STORE_PERMISSIONS.groups = coachManaged`, ohne
  gruppenspezifische Einschränkung in `sync.athleteScope.ts` o. ä.). Die im
  Brainstorm vermutete „aktuell vermutlich 1:n"-Beziehung existiert also
  nicht — 5.1 führt eine komplett neue, rein organisatorische Zuordnung
  ein, **keine Zugriffsbeschränkung**: „Vertretung mit vollen Rechten"
  ist bereits der Ist-Zustand für jede Trainer:in im Verein. Der Nutzen von
  5.1 ist Transparenz/Zuständigkeit („wer ist für diese Gruppe
  verantwortlich"), nicht Zugriffskontrolle — eine echte
  Zugriffsbeschränkung auf zugeordnete Gruppen wäre ein grundlegend
  anderer, deutlich größerer Eingriff (jedes bestehende
  gruppenübergreifende Modul — `stats`, `plans`, `athletes`, `sessions` —
  müsste neu gescoped werden) und ist explizit NICHT Teil dieser Phase.
- **`Group` ist ein rein generischer Sync-Store, kein bespoke REST-Modul**
  — Schreibpfad ausschließlich über `sync.route.ts` → `sync.gateway.ts:
  create()/update()`, die den Zod-validierten Payload 1:1 als
  `delegate.create({ data: payload })` an Prisma reichen. Das erzwingt für
  5.1: **jedes neue Feld auf `Group` muss ein Prisma-Skalarfeld sein**,
  keine echte Relation (die `connect`/`set`-Syntax bräuchte, die der
  generische Gateway-Code nicht kennt) — analog dazu, wie `User.roles`
  und `Club.enabledModules` bereits heute als `String[]`-Skalarspalten
  modelliert sind statt als echte Relationen.
- **Sicherheitsrelevante Aktionen sind aktuell protokollarisch nicht
  nachvollziehbar** — `Invitation` hat zwar `invitedById`, aber keine
  Historie über Widerruf/Rollenänderungen/Löschungen. Betroffene
  Endpunkte (siehe Abschnitt 2.2) liegen alle backend-only außerhalb des
  generischen Sync-Systems (analog `UserQualification`/
  `RefereeAssignment` — siehe deren Modulkommentare „kein Sync-Store").

## 1. Abschnitt 5.1 — Mehrere Gruppen-Trainer:innen / Vertretungsregelung

### 1.1 Konzept

`Group` bekommt ein neues Feld `trainerIds: string[]` — die Menge der für
diese Gruppe **zuständigen** Trainer:innen/Admins. **Bewusst keine
Unterscheidung Haupttrainer:in/Vertretung im Datenmodell:** der Brainstorm
selbst sagt, die Vertretung habe „volle Rechte für diese Gruppe" — da alle
Einträge funktional gleichwertig sind (siehe Ausgangslage: ohnehin
club-weiter Zugriff), wäre eine Rangfolge rein kosmetisch. Ein einfaches,
ungeordnetes Set ist die naheliegendere, nicht überkonstruierte Lösung;
die UI zeigt alle Einträge gleichrangig als „Zuständige Trainer:innen".

Reine Organisations-/Anzeige-Information — **keine Berechtigungsprüfung
hängt daran** (siehe Ausgangslage). Explizit vermerkt, damit das nicht
später fälschlich als Zugriffskontrolle missverstanden wird.

### 1.2 Datenmodell

**Prisma:**

```prisma
model Group {
  // … bestehende Felder unverändert …
  // Zuständige Trainer:innen/Admins dieser Gruppe (User.id) — rein
  // organisatorisch (siehe Plan-Abschnitt 1.1), KEINE Berechtigungsprüfung
  // hängt daran. Skalarfeld statt echter Relation: Group ist ein
  // generischer Sync-Store (sync.gateway.ts reicht Payloads unverändert an
  // Prisma durch, kein connect/set-Handling) — analog User.roles/
  // Club.enabledModules. Keine FK-Constraint: ein Eintrag kann auf ein
  // inzwischen gelöschtes Konto zeigen, siehe purgeExpiredDeletions.ts für
  // die Aufräumlogik beim Hard-Purge (Abschnitt 1.5).
  trainerIds String[] @default([])
}
```

Migration additiv (`ALTER TABLE "groups" ADD COLUMN "trainerIds" TEXT[]
NOT NULL DEFAULT '{}'`), kein Backfill nötig.

**Zod (`packages/shared-types/src/entities.ts`):**

```ts
export const GroupSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  trainerIds: z.array(z.string().uuid()).max(50).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
```

Kein neuer Sync-Store, keine Registry-Änderung nötig (`groups` existiert
bereits in `ENTITY_SCHEMAS`/`STORE_PERMISSIONS`/`STRATEGY_BY_STORE`) — nur
ein zusätzliches Feld auf einem bestehenden Store, analog
`TrainingSession.actualDistance` in Phase 1.

### 1.3 UI

`apps/web/js/modules/athletes.js: openGroupModal()` — bisher nur
Name/Beschreibung beim Anlegen, **keine Bearbeitung bestehender Gruppen**
(nur Löschen). Ergänzt um:

1. Ein Mehrfachauswahlfeld „Zuständige Trainer:innen" (Checkbox-Liste,
   analog `clubForm.js: buildModuleCheckboxes()`), befüllt über die
   bereits bestehende `GET /api/users/trainers`
   (`api.listAssignableTrainers()` — liefert Trainer:innen **und** Admins
   des eigenen Vereins, exakt die Zielgruppe für dieses Feld) — kein neuer
   Endpunkt nötig.
2. **Neu: Bearbeiten bestehender Gruppen** (Name/Beschreibung/
   Trainer:innen) — bisher nicht vorhanden, aber ohne das ließe sich
   `trainerIds` nach dem Anlegen nie mehr ändern. Ein „Bearbeiten"-Button
   je Zeile öffnet dasselbe Formular vorbefüllt, Speichern per `put()`
   mit vorhandener `id` (bestehendes Update-Verhalten von `put()`, siehe
   `db.js`).
3. Zeilenanzeige ergänzt um die Namen der zugeordneten Trainer:innen als
   kleine Zeile unter dem Gruppennamen (Auflösung `trainerIds` →
   Namen über dieselbe `trainers`-Liste), leer wenn keine zugeordnet.

Rollen unverändert (`athletes`-Modul-Rollen `['trainer', 'admin',
'athlete']`, Bearbeiten/Zuordnen weiterhin nur `trainer`/`admin` wie beim
bestehenden Anlegen/Löschen).

### 1.4 Sync

| Store | Änderung | Konfliktregel |
|---|---|---|
| `groups` | Feld `trainerIds` optional ergänzt | unverändert (`last-write-wins`) |

Kein neuer REST-Endpunkt, keine neue Konfliktlogik.

### 1.5 Aufräumen bei Konto-Löschung

`purgeExpiredDeletions.ts`/`erasure.repository.ts` löschen ein Konto
endgültig (Hard-Purge nach Ablauf der Aufbewahrungsfrist). Da
`trainerIds` **keine** FK-Constraint hat (Abschnitt 1.2), bliebe eine
gelöschte Nutzer-ID sonst dauerhaft in `Group.trainerIds` stehen.
Ursprünglich geplant: im Hard-Purge alle Gruppen des Vereins mit
`trainerIds: { has: userId }` finden und die ID aus dem Array entfernen.

**Beim Umsetzen zurückgestellt** (siehe Abschnitt 4): `erasure.
repository.ts` ist ein GDPR-kritischer, bereits mit mehreren
sorgfältig kommentierten Roh-SQL-Passagen (JSONB-Containment,
`jsonb_path_exists`) abgesicherter Pfad, dessen Korrektheit in dieser
Sandbox mangels echter Postgres-Instanz nicht verifizierbar ist (siehe
bereits bestehender Vorbehalt bei den Migrationen). Eine zusätzliche,
ungetestete Änderung an genau dieser Transaktion einzuführen wäre ein
unverhältnismäßiges Risiko für einen unwiderruflichen Löschvorgang, um
einen rein kosmetischen Zustand zu vermeiden: eine verwaiste ID in
`trainerIds` ist nie sichtbar (die Frontend-Anzeige löst IDs gegen die
aktuelle Trainer:innen-Liste auf und blendet unbekannte IDs per
`.filter(Boolean)` automatisch aus, siehe `athletes.js:
trainerNames()`) und beeinträchtigt keine Berechtigungsprüfung (siehe
Abschnitt 1.1 — es gibt keine).

**Bewusst NICHT behandelt:** Verlust der Rolle `trainer`/`admin` (ohne
Kontolöschung) entfernt die Person NICHT automatisch aus `trainerIds`
bestehender Gruppen — analog dazu, wie `RefereeAssignment.
createdByAdminId` bei einem Rollenwechsel ebenfalls nicht nachgezogen
wird. Die Person existiert weiterhin, ein manuelles Entfernen über die
UI (Abschnitt 1.3) bleibt möglich.

### 1.6 Umsetzungsstand: **umgesetzt**

- `apps/api/prisma/schema.prisma` — `Group.trainerIds String[] @default([])`
  wie geplant, keine FK-Constraint; Migration
  `20260911090000_add_group_trainer_ids` (`ALTER TABLE "groups" ADD COLUMN
  "trainerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`, exakt analog zu
  `enabledModules`/`roles`). **Nicht gegen eine echte Postgres-Instanz
  geprüft** (kein Docker-Zugriff in dieser Sandbox, wie bei den
  Phase-1-Migrationen) — `npx prisma validate`/`generate` liefen aber
  gegen eine generierte Client-Definition fehlerfrei.
- `packages/shared-types/src/entities.ts: GroupSchema` — `trainerIds:
  z.array(z.string().uuid()).max(50).default([])`. Kein neuer Sync-Store,
  keine Registry-/Berechtigungs-/Konfliktregel-Änderung nötig (Store
  `groups` existiert bereits) — vier neue `GroupSchema`-Tests
  (`packages/shared-types/test/entities.test.ts`: Default, gültige Liste,
  ungültige UUID, > 50 Einträge).
- `apps/api/src/jobs/erasure.repository.ts` — **abweichend von Abschnitt
  1.5 NICHT umgesetzt:** die geplante Bereinigung von `trainerIds` beim
  Hard-Purge wurde beim Umsetzen bewusst zurückgestellt (kein Blocker für
  die Kernfunktion, siehe Abschnitt 4 „Nicht Teil dieser Phase" —
  nachträglich dort ergänzt). Eine gelöschte Nutzer-ID kann daher aktuell
  in `Group.trainerIds` verbleiben; die Frontend-Anzeige blendet sie
  bereits unauffällig aus (`trainerNames()` in `athletes.js` filtert IDs
  ohne Treffer in der Trainer:innen-Liste per `.filter(Boolean)` heraus),
  ein sichtbarer Fehlerzustand entsteht also nicht — nur ein inhaltlich
  „verwaister", nie angezeigter Eintrag im Array.
- `apps/web/js/modules/athletes.js` — `openGroupModal()` erweitert:
  **neu Bearbeiten bestehender Gruppen** (vorher nur Anlegen/Löschen),
  Mehrfachauswahl „Zuständige Trainer:innen" (`buildTrainerCheckboxes()`,
  Checkbox-Liste analog `clubForm.js: buildModuleCheckboxes()`), befüllt
  über die bereits bestehende `fetchAssignableTrainers()`
  (`actionItems.js`, wiederverwendet statt dupliziert — liefert
  zusätzlich den bewährten Offline-/Demo-Fallback auf die eigene Person).
  Gruppenzeilen zeigen zugeordnete Trainer:innen-Namen als Unterzeile.
- Übersetzungsschlüssel `athletes.formGroupTrainers`/`noTrainersYet`/
  `groupTrainersLabel` in `de-DE.js`/`en-US.js`.
- `apps/web/sw.js`: Cache-Version auf `lane1-v45` (siehe Abschnitt 2.7 für
  den zweiten Grund dieser Erhöhung — `auditLog.js` neu precacht).
- Tests: `apps/web/test/athletes.module.test.js` (neu, Import-/
  Sichtbarkeits-Sanity-Test analog `kampfrichter.module.test.js`) — kein
  voller `render()`-Test für `openGroupModal()`/`buildTrainerCheckboxes()`
  (dafür gibt es im Repo kein etabliertes Muster, siehe Kommentar dort).
  Gesamte Testsuite bleibt grün: `shared-types` 205/205, `apps/api`
  574/574, `apps/web` 274/274, `sync-protocol` 9/9; `npm run lint` sauber
  in allen vier Workspaces; Prisma-Schema valide (`npx prisma validate`).

## 2. Abschnitt 5.2 — Audit-Log für sicherheitsrelevante Aktionen

### 2.1 Konzept

Ein Append-only-Protokoll sicherheitsrelevanter Aktionen, einsehbar für
`admin` (eigener Verein) und `superadmin` (alle Vereine) — Scope laut
Brainstorm: „wer hat wann welche Einladung erstellt/widerrufen, welches
Konto gelöscht, welche Rolle geändert". Vier Aktionstypen in dieser Phase:

- `invitation.created`
- `invitation.revoked`
- `user.rolesChanged`
- `user.deletionRequested`

**Bewusst kein eigener Sync-Store** (analog `UserQualification`/
`RefereeAssignment`, siehe deren „kein Sync-Store"-Kommentare): rein
serverautoritativ, nie clientseitig geschrieben, kein Offline-Anlegen,
keine Konfliktsemantik — passt nicht ins Sync-Store-Modell. Backend-only
REST-Modul nach dem etablierten Muster von `qualifications`/`referees`
(Repository + Service + Route, eigene DI-Verdrahtung in `app.ts`).

### 2.2 Hook-Punkte (bestehender Code, unverändert in ihrer Fachlogik)

| Aktion | Datei:Funktion | Akteur/Ziel bereits im Scope? |
|---|---|---|
| `invitation.created` | `invitations.service.ts: createInvitation()` | ja (`requester`, `invitation`) |
| `invitation.revoked` | `invitations.service.ts: revoke()` | ja (`requester`, `invitation`) |
| `user.rolesChanged` | `auth.service.ts: updateUserRoles()` | Akteur-ID fehlt bisher im Aufruf (siehe 2.3) |
| `user.deletionRequested` | `auth.service.ts: requestAccountDeletion()` | Akteur = Ziel (Selbstlöschung), Name/E-Mail per zusätzlichem `users.findById()` |

**Bewusst NICHT in dieser Phase:** Protokollierung des tatsächlichen
Hard-Purge (`purgeExpiredDeletions.ts`) — zum Zeitpunkt des Purge ist die
Person bereits per `user.deletionRequested` protokolliert (inkl.
Zeitpunkt der Anfrage); ein zweiter Eintrag zum tatsächlichen,
zeitversetzten Löschzeitpunkt liefert keinen zusätzlichen
Nachvollziehbarkeits-Nutzen (die Frist `purgeAfter` steht bereits im
ersten Eintrag) und der Akteur wäre ohnehin nur „System" (Cron-Job, kein
Mensch) — passt nicht zum Zweck „wer hat wann was veranlasst".

### 2.3 Datenmodell

**Prisma:**

```prisma
model AuditLogEntry {
  id         String   @id @default(uuid())
  // null nur für künftige, nicht vereinsgebundene Superadmin-Aktionen
  // (z. B. Vereinsanlage) — alle vier Aktionstypen dieser Phase befüllen
  // clubId immer.
  clubId     String?
  club       Club?    @relation(fields: [clubId], references: [id], onDelete: SetNull)
  // Nullable + SetNull (analog Invitation.invitedById): ein gelöschtes
  // Konto darf den Log-Eintrag nicht mitreißen — genau der Fall, den
  // dieses Protokoll gerade für spätere Nachvollziehbarkeit festhalten soll.
  actorId    String?
  actor      User?    @relation("AuditLogActor", fields: [actorId], references: [id], onDelete: SetNull)
  // Schnappschuss zum Zeitpunkt der Aktion (Name + E-Mail) — bleibt auch
  // nach Löschung/Umbenennung des Kontos lesbar, ohne dass ein Join nötig
  // wäre. Analog zum Muster "Snapshot statt Referenz" aus Phase 1.
  actorLabel String
  action     String
  // Betroffene Entität — kein Fremdschlüssel (heterogen: Invitation ODER
  // User), rein informativ.
  targetId    String?
  targetLabel String  @default('')
  // Aktionsspezifische Zusatzdaten (z. B. { role, email } bei Einladungen,
  // { oldRoles, newRoles } bei Rollenänderungen) — Json statt einzelner
  // Spalten je Aktionstyp, analog Plan.days/Template.sets.
  metadata   Json     @default("{}")
  createdAt  DateTime @default(now())

  // Zugriffsmuster: "alle Einträge eines Vereins, neueste zuerst"
  // (Admin-Ansicht) — Superadmin-Ansicht (vereinsübergreifend) filtert
  // zusätzlich client-seitig nach Verein, kein zweiter Index nötig für
  // das erwartete Datenvolumen dieser Phase.
  @@index([clubId, createdAt])
  @@map("audit_log_entries")
}
```

Append-only: keine `updatedAt`/`deletedAt` — Einträge werden nie
geändert oder gelöscht (auch kein Bezug zur DSGVO-Löschfrist einzelner
Nutzer:innen; der Zweck des Protokolls — Rechenschaftspflicht Art. 5
Abs. 2 DSGVO — überwiegt hier bewusst, analog dazu, wie
`QualificationReminderLog` ebenfalls dauerhaft/ohne eigene Löschlogik
geführt wird).

**Kein Zod-Schema in `packages/shared-types/src/entities.ts`** (kein
Sync-Store, siehe 2.1) — stattdessen ein schlankes Response-Schema in
einem neuen `packages/shared-types/src/auditLog.ts` (nur für die
Serialisierung der Leseantwort, analog `referee.ts`).

### 2.4 Backend-Modul `apps/api/src/modules/auditLog/`

Struktur analog `qualifications`/`referees`:

- `auditLog.repository.ts` (+ `.memory.ts`) — `record(entry)`,
  `list({ clubId, before, limit })`.
- `auditLog.service.ts` — `createAuditLogService(deps)` mit
  - `record(input)`: interner Schreibpfad, von `invitationsService`/
    `authService` aufgerufen (siehe 2.5) — **kein eigener REST-Endpunkt
    zum Schreiben**, ausschließlich serverintern.
  - `list(requester, { before, limit })`: `admin` → eigener Verein,
    `superadmin` → alle (optional `clubId`-Filter per Query-Param),
    analog `invitationsService.list()`.
- `auditLog.route.ts` — `GET /api/audit-log`, `requireAnyRole('admin',
  'superadmin')`.

**DI-Verdrahtung in `app.ts`:** `auditLogService` wird VOR
`invitationsService`/`authService` konstruiert und deren Deps als
schlankes `AuditLogWriter`-Interface (nur `record()`) mitgegeben — analog
dazu, wie `mailer` bereits heute in beide injiziert wird. Kein
zirkulärer Import (`auditLog`-Modul hat keine Abhängigkeit auf
`invitations`/`auth`).

### 2.5 Änderungen an bestehendem Code

- `invitations.service.ts`: `InvitationsServiceDeps` bekommt `auditLog:
  AuditLogWriter`; `createInvitation()`/`revoke()` rufen nach
  erfolgreichem Schreiben `deps.auditLog.record(...)` auf (fire-and-forget
  NACH der eigentlichen Fachtransaktion — ein Fehlschlag des Audit-Logs
  darf die eigentliche Aktion nicht rückgängig machen oder blockieren,
  aber sollte geloggt werden, falls er auftritt).
- `auth.service.ts`: `AuthServiceDeps` bekommt `auditLog: AuditLogWriter`.
  - `updateUserRoles(targetUserId, roles, requester)`: Signatur von
    `requester: { clubId }` auf `requester: { id, clubId }` erweitert
    (Akteur-ID fehlte bisher, siehe Tabelle 2.2) — `auth.route.ts`-Aufruf
    entsprechend angepasst (`request.user!.sub` ergänzt). `metadata:
    { oldRoles: target.roles, newRoles: roles }`.
  - `requestAccountDeletion(userId)`: zusätzlicher `deps.users.findById()`
    vor dem eigentlichen Aufruf für den `actorLabel`/`targetLabel`-
    Schnappschuss (Akteur = Ziel).

### 2.6 Frontend

Neues Modul `apps/web/js/modules/auditLog.js` (`id: 'auditlog'`, Rollen
`['admin', 'superadmin']`), Tabelle (Zeitpunkt, Aktion, Akteur, Ziel,
Details aus `metadata`), einfache „mehr laden"-Paginierung über den
`before`-Cursor. In `CORE_MODULE_IDS`
(`apps/web/js/router.js`) und `NAV_GROUPS.admin.moduleIds`
(`apps/web/js/shell.js`) ergänzt (Infrastruktur, kein zubuchbares Modul —
analog `usermgmt`). `IS_DEMO`-Guard wie `userManagement.js` (kein Backend
im Demo-Modus).

### 2.7 Umsetzungsstand: **umgesetzt**

- **Datenmodell** — `AuditLogEntry` wie geplant (append-only, kein
  `deletedAt`), Migration `20260911091500_add_audit_log_entry`. **Nicht
  gegen eine echte Postgres-Instanz geprüft** (kein Docker-Zugriff in
  dieser Sandbox); `npx prisma validate`/`generate` liefen fehlerfrei.
  Kein Zod-Schema in `entities.ts`/`ENTITY_SCHEMAS` (wie geplant, kein
  Sync-Store).
- **Backend-Modul `apps/api/src/modules/auditLog/`** — Repository
  (Prisma + In-Memory), Service (`record()`/`list()`,
  `ClubIdRequiredError`), Route (`GET /api/audit-log`,
  `requireAnyRole('admin', 'superadmin')`) — exakt wie in Abschnitt 2.4
  geplant. `ClubIdRequiredError` in `httpErrorHandler.ts` registriert
  (400). DI-Verdrahtung in `app.ts`: `auditLogService` VOR
  `invitationsService`/`authService` konstruiert, beiden als
  `AuditLogWriter` injiziert.
- **Hook-Punkte** — `invitations.service.ts: createInvitation()`/
  `revoke()` sowie zusätzlich `createClub()` (im Plan nicht explizit
  genannt, aber dieselbe Aktionsart `invitation.created` — eine
  Vereinsanlage erzeugt implizit die erste Admin-Einladung, siehe
  Abschnitt 2.2-Ergänzung); `auth.service.ts: updateUserRoles()`/
  `requestAccountDeletion()`. `updateUserRoles()`-Signatur musste dafür
  um `requester.id` erweitert werden (fehlte bisher, siehe Abschnitt 2.2-
  Tabelle) — `auth.route.ts` reicht seither `request.user!.sub` durch.
  Alle vier Schreibpfade protokollieren NACH der eigentlichen
  Fachtransaktion (siehe `auditLog.service.ts: record()`-Kommentar).
- **Frontend** — `apps/web/js/modules/auditLog.js` (neu, Modul-ID
  `auditlog`, Rollen `['admin', 'superadmin']`): Tabelle
  (Zeitpunkt/Aktion/Akteur/Ziel), „Weitere laden"-Cursor-Paginierung
  (`before`), `IS_DEMO`-Guard wie `userManagement.js`. In
  `router.js: CORE_MODULE_IDS` und `shell.js: NAV_GROUPS.admin.moduleIds`
  ergänzt (reine Infrastruktur, kein zubuchbares Modul-Paket — analog
  `usermgmt`). `apiClient.js: listAuditLog()` neu. Übersetzungs-
  Namensraum `auditLog.*` (inkl. `auditLog.action.*` für die
  menschenlesbare Zusammenfassung der `metadata`) sowie `nav.auditlog`
  in `de-DE.js`/`en-US.js`.
- `apps/web/sw.js`: `auditLog.js` precacht, Cache-Version auf `lane1-v45`
  (gemeinsam mit der Erhöhung aus Abschnitt 1.6 — beide Änderungen kamen
  im selben Umsetzungsschritt).
- **Tests:** `apps/api/test/auditLog/auditLog.service.test.ts` (13 Fälle:
  `record()`, Vereins-Scoping in `list()` für admin/superadmin, Cursor-
  Sortierung, Limit-Deckelung), `apps/api/test/auditLog/
  auditLog.route.test.ts` (5 Fälle: Authentifizierung, Rollen-Guard,
  admin-/superadmin-Sicht). Regressionstests in `invitations.service.
  test.ts` (3 neue Fälle: `createInvitation()`/`revoke()`/`createClub()`
  protokollieren korrekt) und `auth.service.test.ts` (2 neue Fälle:
  `updateUserRoles()`/`requestAccountDeletion()` protokollieren korrekt,
  inkl. Akteur-Identität). Alle sieben bestehenden Testdateien, die
  `createInvitationsService()`/`createAuthService()` direkt konstruieren
  (`invitations.route.test.ts`, `auth.service.test.ts`,
  `auth.route.test.ts`, `sync.route.test.ts`, `plugins/security.test.ts`
  [3 Stellen], `health.test.ts`), um den neuen Pflicht-Dependency
  `auditLog` ergänzt. Gesamte Testsuite bleibt grün: `apps/api` 574/574
  (inkl. Typecheck & Lint fehlerfrei), Prisma-Schema valide.

## 3. Rollen & Berechtigungen (zusammenfassend)

| Feature | `admin` | `superadmin` | `trainer` | `athlete` |
|---|---|---|---|---|
| 5.1 Gruppen-Trainer:innen zuordnen | ja | — (kein Verein) | ja (wie bisheriges Gruppen-Anlegen) | nein (nur Lesezugriff wie bisher) |
| 5.2 Audit-Log einsehen (eigener Verein / alle) | ja / — | ja / ja | nein | nein |

## 4. Nicht Teil dieser Phase

- Echte Zugriffsbeschränkung von Trainer:innen auf zugeordnete Gruppen
  (Ausgangslage, Abschnitt 0) — reine Anzeige-/Organisationsfunktion.
- Bereinigung von `Group.trainerIds` beim Hard-Purge eines Kontos
  (ursprünglich in Abschnitt 1.5 geplant, siehe dortige Begründung für
  die Zurückstellung) — verwaiste IDs bleiben bestehen, sind aber nie
  sichtbar und ohne Berechtigungswirkung.
- Protokollierung des Hard-Purge selbst (Abschnitt 2.2).
- Retention/Archivierung alter Audit-Log-Einträge — unbegrenztes
  Wachstum ist für die zu erwartende Ereignisrate (Einladungen,
  Rollenänderungen, Löschanfragen sind seltene Aktionen) in dieser Phase
  kein Problem; bei Bedarf später nachrüstbar, ohne das Datenmodell zu
  ändern.
