# Plan: Phase 2 (Abschnitte 1.2 und 4 des Feature-Brainstorms)

Detaillierter Umsetzungsplan für Phase 2 aus
`docs/future-features-brainstorm.md` (Abschnitt „Priorisierung:
Phasenplanung"): 1.2 Push-Benachrichtigungen, 4.1 Vereinsinterne
Nachrichten/Ankündigungen, 4.2 Eltern-/Erziehungsberechtigten-Zugang.
Wie `docs/Plans/trainingsplanung-phase1-plan.md` ein konkreter
Umsetzungsplan (kein Diskussionspapier mehr), mit fortlaufend
aktualisiertem Umsetzungsstand je Abschnitt.

## Umsetzungsstand

**Phase 2 ist damit vollständig umgesetzt** (alle drei Teile) — mit der
bewusst zurückgestellten Ausnahme der beiden ereignisgesteuerten
Push-Auslöser (siehe Abschnitt 5.1).

| Teil | Status |
|---|---|
| 1.2 Push-Benachrichtigungen | **umgesetzt** — siehe Abschnitt 1.7 (Kern-Infrastruktur + zwei zeitgesteuerte Auslöser; zwei ereignisgesteuerte Auslöser bewusst zurückgestellt, siehe Abschnitt 5.1) |
| 4.1 Vereinsinterne Nachrichten/Ankündigungen | **umgesetzt** — siehe Abschnitt 2.6 |
| 4.2 Eltern-/Erziehungsberechtigten-Zugang | **umgesetzt** — siehe Abschnitt 3.7 |

## 0. Ausgangslage

- `apps/web/sw.js` registriert bereits einen Service Worker (Precache +
  Fetch-Handler), aber **keinerlei** Push-Code (kein `push`-/
  `notificationclick`-Listener) — 1.2 baut das vollständig neu auf.
- Zeitgesteuerte Hintergrundaufgaben laufen in dieser Codebasis
  ausschließlich über **externen Cron, der ein `tsx`-Skript aufruft**
  (`apps/api/scripts/notifyExpiringQualifications.ts`,
  `purgeDeletedData.ts`) — kein In-Prozess-Scheduler. Neue zeitgesteuerte
  Push-Auslöser folgen demselben Muster.
- E-Mail-Versand hat bereits ein Repository-/Interface-Pattern
  (`mail/mailer.ts`: `MailSender`-Interface, `mailer.memory.ts` für
  Tests, `mailer.nodemailer.ts` fürs echte SMTP) — Push-Versand bekommt
  eine strukturgleiche `PushSender`-Abstraktion.
- Ein neues, eigenständiges Modell als Sync-Store (wie `ActionItem`)
  braucht: Prisma-Modell, Zod-Schema + `ENTITY_SCHEMAS`-Eintrag,
  `STORE_PERMISSIONS`-Eintrag, `MODULE_PACKAGES`-Eintrag,
  `conflictResolution.ts: STRATEGY_BY_STORE`-Eintrag,
  `apps/web/js/db.js: STORES`/`CLUB_SCOPED_STORES`-Eintrag,
  `apps/api/src/db/entityRegistry.ts`-Fall — exakt die fünf Stellen, die
  `docs/Plans/trainingsplanung-phase1-plan.md` Abschnitt 1.7 für
  `planCycles` bereits dokumentiert. 4.1 folgt demselben Muster für
  `Announcement`.
- Eine neue Rolle braucht: `RoleSchema`/`UserRolesSchema`
  (`packages/shared-types/src/user.ts`), `InvitationRoleSchema`
  (`invitation.ts`), `STORE_PERMISSIONS`/`isAthleteScoped`-artige
  Sonderprüfungen (falls Sync-Zugriff nötig), Rollen-Checkboxen in der
  Nutzerverwaltung/Einladungs-UI, `ClubMemberCountsSchema` — exakt das
  Muster, das `docs/Plans/kampfrichter-modul-plan.md` für `referee`
  bereits durchexerziert hat. 4.2 folgt diesem Muster für `parent`,
  **mit einer bewussten Abweichung**: `parent` bekommt **keinen**
  generischen Sync-Zugriff (siehe Abschnitt 3).

## 1. Abschnitt 1.2 — Push-Benachrichtigungen

### 1.1 Konzept

Standard-Web-Push (VAPID, kein Drittanbieter-Dienst wie FCM/APNs nötig
— der Browser liefert den Push-Endpunkt, das Backend signiert Nutzlasten
selbst). Drei Bausteine:

1. **Abo-Verwaltung**: Frontend fragt Benachrichtigungs-Berechtigung an,
   abonniert über `PushManager` (Service Worker), schickt das
   `PushSubscription`-Objekt (Endpoint + Verschlüsselungsschlüssel) ans
   Backend.
2. **Versand**: Backend signiert und verschickt Nutzlasten über die vom
   Browser gelieferte Push-Payload-URL (Standard-Protokoll, das
   `web-push`-Paket übernimmt das komplett).
3. **Anzeige**: Service Worker empfängt den `push`-Event, zeigt eine
   System-Benachrichtigung (`registration.showNotification()`), leitet
   bei Klick (`notificationclick`) in die App.

### 1.2 Datenmodell

```prisma
// Ein Konto kann auf mehreren Geräten abonniert sein (Handy + Tablet am
// Beckenrand) — deshalb 1:n statt eines einzelnen Felds an User.
model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  @@index([userId])
  @@map("push_subscriptions")
}
```

`endpoint` ist `@unique`: derselbe Browser/dasselbe Gerät liefert bei
erneutem `subscribe()` denselben Endpoint zurück — ein wiederholtes
Abonnieren (z. B. nach Neuinstallation der PWA auf demselben Gerät)
aktualisiert die bestehende Zeile (`upsert`) statt eine doppelte
anzulegen. Kein `deletedAt`/Soft-Delete nötig — das ist **kein**
Sync-Store (kein Gerät braucht diese Daten je zu pullen), ein
`DELETE`-Endpunkt entfernt die Zeile hart, ein 410-Gone-Endpunkt
(abgelaufener Browser-Endpoint) räumt beim Versandversuch selbst auf
(siehe 1.4).

**Bewusst KEIN Sync-Store**: `PushSubscription` gehört zur
Server-Infrastruktur (wer bekommt eine Push-Nachricht), nicht zu den
fachlichen Trainingsdaten, die zwischen Geräten synchronisiert werden.
Eigene REST-Endpunkte, analog zu `qualifications`/`kampfrichter`.

### 1.3 REST-Endpunkte (`apps/api/src/modules/push/`)

- `GET /api/push/public-key` — liefert den öffentlichen VAPID-Schlüssel
  (kein Login nötig wäre möglich, aber bewusst trotzdem hinter
  `app.authenticate`, da er nur nach Login gebraucht wird und keine
  Notwendigkeit für einen offenen Endpunkt besteht).
- `POST /api/push/subscriptions` — Body: `{ endpoint, keys: { p256dh, auth } }`
  (Struktur exakt wie die Browser-`PushSubscription.toJSON()`-Ausgabe,
  keine Transformation nötig). `upsert` auf `endpoint`, `userId` aus dem
  Access Token.
- `DELETE /api/push/subscriptions` — Body: `{ endpoint }`. Entfernt genau
  dieses Abo (z. B. beim expliziten Abbestellen); für den Fall "Konto
  gelöscht" übernimmt bereits `onDelete: Cascade`.

Rollen: alle drei Team-Rollen (`trainer`, `admin`, `athlete`) sowie
(vorausschauend auf 4.2) `parent` — Push ist reine Konto-Infrastruktur,
unabhängig von `enabledModules` (**kein** `requireAnyRole`-Gate auf ein
zubuchbares Paket; **welche** Ereignisse tatsächlich Push auslösen,
hängt weiterhin von `enabledModules` ab, siehe 1.5).

### 1.4 Versand-Abstraktion (`apps/api/src/push/`)

```ts
export interface PushPayload {
  title: string;
  body: string;
  // Relative Route fürs Frontend, z. B. "#/announcements/<id>" — der
  // notificationclick-Handler im Service Worker öffnet/fokussiert einen
  // Tab und navigiert dorthin.
  url?: string;
}

export interface PushSender {
  // Verschickt an ALLE Abos einer Person (mehrere Geräte). Ein einzelner
  // fehlgeschlagener Versand (falsches Gerät) darf die übrigen nicht
  // verhindern — Fehler je Abo werden gesammelt, nicht geworfen.
  sendToUser(userId: string, payload: PushPayload): Promise<void>;
}
```

- `pusher.webpush.ts` — echte Implementierung über das `web-push`-Paket
  (`npm install web-push` in `apps/api`, analog zu `nodemailer`). Ein
  HTTP-410/404 vom Push-Dienst (Abo ist clientseitig nicht mehr gültig —
  Browser-Daten gelöscht, Deinstallation) löscht die betroffene
  `PushSubscription`-Zeile automatisch (Aufräumen bei Gelegenheit, kein
  separater Cron nötig).
- `pusher.memory.ts` — sammelt gesendete Payloads in einem Array, für
  Tests (analog `mailer.memory.ts`).
- `resolvePushSender(env)` in `app.ts`, analog `resolveMailer(env)`:
  fehlen `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, greift eine
  `ConsolePushSender` (protokolliert statt zu versenden) — praktisch für
  lokale Entwicklung ohne eigenes Schlüsselpaar, analog zu
  `ConsoleMailSender`.

**Env** (`config/env.ts`, `.env.example`): `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (E-Mail- oder URL-Kontakt laut
VAPID-Spezifikation, Default `mailto:` + `SMTP_FROM_EMAIL`). Erzeugung
einmalig über `npx web-push generate-vapid-keys` (dokumentiert im
Deployment-Leitfaden-Verweis unten, kein neues eigenes Skript nötig —
das Paket bringt das CLI-Tool bereits mit).

### 1.5 Ereignis-Auslöser: Entscheidung zum Umfang

Der Brainstorm nennt vier Auslöser: neue Kommentare, bevorstehende
Trainingseinheiten, ablaufende Qualifikationen, neue
Wettkampf-Startlisten. **Entscheidung (Begründung siehe Abschnitt 5.1):
Phase 2 setzt die zwei zeitgesteuerten Auslöser um (ablaufende
Qualifikationen, bevorstehende Trainingseinheiten); die zwei
ereignisgesteuerten Auslöser (neue Kommentare, neue Startlisten) werden
bewusst zurückgestellt.**

#### 1.5.1 Ablaufende Qualifikationen (Erweiterung, kein neuer Job)

`jobs/notifyExpiringQualifications.ts` bekommt einen dritten,
**optionalen** Parameter `pusher?: PushSender` — sendet bei jeder
tatsächlich verschickten Erinnerungs-E-Mail (an die qualifizierte Person
UND an ihre Vereins-Admins) zusätzlich eine Push-Nachricht an dieselbe
Person, **nur wenn** mindestens ein aktives Abo vorliegt (kein Fehler,
wenn nicht — Push ist ein Zusatzkanal, E-Mail bleibt der verlässliche
Kanal). `scripts/notifyExpiringQualifications.ts` reicht `resolvePushSender(env)`
mit durch. Kein neues `ClubQualificationReminderSetting`-Feld — dieselben
Schwellen wie bisher, nur ein zweiter Auslieferkanal.

#### 1.5.2 Bevorstehende Trainingseinheiten (neuer Job)

Neues Modell (Doppelversand-Schutz, analog `QualificationReminderLog`):

```prisma
model SessionReminderLog {
  id        String   @id @default(uuid())
  sessionId String
  session   TrainingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sentAt    DateTime @default(now())

  @@unique([sessionId])
  @@map("session_reminder_logs")
}
```

`jobs/notifyUpcomingSessions.ts` (analog `notifyExpiringQualifications.ts`):
für jede `TrainingSession` mit `date` innerhalb der nächsten
`UPCOMING_SESSION_REMINDER_HOURS` Stunden (feste Konstante, 20h — knapp
unter „ein Tag vorher", robust gegen einen Cron-Takt von z. B. alle 6h)
UND `deletedAt: null` UND ohne bestehenden `SessionReminderLog`-Eintrag:
Push an alle Athlet:innen der `groupId` dieser Einheit (Konten mit
`athleteId` in `Group.athletes`) sowie an die dem Verein zugeordneten
`trainer`/`admin`-Konten. Danach `SessionReminderLog` anlegen. Nur für
Vereine mit gebuchtem `sessions`-Modul (`enabledModules`) — analog zur
bestehenden Modul-Prüfung bei Qualifikationen. Neues npm-Skript
`notify-upcoming-sessions` (`apps/api/package.json`), im
Deployment-Leitfaden als zusätzliche Cron-Zeile dokumentiert (empfohlen:
alle 6 Stunden, `0 */6 * * *`).

### 1.6 Frontend

- `apps/web/sw.js`: neue Listener `self.addEventListener('push', …)`
  (parst `event.data.json()` als `PushPayload`, `showNotification(title,
  { body, data: { url } })`) und `self.addEventListener('notificationclick', …)`
  (schließt die Benachrichtigung, fokussiert einen offenen Tab oder
  öffnet `url` in einem neuen).
- `apps/web/js/push.js` (neu): `isPushSupported()`,
  `subscribeToPush()`/`unsubscribeFromPush()` (fragt
  `Notification.requestPermission()`, holt den öffentlichen Schlüssel
  über `apiClient.js`, ruft `registration.pushManager.subscribe()`,
  meldet das Ergebnis ans Backend).
- `apps/web/js/modules/profile.js`: neuer Abschnitt „Benachrichtigungen"
  mit Umschalter „Push-Benachrichtigungen aktivieren" (analog zu
  bestehenden Profil-Umschaltern) — sichtbar für alle Rollen mit
  Kontozugriff (auch `parent`, siehe Abschnitt 3), ausgeblendet, wenn
  `isPushSupported()` `false` liefert (z. B. iOS-Safari außerhalb
  „Zum Home-Bildschirm").
- `apps/web/js/apiClient.js`: `getPushPublicKey()`,
  `subscribePush(payload)`, `unsubscribePush(endpoint)`.

### 1.7 Umsetzungsstand: **umgesetzt**

- Datenmodell: `PushSubscription` + `SessionReminderLog` wie geplant
  (`apps/api/prisma/schema.prisma`, Migration
  `20260910090000_add_push_and_session_reminders`). **Nicht gegen eine
  echte Postgres-Instanz geprüft** (kein Docker-Zugriff in dieser
  Sandbox, wie bei allen vorherigen Migrationen in diesem Repository).
- `apps/api/src/push/pusher.ts` (Interface + `PushPayload`),
  `pusher.webpush.ts` (echter Versand über `web-push`, räumt
  abgelaufene Abos bei 404/410 automatisch weg), `pusher.memory.ts`
  (Test-Fake), `pusher.console.ts` (Fallback ohne VAPID-Schlüssel,
  analog `ConsoleMailSender`). `resolvePushSender(env)` in `app.ts`.
- `apps/api/src/modules/push/push.route.ts` + `push.repository.ts`
  (Prisma + Memory) — die drei REST-Endpunkte aus Abschnitt 1.3.
- `config/env.ts`/`.env.example`: `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (optional — fehlen sie, greift
  `ConsolePushSender`, kein Startabbruch, analog zur SMTP-Konfiguration).
- `jobs/notifyExpiringQualifications.ts`: optionaler `pusher`-Parameter
  wie geplant; `jobs/notifyUpcomingSessions.ts` (neu) + zugehöriges
  Repository; beide Skripte unter `apps/api/scripts/`, neuer
  `npm run notify-upcoming-sessions`-Eintrag.
- Frontend: `js/push.js`, Erweiterung von `sw.js` (Cache-Version
  angehoben), `profile.js`-Abschnitt „Benachrichtigungen",
  `apiClient.js`-Funktionen.
- Tests: Schema-/Job-/Route-Tests analog zum Qualifikationsmodul;
  `push.js` als reine, DOM-arme Funktionen wo möglich getestet.
- **Abweichung von der ursprünglichen Planung:** keine.

## 2. Abschnitt 4.1 — Vereinsinterne Nachrichten/Ankündigungen

### 2.1 Konzept

Ein `Announcement` ist ein kurzer, an eine Gruppe **oder** den ganzen
Verein gerichteter Hinweis („Training fällt aus", „Wettkampf verschoben")
von `trainer`/`admin`. Getrennt von den themengebundenen
`comments`-Threads an Übungen/Plänen/Ergebnissen (die bleiben
unverändert) — ein Announcement hängt an keiner anderen Entität.

### 2.2 Datenmodell

Sync-Store nach demselben Muster wie `ActionItem`/`PlanCycle` (siehe
Abschnitt 0):

```prisma
model Announcement {
  id        String    @id @default(uuid())
  clubId    String
  club      Club      @relation(fields: [clubId], references: [id])
  // null = an den gesamten Verein gerichtet; gesetzt = nur an diese
  // Gruppe (z. B. "Training der Jugendgruppe fällt aus").
  groupId   String?
  group     Group?    @relation(fields: [groupId], references: [id])
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  title     String
  body      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([clubId, updatedAt])
  @@index([groupId])
  @@map("announcements")
}
```

`authorId` **kein** `onDelete: SetNull` wie bei `ActionItem.assignedTrainerId`,
sondern Pflichtfeld ohne `SetNull`-Option, analog
`CommentSchema.authorId`-Absicherung — Löschbegründung: eine Ankündigung
ohne erkennbare Urheberschaft verlöre an Vertrauenswürdigkeit
(„wer hat das wirklich geschrieben?"). Da `User`-Löschung aktuell über
Soft-Delete + zeitversetzten Hard-Purge läuft (`DataDeletionRequest`),
und andere Pflicht-Fremdschlüssel in diesem Schema (z. B.
`Athlete.clubId`) ebenfalls ohne `SetNull` auskommen, ist ein hartes
Purgen einer Autor:in mit noch bestehenden Announcements ein Randfall,
der bewusst denselben Weg wie bei `Comment.authorId`
(`jobs/commentAnonymization.ts`) erhält: **Entscheidung** —
`commentAnonymization.ts` wird in Abschnitt 2.6 nicht erweitert (siehe
dort); `authorId` bleibt bei einem Hard-Purge stehen (verweist dann auf
keine existierende Zeile mehr — kein Fremdschlüssel-Zwang in Prisma ohne
Relation nötig, siehe Analogie `SyncTombstone`), **Entscheidung**: da
das inkonsistent mit dem Rest des Schemas wäre (jede andere
Personen-Referenz hat eine echte FK-Constraint), bekommt
`authorId` stattdessen doch `onDelete: SetNull` (nullable) — konsistent
mit `ActionItem.assignedTrainerId`/`Invitation.invitedById`. Ein
Announcement ohne erkennbare:n Autor:in (weil das Konto vor Jahren
gelöscht wurde) ist ein akzeptabler, seltener Randfall — kein Grund, von
der etablierten Konvention dieses Schemas abzuweichen.

Zod: `AnnouncementSchema` in `entities.ts` (`title` `.max(200)`, `body`
`.max(5000)`, analog anderen Freitextfeldern), Registry-Eintrag
`ENTITY_SCHEMAS.announcements`.

### 2.3 Rechte & Modul

- `STORE_PERMISSIONS.announcements = coachManaged` (lesen: alle drei
  Team-Rollen; schreiben: `trainer`/`admin`) — wie `templates`/`planCycles`.
- `MODULE_PACKAGES.announcements = { routeIds: ['announcements'], stores: ['announcements'] }`
  — eigenes, zubuchbares Paket (nicht in `plans`/`actionitems`
  gebündelt: Ankündigungen sind fachlich eigenständig, ein Verein soll
  sie unabhängig von anderen Paketen buchen können).
- **Sichtbarkeits-Scoping nach `groupId`**: anders als bei `ActionItem`
  (athletenspezifisch über `sync.athleteScope.ts`) ist die Einschränkung
  hier **gruppenspezifisch**, nicht rollenspezifisch — `trainer` sieht
  laut bestehendem Rollenmodell (siehe `docs/todo.md`) heute schon
  potenziell nur bestimmte Gruppen zugewiesen (zu prüfen, siehe
  `docs/future-features-brainstorm.md` Abschnitt 5.1 — dort noch offen).
  **Entscheidung**: Phase 2 führt **kein** gruppenspezifisches
  Sync-Scoping ein (das würde eine `Group`↔`User`-Zuständigkeit
  voraussetzen, die es laut Abschnitt 5.1 des Brainstorms heute noch
  nicht gibt) — alle Team-Mitglieder sehen alle Announcements ihres
  Vereins, unabhängig von `groupId` (rein zur DARSTELLUNG genutzt: das
  Frontend zeigt gruppenspezifische Announcements mit Gruppenname-Badge,
  filtert sie aber nicht weg). Konsistent mit dem bestehenden
  Team-weiten Sichtbarkeitsprinzip aller anderen `coachManaged`-Stores.

### 2.4 Push-Zustellung

**Entscheidung**: Push-Versand für ein neues Announcement wird **nicht**
in die generische `sync.service.ts: push()`-Hot-Path eingebaut (siehe
Abschnitt 5.1-Begründung zu „kein Seiteneffekt in push()"), sondern in
`sync.route.ts` nach dem `syncService.push()`-Aufruf: die Route
inspiziert die zurückgegebenen `results`, filtert auf
`store === 'announcements' && action === 'create' && status === 'applied'`,
und ruft **asynchron, fire-and-forget** (Fehler geloggt, aber die
Sync-Antwort nicht blockierend) `notifyAnnouncementCreated(pusher, …)` auf
— lädt die Empfänger:innen (Vereinsmitglieder, ggf. auf `groupId`
verengt, wenn gesetzt) und verschickt an jedes Konto mit aktivem Abo.
Dieser Zuschnitt ist bewusst auf **genau einen Store** (`announcements`)
begrenzt — eine generische „Push bei jedem Sync-Event"-Lösung für
beliebige Stores wäre Overengineering, siehe Abschnitt 5.1.

### 2.5 Frontend

Neues Modul `apps/web/js/modules/announcements.js` — Liste (neueste
zuerst, Gruppenname-Badge falls gesetzt), Erstellen/Bearbeiten-Modal
(`trainer`/`admin`), Löschen. UI-Muster wiederverwendet aus
`actionItems.js` (Liste + Detail + Modal-Formular). Route `announcements`,
Icon im Nav, `plansModule`-artiger Rollen-Eintrag `roles: ['trainer',
'admin', 'athlete']`. Dashboard-Karte (`dashboard.js`): die 3 neuesten
Announcements, analog zum bestehenden Anwesenheits-Hinweis aus Phase 1.

### 2.6 Umsetzungsstand: **umgesetzt**

- `authorId` mit `onDelete: SetNull` (siehe Abschnitt 2.2, finale
  Entscheidung) — Migration `20260910093000_add_announcements` (Modell
  bereits mit 1.2/4.2 zusammen angelegt, siehe Abschnitt 1.7-Kommentar).
- `AnnouncementSchema` in `entities.ts`, Registry-Eintrag; an den fünf in
  Abschnitt 0 genannten Stellen verankert (`STORE_PERMISSIONS`,
  `MODULE_PACKAGES`, `db.js`, `entityRegistry.ts`).
  **Abweichung von der ursprünglichen Planung:** `STRATEGY_BY_STORE` erhält
  `'last-write-wins'` statt `'last-write-wins-document'` — Announcement
  ist (anders als `plans`/`templates`/`planCycles`) ein flaches Dokument
  ohne eingebettete Kommentar-/Sets-Struktur, für die die
  „document"-Variante gedacht ist; einfaches last-write-wins (wie
  `sessions`/`actionItems`) ist die inhaltlich zutreffende Strategie.
- **Über die ursprüngliche Planung hinaus ergänzt:** eine
  Autorschafts-Prüfung in `sync.service.ts` (analog
  `sync.commentAuthorship.ts`, aber für das Top-Level-Feld `authorId`
  statt eingebetteter Kommentare) — eine NEU angelegte Ankündigung muss
  `authorId === requester.userId` tragen (verhindert Identitätsvortäuschung),
  eine BESTEHENDE behält beim Bearbeiten ihre ursprüngliche Urheberschaft
  unabhängig davon, wer den Inhalt ändert (Team-Dokument, wie `plans`).
  War im Plan nicht vorgesehen, aber dieselbe Lücke, die
  `sync.commentAuthorship.ts` für eingebettete Kommentare bereits
  schließt — ohne diese Prüfung könnte jede:r Trainer:in eine Ankündigung
  im Namen einer anderen Person verfassen. Zusätzlich `groupId` als
  Fremdschlüssel-Referenz in `sync.foreignKeys.ts` verankert (Vereins-
  Scoping, analog `sessions.groupId`).
- `sync.route.ts`: `notifyAnnouncementCreated()`-Hook wie in 2.4
  beschrieben, fire-and-forget (`.catch(err => app.log.error(...))`,
  blockiert die Sync-Antwort nicht) — Empfänger:innen-Ermittlung über das
  neue `AnnouncementRecipientsGateway` (`announcementRecipients.repository.ts`).
- `apps/web/js/modules/announcements.js` — Liste + Erstellen/Bearbeiten-
  Modal (`trainer`/`admin`), Löschen, Gruppen-/Vereinsweit-Badge; neuer
  Nav-Eintrag unter der Gruppe „Team" (`shell.js: NAV_GROUPS`). Dashboard-
  Karte „Neueste Ankündigungen" (`trainer`- UND `athlete`-Ansicht).
  Demo-Daten in `demoSeed.js` ergänzt. Übersetzungen (`nav.announcements`,
  Namespace `announcements`, `dashboard.announcementsTitle`),
  `sw.js`-Precache-Eintrag (Cache-Version `lane1-v46`), `db.js`:
  `DB_VERSION` 4 → 5.
- Tests: Schema-Test (`AnnouncementSchema`, inkl. `.strict()`),
  Registry-Vollständigkeit (generisch, deckt `announcements` automatisch
  ab), Autorisierungstest (Modul-Gating + Rollenschreibrecht), vier neue
  Tests für die Autorschafts-Prüfung in `sync.service.test.ts`, fünf neue
  Tests für den Push-Auslöse-Hook (`sync.announcementNotify.test.ts`,
  Memory-Pusher/-Repository). Gesamte Monorepo-Suite bleibt grün.

## 3. Abschnitt 4.2 — Eltern-/Erziehungsberechtigten-Zugang

### 3.1 Konzept

Ein eingeschränktes, **lesendes** Konto für Eltern/Erziehungsberechtigte
mit einer oder mehreren verknüpften `Athlete`-Zeilen (Geschwister im
selben Verein). **Entscheidung (siehe Abschnitt 3.6): kein genereller
Sync-Zugriff** — stattdessen „eigene, stark eingeschränkte Sicht auf
bestehende Endpunkte" (genau der im Brainstorm selbst vorgeschlagene
Weg), analog zu `qualifications`/`kampfrichter`: ein dedizierter,
serverseitig vorberechneter REST-Endpunkt statt Freischaltung des
gesamten Sync-Stores mit neuer Row-Level-Scoping-Logik für jeden
betroffenen Store (`sessions`, `plans`, `entries`, `competitions`,
`results`, `athletes`, `groups` — ein Vielfaches des Aufwands von
`sync.athleteScope.ts`, für eine Rolle, die nur lesen soll).

### 3.2 Datenmodell

```prisma
model User {
  // … bestehende Felder unverändert …
  // Verknüpfte Kinder (Rolle "parent") — leer für jede andere Rolle.
  parentLinks ParentLink[] @relation("ParentLinkParent")
}

model Athlete {
  // … bestehende Felder unverändert …
  parentLinks ParentLink[]
}

// n:m zwischen einem Eltern-Konto und einem/mehreren Athletenprofilen
// (Geschwister). onDelete: Cascade auf beiden Seiten — analog
// RefreshToken/UserQualification: eine Verknüpfung ohne eine der beiden
// Seiten ist bedeutungslos.
model ParentLink {
  id        String  @id @default(uuid())
  userId    String
  user      User    @relation("ParentLinkParent", fields: [userId], references: [id], onDelete: Cascade)
  athleteId String
  athlete   Athlete @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, athleteId])
  @@index([athleteId])
  @@map("parent_links")
}
```

### 3.3 Rolle & Einladung

- `RoleSchema`/`UserRolesSchema` (`user.ts`), `InvitationRoleSchema`
  (`invitation.ts`): `'parent'` ergänzt. **Entscheidung**: `parent`
  bleibt — anders als `trainer`/`athlete`/`referee` — bewusst **nicht**
  mit anderen Rollen kombinierbar in Phase 2 (kein
  `UserRolesSchema`-Sonderfall wie bei `superadmin` nötig, da die
  App-übliche Kombination "Elternteil UND selbst Trainer:in desselben
  Vereins" technisch zulässig bliebe, aber die stark eingeschränkte
  Sicht aus 3.4 für so ein Konto keinen Mehrwert böte — wer ohnehin
  `trainer`/`admin` ist, sieht die Daten seines Kindes bereits über die
  reguläre Team-Sicht). Keine harte Schema-Sperre eingeführt (YAGNI —
  ein `admin`, der zusätzlich `parent` bekommt, ist kein
  Sicherheitsproblem, nur ungenutzt); nur redaktionell dokumentiert.
- `Invitation.role` akzeptiert `'parent'`; `Invitation.athleteId`
  (bereits vorhanden, siehe Abschnitt 0) verknüpft das **erste** Kind
  direkt bei Registrierung — `acceptInvitation()` legt bei
  `role === 'parent' && invitation.athleteId` automatisch die erste
  `ParentLink`-Zeile an. **Weitere** Kinder (Geschwister) werden über
  eine kleine Admin-Funktion nachträglich verknüpft (siehe 3.5) — eine
  zweite Einladung pro Geschwisterkind wäre unnötig umständlich (zwei
  Konten für dieselbe Person).
- **DSGVO**: `parent` durchläuft denselben Consent-Flow wie jede andere
  Rolle (`consentGivenAt`/`consentVersion` sind bereits generisch am
  `User`-Modell, keine Änderung nötig). **Datenminimierung**: die
  eingeschränkte Sicht (3.4) liefert ausschließlich Trainingstermine,
  Wettkampftermine und die Ergebnisse des/der eigenen Kindes — keine
  Notizen (`Athlete.notes`/`TrainingSession.trainerNote`), keine
  Anwesenheits-/RPE-Daten anderer Athlet:innen, keine Handlungsfelder
  (`ActionItem`, das bleibt betreuungsintern). Rechtsgrundlage:
  elterliche Sorge/Vertretung des minderjährigen Kindes — keine eigene
  Einwilligung des Kindes nötig, da die Eltern ohnehin bereits
  Zugriffs-/Auskunftsrecht für ihr minderjähriges Kind haben; dennoch
  bewusst read-only (kein Schreibzugriff, der eine Handlung im Namen des
  Kindes vortäuschen könnte).

### 3.4 REST-Endpunkt: eingeschränkte Sicht

`GET /api/parents/overview` (`apps/api/src/modules/parents/`), Rolle
`parent` erforderlich:

```ts
interface ParentOverviewResponse {
  children: Array<{
    athlete: { id: string; firstName: string; lastName: string; groupId: string | null };
    upcomingSessions: Array<{ id: string; date: string; groupName: string }>;
    upcomingCompetitions: Array<{ competitionId: string; competitionName: string; date: string; event: string }>;
    recentResults: Array<{ id: string; event: string; time: number | null; date: string; isPB: boolean; status: string }>;
  }>;
}
```

Serverseitig berechnet aus den bestehenden Tabellen (`ParentLink` →
`Athlete.groupId` → `TrainingSession`/`StartlistEntry`/`Competition`/
`Result`), **read-only**, **kein** Sync-Store, **kein** Zugriff über
`POST /api/sync/push`/`pull` (Rolle `parent` fehlt bewusst in
`TEAM_ROLES`/`STORE_PERMISSIONS` — `sync.route.ts`s `requireAnyRole`-Guard
lässt sie dadurch gar nicht erst hinein, ein zusätzlicher Test sichert
das ab). `upcomingSessions`/`upcomingCompetitions` je auf die nächsten
10 Einträge begrenzt, `recentResults` auf die letzten 10 — bewusst kein
unbegrenzter Export (Datenminimierung, s. o.; ein vollständiger
DSGVO-Auskunftsexport bleibt dem Kind/den Admins vorbehalten, nicht
Aufgabe dieser Übersicht).

### 3.5 Admin-Verwaltung der Verknüpfungen

`GET /api/parents/:userId/links`, `POST /api/parents/:userId/links`
(Body: `{ athleteId }`), `DELETE /api/parents/:userId/links/:athleteId`
— `admin`/`superadmin`-geschützt analog zu `PATCH
/api/users/:userId/roles`. UI: neuer Abschnitt in der bestehenden
Nutzerverwaltung (`apps/web/js/modules/userManagement.js`) — bei einem
Konto mit Rolle `parent` erscheint eine Mehrfachauswahl der
Athlet:innen des Vereins.

### 3.6 Push für Eltern

`parent`-Konten dürfen sich wie jede andere Rolle über
`POST /api/push/subscriptions` (Abschnitt 1.3, bereits rollenoffen für
Team-Rollen + `parent`) für Push registrieren. **Entscheidung**: Phase 2
löst noch **keinen** aktiven Push-Auslöser für Eltern aus (kein
"Erinnerung an bevorstehende Einheit" o. ä. an `parent`-Konten) — das
wäre ein fünfter Auslösertyp mit eigener Empfänger:innen-Logik
(`ParentLink` statt `Group`-Mitgliedschaft) und damit über den in
Abschnitt 1.5 bewusst begrenzten Umfang hinaus. Zurückgestellt für eine
spätere Erweiterung (siehe Abschnitt 5.1).

### 3.7 Umsetzungsstand: **umgesetzt**

- `RoleSchema`/`UserRolesSchema`/`InvitationRoleSchema` um `'parent'`
  erweitert; `ParentLink`-Modell + Migration
  `20260910096000_add_parent_role` (bereits mit 1.2/4.1 zusammen angelegt,
  siehe Abschnitt 2.6-Kommentar). **Nicht gegen eine echte
  Postgres-Instanz geprüft** (siehe wiederkehrender Vorbehalt oben).
- `acceptInvitation()` (`auth.service.ts`): legt bei `role === 'parent'`
  und gesetztem `invitation.athleteId` automatisch die erste `ParentLink`-
  Zeile an — **wichtige Abgrenzung, die der Plan noch nicht explizit
  machte**: `invitation.athleteId` bedeutet bei `role === 'athlete'` "das
  eigene Athletenprofil" (`User.athleteId`), bei `role === 'parent'`
  dagegen "erstes Kind" (`ParentLink`) — beides denselben Feldwert direkt
  weiterzureichen hätte ein Elternkonto fälschlich als Athletenprofil
  markiert (und wäre am `User.athleteId`-`@unique`-Constraint
  gescheitert, sobald das Kind bereits ein eigenes Konto hat).
- `packages/shared-types/src/parent.ts` (neu) — `ParentOverviewResponseSchema`/
  `ParentLinksResponseSchema`/`CreateParentLinkRequestSchema`. **Nicht
  Teil der ursprünglichen Planung**, aber notwendig: der Plan skizzierte
  die Antwortform nur als TS-`interface` in der Beschreibung, ohne
  eigenes Zod-Schema/eigene Datei vorzusehen.
- `apps/api/src/modules/parents/` — `parents.route.ts` (Übersicht +
  Admin-Verknüpfungsverwaltung), `parents.service.ts` (Vereins-/Rollen-
  Scoping, drei neue Fehlerklassen in `httpErrorHandler.ts` registriert),
  `parents.repository.ts` (`ParentLink`-CRUD, Prisma + Memory),
  `parents.overview.repository.ts` (Übersichts-Berechnung aus
  `TrainingSession`/`StartlistEntry`/`Result`, je Kategorie auf 10
  Einträge begrenzt).
- `sync.route.ts`: `requireAnyRole('trainer', 'admin', 'athlete')`
  **unverändert** — `parent` bewusst NICHT ergänzt (siehe 3.4); Tests
  bestätigen 403 für ein `parent`-Konto gegen `/api/sync/push` und
  `/pull`.
- `push.route.ts`: `parent` zu den push-fähigen Rollen ergänzt (siehe
  Abschnitt 1.3) — Push-Abo bleibt rollenoffen, auch ohne aktiven
  Auslöser für diese Rolle (Abschnitt 3.6).
- Frontend: neues, eigenständiges Modul `apps/web/js/modules/parentView.js`
  — als Router-Modul registriert (`roles: ['parent']`, in
  `router.js: CORE_MODULE_IDS` wie `dashboard`, da unabhängig von
  `enabledModules`), aber **kein** IndexedDB-Store: lädt direkt per
  `GET /api/parents/overview`, keine Offline-Synchronisation für diese
  seltene, rein lesende Nutzung. `state.js: isParentOnly()` (neu) hält
  ein reines Eltern-Konto vom generischen, sync-basierten Teil der App
  fern: `app.js` startet für ein solches Konto keinen Hintergrund-Sync
  (wäre ohnehin nur 403), `shell.js: DEFAULT_ROUTE_BY_ROLE`/
  `preferredRole` route ein Konto mit ausschließlich `parent` direkt auf
  `#/parent`, analog zum bestehenden `referee`-Sonderfall.
  `userManagement.js`: Verknüpfungs-UI für Admins (Mehrfachauswahl der
  Vereins-Athlet:innen, direkt gegen die drei Verwaltungsendpunkte).
- **Abweichung von der ursprünglichen Planung:** `ClubMemberCountsSchema`
  (Superadmin-Übersicht) bekommt **keinen** `parent`-Zähler — das hätte
  zusätzlich `invitations.repository.ts: countMembersByClub()` und
  `admin/admin.js` angefasst, für eine reine Zusatzinformation ohne
  Bezug zur Kernfunktion dieses Abschnitts; bewusst nicht mitgezogen.
  Der generische Einladungsdialog (`userManagement.js: openInviteModal()`)
  sammelt für `role === 'parent'` (wie bereits zuvor für `role ===
  'athlete'`) keine `athleteId` ein — dieser Dialog verknüpfte auch vor
  dieser Änderung nie ein Athletenprofil bei der Einladung; die
  Erstverknüpfung ist damit über diesen Weg aktuell nicht erreichbar,
  bewusst nicht im Rahmen dieses Abschnitts nachgerüstet (vorbestehende
  Lücke). Ein Admin verknüpft ein Kind stattdessen nach der
  Einladungsannahme über die neue Verknüpfungsverwaltung — funktional
  gleichwertig, nur ein zusätzlicher Schritt.
- Tests: Rollen-/Schema-Tests (`RoleSchema`/`InvitationRoleSchema`/
  `parent.ts`-Schemas), `parents.service.test.ts` (Vereins-/Rollen-
  Scoping, verwaiste Verknüpfungen), `parents.route.test.ts` (eigene
  Kinder sichtbar, andere Rolle abgelehnt, Admin-Verwaltung admin-only),
  zwei Sync-Route-Tests (403 für `parent` gegen push/pull), zwei
  `acceptInvitation()`-Tests (automatische Erstverknüpfung mit/ohne
  `athleteId`, `User.athleteId` bleibt `null`). Gesamte Monorepo-Suite
  bleibt grün (597 Backend-, 271 Web-, 220 shared-types-Tests).

## 4. Rollen & Berechtigungen (zusammenfassend)

| Feature | `admin` | `trainer` | `athlete` | `parent` |
|---|---|---|---|---|
| Push abonnieren/abbestellen | ja | ja | ja | ja |
| Push: ablaufende Qualifikationen | ja (eigene) | ja (eigene) | — | — |
| Push: bevorstehende Einheiten | ja | ja | ja | — |
| Announcements lesen | ja | ja | ja | nein |
| Announcements erstellen/bearbeiten | ja | ja | nein | nein |
| Push bei neuem Announcement | ja | ja | ja | — |
| `/api/parents/overview` | nein (eigener Zugriff über normale Vereinssicht) | nein | nein | ja (nur eigene Kinder) |
| Verknüpfungen verwalten | ja | nein | nein | nein |
| Genereller Sync-Zugriff (`/api/sync/*`) | ja | ja | ja | **nein** |

## 5. Entscheidungen

### 5.1 Umfang der Push-Auslöser: zwei von vier, zeitgesteuert vor ereignisgesteuert

**Entscheidung:** Phase 2 setzt die zwei zeitgesteuerten Auslöser
(ablaufende Qualifikationen, bevorstehende Trainingseinheiten) um; die
zwei ereignisgesteuerten Auslöser (neue Kommentare, neue
Wettkampf-Startlisten) werden zurückgestellt.

**Begründung:** Die zeitgesteuerten Auslöser fügen sich nahtlos in das
bereits etablierte Cron-Skript-Muster ein (siehe Abschnitt 0) — neuer
Job, dieselbe Form wie `notifyExpiringQualifications.ts`, kein Eingriff
in den Sync-Hot-Path. Die ereignisgesteuerten Auslöser (neuer Kommentar
an EINER von drei verschiedenen Entitäten mit `comments`-Array —
`Result`, `Exercise`, `Plan`, je mit anderer sinnvoller
Empfänger:innen-Menge; neue `StartlistEntry` für eine bereits bestehende
`Competition`) müssten entweder (a) generisch in
`sync.service.ts: push()` verankert werden — das bricht mit der
sorgfältig gehaltenen Trennung dieser Datei (reine Push/Pull-Mechanik,
siehe Datei-Kopfkommentar) und macht jeden künftigen neuen Comment-Store
automatisch push-auslösend, ohne dass das je bewusst entschieden wurde,
oder (b) store-spezifisch in `sync.route.ts` nachgerüstet werden (wie
bei `announcements`, Abschnitt 2.4) — für DREI verschiedene
Kommentar-Stores mit je eigener Empfänger:innen-Logik (wer soll bei
einem neuen Kommentar an einem Ergebnis benachrichtigt werden? Die
Athletin selbst? Alle Trainer:innen? Nur bei fremdem Kommentar, nicht
beim eigenen?) ist das eine eigenständige, jeweils zu klärende
Design-Entscheidung je Store — zu groß, um „nebenbei" in Phase 2
mitgelöst zu werden. Die Infrastruktur aus Abschnitt 1 (Abo-Verwaltung,
Versand-Abstraktion, Service-Worker-Anzeige) ist davon unabhängig
wiederverwendbar — ein künftiger, fokussierter Anlauf für genau diese
beiden Auslöser baut direkt darauf auf, ohne etwas davon zu verwerfen.

### 5.2 `parent`: eigener, begrenzter REST-Endpunkt statt genereller Sync-Zugriff

**Entscheidung:** siehe Abschnitt 3.1/3.4 — kein Sync-Zugriff für die
Rolle `parent`.

**Begründung:** Der generische Sync-Mechanismus ist für **kollaborative,
teilweise schreibende** Team-Rollen gebaut (`trainer`/`admin`/`athlete`
teilen sich weitgehend dieselbe Datentiefe, mit punktuellen
Einschränkungen über `sync.athleteScope.ts`). Eine vierte Rolle mit
einer GRUNDSÄTZLICH anderen Sichtbarkeitsregel (nur die eigenen
verknüpften Kinder, über SIEBEN verschiedene Stores hinweg —
`athletes`, `groups`, `plans`, `sessions`, `entries`, `competitions`,
`results`) hätte `sync.athleteScope.ts` um eine zweite, strukturell
andere Scoping-Dimension erweitert (Personen-Filter vs.
Familien-Filter), mit eigenem Row-Level-Code je Store — ungefähr der
gleiche Aufwand wie die Route aus 3.4, aber mit dem zusätzlichen Risiko,
begrenztere Sichtbarkeit für Sync-Semantik korrekt umzusetzen, für die
sie nicht entworfen wurde (Offline-Queue, Konfliktauflösung,
Pull-Pagination — für eine reine Lesesicht auf wenige, kleine
Datenmengen unnötiger Mehraufwand). Der im Brainstorm selbst genannte
Ansatz („eigene, stark eingeschränkte Sicht auf bestehende Endpunkte")
ist zugleich der pragmatischere UND der sicherere Weg: ein einzelner,
klar auditierbarer Lesepfad statt eines um eine neue Dimension
erweiterten generischen Schreibpfads.

## 6. Nachträglich behoben (unabhängiges Code-Review)

- **SSRF über den Push-Subscribe-Endpunkt** — `PushSubscribeRequestSchema.endpoint`
  prüfte bislang nur `.url()`, ohne den Host einzuschränken. Da
  `apps/api/src/push/pusher.webpush.ts` diesen Wert später serverseitig
  als Ziel einer echten HTTP-Anfrage verwendet (ausgelöst zeitversetzt
  durch einen Cron-Job oder den Announcement-Push-Hook, nicht durch die
  anfragende Person selbst), konnte JEDES authentifizierte Konto —
  einschließlich der Rolle `athlete` — eine beliebige interne/private
  Adresse registrieren und den Server damit zu einem SSRF-Werkzeug
  machen. Behoben durch eine Allowlist der tatsächlichen Web-Push-
  Dienst-Hosts der Browser-Hersteller (FCM, Mozilla Autopush, Apple,
  WNS) direkt im Zod-Schema (`packages/shared-types/src/push.ts`) —
  `PushUnsubscribeRequestSchema` bleibt bewusst unverändert (löst nur
  einen DB-Delete aus, keine HTTP-Anfrage). Neue Tests in
  `push.test.ts`/`push.route.test.ts`.
- **Erinnerung an bevorstehende Einheiten erreichte Athlet:innen einer
  Ad-hoc-Einheit ohne Gruppe nie** — `findRecipientUserIds()`
  (`jobs/sessionReminder.repository.ts`) ermittelte die Athlet:innen
  bislang über die AKTUELLE Gruppen-Mitgliedschaft (`groupId`); eine
  Einheit ohne Gruppe (`TrainingSession.groupId` ist nullable) bekam
  dadurch nie eine Athlet:innen-Benachrichtigung, nur Trainer:innen/
  Admins. Behoben durch Ableitung der Empfänger:innen aus
  `TrainingSession.attendance` (die tatsächliche Teilnehmer:innen-Liste
  DIESER Einheit) statt einer erneuten Gruppen-Abfrage — trifft
  zusätzlich den allgemeineren Fall, dass sich die Gruppen-Mitgliedschaft
  zwischen Anlegen der Einheit und Fälligkeit der Erinnerung geändert
  haben kann. `UpcomingSessionCandidate.groupId` ersetzt durch
  `athleteIds`.
- **`GET /api/parents/overview` zeigte gelöschte Wettkämpfe weiter an** —
  `buildChildOverview()` filterte `StartlistEntry.deletedAt`, aber nicht
  das per `include` geladene `Competition.deletedAt` — ein soft-
  gelöschter/abgesagter Wettkampf blieb dadurch dauerhaft (solange sein
  Datum in der Zukunft lag) in der Eltern-Übersicht sichtbar. Ergänzt.
- **Checkbox „Push-Benachrichtigungen aktivieren" blieb dauerhaft
  deaktiviert ohne Rückmeldung** — `profile.js` rief
  `getExistingPushSubscription()` ohne `.catch()` auf; lehnte das
  Promise ab (z. B. Service Worker in diesem Kontext nie aktiv), blieb
  die Checkbox für die gesamte Sitzung deaktiviert, ohne dass die Person
  einen Grund dafür sah. Ergänzt (`.catch()` setzt einen definierten
  Zustand, `.finally()` aktiviert die Checkbox in jedem Fall wieder).
- **Duplizierte „Staff eines Vereins"-Abfrage** —
  `announcementRecipients.repository.ts` und `sessionReminder.repository.ts`
  wiederholten dieselbe Prisma-Abfrage für „trainer/admin-Konten eines
  Vereins" fast wortgleich. In `apps/api/src/db/clubStaff.ts`
  (`findClubStaffUserIds()`) zusammengeführt.
- **Gelöschte Athlet:innen hinterließen dauerhafte `ParentLink`-Leichen**
  (Nutzerfrage) — `ParentLink.athlete` trägt zwar `onDelete: Cascade`
  (`schema.prisma`), das greift aber ausschließlich bei einer echten
  SQL-`DELETE` (z. B. dem harten DSGVO-Purge in
  `jobs/erasure.repository.ts`), nicht beim regulären Löschen einer
  Athletin/eines Athleten aus der Athlet:innen-Liste — das ist ein reines
  Soft-Delete (`deletedAt`-`UPDATE`) über die generische Sync-API und löst
  keine Fremdschlüssel-Kaskade aus. Ein Elternkonto behielt dadurch eine
  Verknüpfung zu einem für alle anderen bereits unsichtbaren
  Athletenprofil (wurde zwar bereits vorher schadlos herausgefiltert,
  siehe `parents.service.ts: getOverview()`, blieb aber als tote Zeile in
  der Datenbank stehen). Behoben in
  `sync.gateway.ts: applyAndMarkProcessed()` — beim Soft-Delete des Stores
  `athletes` werden verknüpfte `ParentLink`-Zeilen in DERSELBEN
  Transaktion mitgelöscht (atomar, store-spezifische Ausnahme in dieser
  sonst generischen Methode). Das Elternkonto selbst bleibt unberührt —
  es sieht danach schlicht keine verknüpften Kinder mehr. Zwei neue
  Integrationstests in `test-integration/syncGateway.integration.test.ts`
  (Aufräumung greift bei `athletes`, bleibt bei jedem anderen Store aus)
  — **nicht gegen eine echte Postgres-Instanz geprüft** (siehe
  wiederkehrender Vorbehalt oben).
