# Plan: Erfassung von Nutzer-Qualifikationen

Ziel: Für jede Person mit Konto (insbesondere Trainer:innen, aber nicht auf diese Rolle
beschränkt) erfassbar machen, welche Qualifikationen sie besitzt — z. B. Trainerlizenz
(C-/B-/A-Trainerschein), Rettungsschwimmschein (DLRG Silber/Gold), Erste-Hilfe-Kurs,
Kinderschutz-Schulung — jeweils mit **Erwerbsdatum**, **Art der Qualifikation** und
optionalem **Ablaufdatum**. Vereine müssen heute außerhalb der App (Excel, Papier)
nachhalten, wessen Nachweise bald ablaufen; Ziel dieses Features ist, das direkt im
Nutzerkonto abzubilden und rechtzeitig vor Ablauf zu erinnern. Das Feature wird als
eigenständiges, **je Verein zubuchbares Modul** ausgeliefert (siehe Abschnitt 1.2) —
nicht jeder Verein braucht diese Verwaltung, analog zum bereits bestehenden
Wettkampfmodul.

Stand: Greenfield-Feature, kein bestehender Code. `docs/backend-plan.md` (Phasen 0–4)
und eine Code-Recherche in `apps/api`/`apps/web`/`packages/*` bilden die Grundlage für
die Architekturentscheidungen unten (Fastify/Prisma-Backend, Vanilla-JS-PWA-Frontend mit
IndexedDB-Offline-Cache, Sync-API als Schreibpfad für die zehn fachlichen Stores unter
`packages/shared-types/src/entities.ts: ENTITY_SCHEMAS`). Abschnitt 8 hält die bereits
getroffenen fachlichen Entscheidungen fest, die den Rest dieses Plans prägen.

## 1. Architekturentscheidungen

### 1.1 Eigene Ressource statt Sync-Store

`User` ist **kein** Sync-Store (kein Eintrag in `ENTITY_SCHEMAS`/`ENTITY_STORE_NAMES`,
kein Prisma-Delegate in `apps/api/src/db/entityRegistry.ts`). Nutzerdaten werden nicht
offline bearbeitet und über die Outbox synchronisiert wie Athlet:innen oder
Trainingspläne, sondern über dedizierte REST-Endpunkte im `auth`-Modul verwaltet
(`GET/PATCH /api/me`, `GET /api/users`, `POST /api/invitations`, …); das Frontend hält
davon nur einen lokalen **Lese**-Cache im `users`-IndexedDB-Store (`apps/web/js/db.js`).

Qualifikationen sind Metadaten zu einem `User`, keine eigenständige, offline von
Athlet:innen editierbare fachliche Entität. Sie sollten deshalb **denselben Weg wie
`Invitation`/`PasswordResetToken`/`DataDeletionRequest` gehen**: ein eigenes
Prisma-Modell mit Fremdschlüssel auf `User`, eigene REST-Endpunkte, **kein** neuer
Eintrag in `ENTITY_SCHEMAS` und **kein** neuer IndexedDB-Store in `STORES`
(`apps/web/js/db.js`), keine Änderung an `sync.permissions.ts`/`sync.service.ts`. Das
passt zum bestehenden Muster für kontobezogene, aber nicht offline-fachliche Daten —
die Zubuchbarkeit als Modul (Abschnitt 1.2) ändert daran nichts, sie kommt on top.

Alternative verworfen: Qualifikationen als eigener Sync-Store analog `Athlete` hätte
offline Anlegen/Bearbeiten auf dem Gerät ermöglicht, bringt hier aber keinen Mehrwert
(Qualifikationen werden ausschließlich online von Admins gepflegt, siehe Entscheidung
zu Frage 2 in Abschnitt 8) und hätte den Sync-Layer unnötig aufgebläht.

### 1.2 Zubuchbares Modul

Qualifikationsmanagement wird als eigenes Paket in
`packages/shared-types/src/modules.ts: MODULE_PACKAGES` geführt:

```ts
export const MODULE_PACKAGES = {
  // … bestehende Pakete …
  qualifications: { routeIds: ['qualifications'], stores: [] },
} as const satisfies Record<string, ModulePackage>;
```

`stores: []` ist bewusst leer — analog zu `times`/`stats` (siehe bestehender Kommentar
in `modules.ts`) gibt es keinen Sync-Store, den das Paket freischaltet (siehe Abschnitt
1.1); das Paket steuert ausschließlich die Sichtbarkeit der neuen Frontend-Route und
den Zugriff auf die REST-Endpunkte aus Abschnitt 3.

**Frontend** (`apps/web/js/router.js`): neuer Eintrag `qualifications: 'qualifications'`
in `ROUTE_TO_PACKAGE` (muss inhaltlich mit `MODULE_PACKAGES` übereinstimmen — Doppelpflege
ist hier bestehendes, dokumentiertes Muster, siehe Kommentar über `ROUTE_TO_PACKAGE`, da
`apps/web` ohne Build-Schritt läuft und `packages/shared-types` nicht importieren kann).
Das neue Modul `apps/web/js/modules/qualifications.js` registriert sich mit
`roles: ['admin', 'trainer', 'athlete']` (kein `superadmin`, siehe Entscheidung zu Frage
5 in Abschnitt 8) und ist **nicht** Teil von `CORE_MODULE_IDS` — die Route erscheint also
nur, wenn der Verein das Paket über `enabledModules` gebucht hat, wie beim
Wettkampfmodul.

**Backend-Durchsetzung**: Die REST-Endpunkte aus Abschnitt 3 laufen NICHT über die
generische Sync-API (`canRead`/`canWrite` in `sync.permissions.ts` prüfen nur Sync-Stores,
siehe Abschnitt 1.1) — die Modul-Prüfung muss deshalb direkt im neuen Routen-Modul
erfolgen. Vorbild ist `resolveEnabledModules()`/`clubModulesCache` in
`apps/api/src/modules/sync/sync.route.ts` (kurzlebiger In-Memory-Cache je `clubId`,
45 s TTL, mit periodischem Sweep): dieselbe kleine, in sich geschlossene Cache-Closure
wird — bewusst dupliziert statt vorschnell extrahiert (dasselbe Muster existiert bislang
nur einmal; bei einem dritten Verwendungsfall lohnt sich ein gemeinsamer Helper) — als
`preHandler` in den neuen Qualifikations-Routen ergänzt und liefert bei fehlendem
`'qualifications'`-Eintrag in `enabledModules` `403`.

Neue Vereine bekommen wie alle anderen Pakete standardmäßig **alle** Module aktiviert
(`enabledModules: input.enabledModules ?? [...MODULE_KEYS]`, siehe
`invitations.repository.ts`/`invitations.repository.memory.ts`) — Superadmins können das
Paket beim Anlegen/Bearbeiten eines Vereins über die bestehende Checkbox-Liste in
`clubForm.js` (automatisch aus `MODULE_KEYS` abgeleitet) deaktivieren.

## 2. Datenmodell

### 2.1 Prisma (`apps/api/prisma/schema.prisma`)

```prisma
// Erfasste Qualifikation einer Person (Trainerlizenz, Rettungsschwimmschein,
// Erste-Hilfe-Kurs, …). onDelete: Cascade — analog RefreshToken/PasswordResetToken:
// ein gelöschtes Konto braucht keine eigenständig fortbestehenden Nachweise mehr
// (siehe Abschnitt 6 zu DSGVO-Auskunft/-Löschung).
model UserQualification {
  id            String    @id @default(uuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Feste, aktuell nicht vereinsspezifisch konfigurierbare Werteliste (siehe
  // Abschnitt 2.2 und Entscheidung zu Frage 1 in Abschnitt 8) — ermöglicht
  // Filterung/Reporting ("wer hat einen gültigen Rettungsschwimmschein?") und
  // mehrsprachige Anzeige über i18n-Keys statt gespeicherter Freitext-Labels.
  type          String
  // Freitext-Zusatz, z. B. Kursanbieter/Zertifikatsnummer — optional, nicht
  // Teil der Auswertungslogik.
  note          String    @default("")
  acquiredOn    DateTime
  // Nullable: nicht jede Qualifikation läuft ab (z. B. ein einmaliger
  // Grundlehrgang ohne Auffrischungspflicht).
  expiresOn     DateTime?
  // Datum des bereits organisierten Verlängerungs-/Auffrischungslehrgangs
  // (z. B. Trainer-C-Fortbildung, Rettungsschwimmer-Wiederholungskurs).
  // Nullable: gesetzt, sobald ein Termin feststeht — dient zugleich als
  // Flag ("ist etwas organisiert?", `!= null`) UND als Datumsangabe, ohne
  // ein separates Boolean-Feld zu benötigen. Kann VOR oder NACH `expiresOn`
  // liegen (ein Lehrgang wird oft schon Monate vor Ablauf gebucht) — anders
  // als bei `expiresOn`/`acquiredOn` gibt es hier keine Reihenfolge-
  // Validierung. Nach erfolgreichem Lehrgang entsteht daraus ein neuer,
  // eigener `UserQualification`-Datensatz (neues `acquiredOn`); dieses Feld
  // wird nicht rückwirkend zum neuen Datensatz "umgehängt".
  renewalCourseOrganizedOn DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  // Zugriffsmuster: "alle Qualifikationen einer Person" (eigene Ansicht) und
  // "alle bald ablaufenden Qualifikationen eines Vereins" (Erinnerungsjob,
  // siehe Abschnitt 5) — letzteres geht über User.clubId, kein direkter
  // clubId-Fremdschlüssel hier nötig (Qualifikation gehört zur Person, nicht
  // zum Verein; bei Vereinswechsel bleibt sie erhalten).
  @@index([userId, deletedAt])
  @@index([expiresOn])
  @@map("user_qualifications")
}
```

Ergänzung in `model User`: `qualifications UserQualification[]`.

### 2.2 Art der Qualifikation — feste Werteliste

Analog zu `AthleteGenderSchema`/`ResultStatusSchema` (`packages/shared-types/src/entities.ts`)
eine geschlossene Liste, damit Anzeige-Labels über `t('qualification.type.*')`
lokalisiert werden (Frontend ist zweisprachig vorbereitet, siehe `i18n.js`), statt vom
Nutzer frei getippten und damit inkonsistenten Text zu speichern:

```ts
export const QualificationTypeSchema = z.enum([
  'trainer_c',        // Trainer C-Lizenz
  'trainer_b',        // Trainer B-Lizenz
  'trainer_a',        // Trainer A-Lizenz
  'rettungsschwimmer_silber',
  'rettungsschwimmer_gold',
  'erste_hilfe',
  'kinderschutz',
  'sonstige',
]);
```

**Entscheidung** (siehe Frage 1, Abschnitt 8): für den ersten Umsetzungsschritt bleibt es
bei genau dieser festen, im Code gepflegten Liste — eine je Verein frei editierbare
Werteliste (eigene DB-Tabelle statt Enum) ist bewusst **nicht** Teil dieses Plans, um den
Umfang nicht vorzeitig aufzublähen. `type` wird trotzdem als stabiler String-Key (nicht
als reine Enum-Prüfung im Schema allein) behandelt, weil Abschnitt 2.4 bereits pro Typ
konfigurierbare Erinnerungs-Schwellen vorsieht — der Wert muss über Modell-Grenzen hinweg
(UserQualification ↔ ClubQualificationReminderSetting) referenzierbar bleiben. `'sonstige'`
+ `note`-Freitextfeld deckt Sonderfälle ab, ohne das Enum für jeden Einzelfall erweitern
zu müssen.

### 2.3 Zod-Schema (`packages/shared-types/src/entities.ts`)

```ts
export const UserQualificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: QualificationTypeSchema,
  note: z.string().max(500).default(''),
  acquiredOn: isoDate,
  expiresOn: nullableIsoDate,
  renewalCourseOrganizedOn: nullableIsoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict()
  // Ablauf darf fachlich nicht vor dem Erwerb liegen — clientseitig (Formular)
  // UND serverseitig (Route-Handler) geprüft, analog anderer Cross-Field-
  // Validierungen im Schema.
  .refine((v) => !v.expiresOn || v.expiresOn >= v.acquiredOn, {
    message: 'expiresOn darf nicht vor acquiredOn liegen',
    path: ['expiresOn'],
  });
export type UserQualification = z.infer<typeof UserQualificationSchema>;
```

Bewusst **nicht** Teil von `ENTITY_SCHEMAS` (siehe Abschnitt 1.1) — eigenständig
exportiert und vom neuen Qualifikations-Routen-Modul importiert.

### 2.4 Konfigurierbare Erinnerungs-Schwellen je Verein und Qualifikationstyp

**Entscheidung** (siehe Frage 4, Abschnitt 8): die Schwellen, ab wann vor Ablauf erinnert
wird, sind **je Verein UND je Qualifikationstyp** konfigurierbar (Beispiel: Trainerscheine
brauchen einen längeren Vorlauf als ein Erste-Hilfe-Nachweis). Dafür ein eigenes,
schlankes Prisma-Modell statt Freitext-Konfiguration in `Club`:

```prisma
// Je Verein und Qualifikationstyp konfigurierbare Vorlaufzeiten (in Tagen vor
// expiresOn) für Ablauf-Erinnerungen (siehe Abschnitt 5). Fehlt eine Zeile für
// einen (clubId, type)-Kombination, gilt der Fallback DEFAULT_REMINDER_THRESHOLDS_DAYS
// (siehe notifyExpiringQualifications.ts) — ein Verein muss also nichts
// konfigurieren, um sinnvolle Erinnerungen zu bekommen.
model ClubQualificationReminderSetting {
  id             String   @id @default(uuid())
  clubId         String
  club           Club     @relation(fields: [clubId], references: [id])
  // QualificationTypeSchema-Wert (siehe Abschnitt 2.2) — kein Fremdschlüssel,
  // da die Werteliste (noch) ein Enum im Code ist, keine eigene Tabelle.
  type           String
  // Tage vor `expiresOn`, an denen je einmalig erinnert wird, z. B. [60, 14].
  thresholdsDays Int[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([clubId, type])
  @@map("club_qualification_reminder_settings")
}
```

Verwaltung über zwei neue, admin-beschränkte Endpunkte (siehe Abschnitt 3), UI dafür
als eigener „Einstellungen"-Bereich innerhalb des neuen Moduls (siehe Abschnitt 4.4).

## 3. Backend: REST-Endpunkte

Eigenes Modul `apps/api/src/modules/qualifications/` (statt Erweiterung des bestehenden
`auth`-Moduls — die Kombination aus CRUD-Routen, Modul-Gate-Cache und
Einstellungs-Endpunkten rechtfertigt einen eigenen Zuschnitt, analog `invitations/` oder
`sync/`), mit `qualifications.repository.ts` (+ `.memory.ts` fürs Testen, analog
`erasure.repository.ts`/`erasure.repository.memory.ts`), `qualifications.service.ts` und
`qualifications.route.ts`.

Alle Endpunkte verlangen zusätzlich zur tabellarisch aufgeführten Rollenprüfung das in
Abschnitt 1.2 beschriebene Modul-Gate (`403`, wenn `qualifications` nicht in
`enabledModules` des Vereins der anfragenden Person enthalten ist). `superadmin` wird
über die bestehende `requireRole(...)`-Prüfung (analog `sync.route.ts`) durchgehend
ausgeschlossen — siehe Entscheidung zu Frage 5, Abschnitt 8.

| Methode & Pfad | Zweck | Berechtigung |
|---|---|---|
| `GET /api/me/qualifications` | Eigene Liste (Lesezugriff für jede Person) | `trainer`/`admin`/`athlete` |
| `GET /api/users/:userId/qualifications` | Liste einer beliebigen Person im eigenen Verein | `admin` |
| `POST /api/users/:userId/qualifications` | Anlegen | `admin` |
| `PATCH /api/users/:userId/qualifications/:id` | Bearbeiten (Datum korrigieren, `renewalCourseOrganizedOn` setzen, …) | `admin` |
| `DELETE /api/users/:userId/qualifications/:id` | Soft-Delete (`deletedAt`) | `admin` |
| `GET /api/qualification-settings` | Erinnerungs-Schwellen des eigenen Vereins lesen (siehe Abschnitt 2.4) | `admin` |
| `PUT /api/qualification-settings/:type` | Schwellen für einen Qualifikationstyp setzen/überschreiben | `admin` |

Kein Schreibzugriff für die betroffene Person selbst (Entscheidung zu Frage 2, Abschnitt
8) — anders als in einer früheren Fassung dieses Plans vorgesehen, legt **ausschließlich**
`admin` Qualifikationen an/bearbeitet/löscht sie; jede Person sieht über
`GET /api/me/qualifications` nur lesend die eigenen. `clubId`-Prüfung wie gehabt: der
Ziel-`User` von `:userId`-Routen muss im selben Verein wie die anfragende Person sein.

## 4. Frontend

### 4.1 Neues Modul `apps/web/js/modules/qualifications.js`

Ein einziger, eigenständiger Router-Eintrag (`id: 'qualifications'`, siehe Abschnitt 1.2)
statt mehrerer Einstiegspunkte — die frühere Idee, zusätzlich einen Abschnitt in
`profile.js` einzublenden, entfällt: da nur Admins schreiben dürfen (Abschnitt 3) und die
Sichtbarkeit ohnehin vom Modul-Flag abhängt, reicht eine Seite mit rollenabhängiger
Ansicht:

- **`admin`**: vollständige Mitgliederliste (analog `userManagement.js`) mit
  Qualifikationen je Person, CRUD-Formular (Typ-Auswahl, Erwerbsdatum, optionales
  Ablaufdatum, Notiz, optionales Datum „Verlängerungslehrgang organisiert am") sowie dem
  Einstellungen-Bereich aus Abschnitt 4.4.
- **`trainer`/`athlete`**: nur die eigene, schreibgeschützte Liste
  (`GET /api/me/qualifications`) — kein Formular, kein Bearbeiten-Button.

### 4.2 Statusanzeige

Farbcodierter Badge (vorhandene `badge()`-Helper aus `ui.js`, siehe Nutzung in
`userManagement.js`) nach verbleibender Zeit bis `expiresOn`, relativ zu den in Abschnitt
2.4 konfigurierten Schwellen des Vereins für den jeweiligen `type` (Fallback:
`DEFAULT_REMINDER_THRESHOLDS_DAYS`, siehe Abschnitt 5, wenn der Verein nichts
konfiguriert hat — z. B. `[60, 14]`):

- kein `expiresOn` → neutral, „unbefristet"
- `expiresOn` weiter als die größte konfigurierte Schwelle entfernt → `done` (grün),
  „gültig"
- `expiresOn` innerhalb einer konfigurierten Schwelle **und kein**
  `renewalCourseOrganizedOn` → `progress` (gelb), „läuft bald ab"
- `expiresOn` innerhalb einer konfigurierten Schwelle **und** `renewalCourseOrganizedOn`
  gesetzt → eigener Badge-Zustand (blau, kein bestehender `badge()`-Variant-Name passt —
  neue Variante `scheduled` in `ui.js` ergänzen), „Verlängerung am
  {renewalCourseOrganizedOn} geplant"
- `expiresOn` in der Vergangenheit und kein `renewalCourseOrganizedOn` → `open` (rot),
  „abgelaufen"
- `expiresOn` in der Vergangenheit, aber `renewalCourseOrganizedOn` in der Zukunft →
  wie „Verlängerung geplant" oben, nicht als hartes „abgelaufen" einfärben (Lehrgang
  liegt terminlich nur noch nicht in der Vergangenheit)

### 4.3 Kein neuer IndexedDB-Store

Kein Eintrag in `STORES` (`apps/web/js/db.js`) und kein Offline-Anlegen: Qualifikationen
werden — wie Einladungen — direkt über die REST-Endpunkte aus Abschnitt 3 geladen/
geschrieben, ohne Outbox-Queue. Das deckt sich mit der Erwartung, dass diese Verwaltung
i. d. R. online (am Vereinsabend, im Büro) stattfindet, nicht im Schwimmbad offline. Die
Route selbst erscheint clientseitig nur, wenn `enabledModules` (per Login/`/api/me`
geladen, siehe `state.js`) `qualifications` enthält (`isModuleVisible()` in `router.js`).

### 4.4 Einstellungen-Bereich (nur `admin`)

Innerhalb der neuen Modulseite: ein Tab/Abschnitt „Erinnerungs-Schwellen", der pro
Qualifikationstyp (Abschnitt 2.2) die konfigurierten Tage-Werte (Abschnitt 2.4) auflistet
und editierbar macht (`GET`/`PUT /api/qualification-settings*`). Typen ohne eigene
Konfiguration zeigen sichtbar den Fallback-Wert an, damit klar ist, dass „nichts
konfiguriert" nicht „keine Erinnerung" bedeutet.

## 5. Ablauf-Erinnerungen

Analog zu `apps/api/src/jobs/purgeExpiredDeletions.ts` (bestehender Cron-Job) ein neuer
Job `apps/api/src/jobs/notifyExpiringQualifications.ts`:

- läuft täglich, betrachtet ausschließlich Vereine mit `qualifications` in
  `enabledModules` (siehe Abschnitt 1.2 — deaktiviert ein Verein das Modul nachträglich,
  sollen keine Erinnerungen für seine Mitglieder mehr verschickt werden, auch wenn die
  Datenzeilen bestehen bleiben),
- sucht je Verein/Typ `UserQualification`-Zeilen, deren `expiresOn` eine der
  konfigurierten Schwellen (Abschnitt 2.4; Fallback `DEFAULT_REMINDER_THRESHOLDS_DAYS`,
  z. B. `[60, 14]`) erreicht hat, sowie bereits abgelaufene,
- **überspringt Zeilen mit gesetztem, in der Zukunft liegendem
  `renewalCourseOrganizedOn`**: ist der Verlängerungslehrgang bereits organisiert, besteht
  kein Handlungsbedarf mehr — die Erinnerung würde nur unnötig Rauschen erzeugen. Liegt
  `renewalCourseOrganizedOn` seinerseits in der Vergangenheit, ohne dass eine neue
  `UserQualification` mit aktuellerem `acquiredOn` nachgetragen wurde (Lehrgang fand
  vermutlich statt, wurde aber nicht nachgepflegt), erneut erinnern — sonst bleibt eine
  vergessene Nachpflege dauerhaft unsichtbar,
- verschickt E-Mail über den bestehenden `apps/api/src/mail/mailer.ts` an die betroffene
  Person **und** an die Admins des Vereins,
- markiert je Schwelle den Versand (neues Feld `remindersSentAt: Json?` oder eigene
  kleine Tabelle `QualificationReminderLog`, um Doppelversand bei mehrfachem Cron-Lauf
  zu vermeiden — Muster wie bei `DataDeletionRequest`/`purgeAfter` prüfen, das denselben
  „einmalig nach Fälligkeit ausführen"-Charakter hat).

Ergänzend ein Dashboard-Hinweis für Admins (`apps/web/js/modules/dashboard.js`): Anzahl
bald ablaufender/abgelaufener Qualifikationen im Verein, mit Link zur neuen Modulseite —
auch dieser Hinweis nur, wenn `qualifications` gebucht ist.

## 6. DSGVO

Qualifikationsdaten sind personenbezogen und gehören in die bestehenden
Auskunfts-/Löschmechanismen (`docs/backend-plan.md`, Abschnitt 14) — unabhängig von der
Rolle der betroffenen Person und unabhängig davon, ob der Verein das Modul aktuell
gebucht hat (bereits erfasste Daten bleiben auskunfts-/löschpflichtig):

- **Auskunft** (`GET /api/me/export`, `auth.service.ts`): `UserQualification`-Zeilen der
  anfragenden Person mit in den Export aufnehmen.
- **Löschung**: `onDelete: Cascade` auf `UserQualification.userId` (siehe Abschnitt 2.1)
  reicht — der bestehende Hard-Purge-Job löscht die Zeilen automatisch mit, keine
  Änderung an `jobs/purgeExpiredDeletions.ts` nötig.

## 7. Tests

- Zod-Schema: Grenzfälle (`expiresOn < acquiredOn` abgelehnt, `type` außerhalb der
  Werteliste abgelehnt) — analog bestehender Tests zu `entities.ts`.
- Repository: In-Memory-Variante analog `erasure.repository.memory.ts`, dieselben
  Tests wie gegen die echte Prisma-Implementierung (bestehendes Doppel-Test-Muster im
  Repo, siehe `entityRegistry.test.ts`).
- Route: Autorisierung — `admin` kann Mitglieder des eigenen Vereins verwalten, fremder
  Verein → `403`, eigenes Konto nur lesbar (`trainer`/`athlete` erhalten `403` auf
  schreibende Endpunkte), `superadmin` überall `403`/ausgeschlossen; Modul-Gate: `403`,
  wenn `qualifications` nicht gebucht ist, auch für sonst berechtigte Rollen.
- Einstellungen-Route: `PUT /api/qualification-settings/:type` nur für `admin`, Fallback
  greift korrekt, wenn keine Zeile existiert.
- Job: `notifyExpiringQualifications` — kein Doppelversand bei zweimaligem Lauf am
  selben Tag, korrekte Schwellenauswahl je Verein/Typ (inkl. Fallback), Vereine ohne
  gebuchtes Modul werden übersprungen, Zeilen mit gesetztem und zukünftigem
  `renewalCourseOrganizedOn` werden übersprungen, ein in der Vergangenheit liegendes
  `renewalCourseOrganizedOn` ohne neue Qualifikation löst wieder eine Erinnerung aus.

## 8. Entscheidungen

Ursprünglich als offene Fragen formuliert; die folgenden Entscheidungen sind bereits
getroffen und oben in den jeweiligen Abschnitten eingearbeitet.

1. **Werteliste der Qualifikationsarten** (Abschnitt 2.2) — mit tatsächlichem
   Vereinsbedarf abgleichen (DSV-/DLRG-Bezeichnungen variieren je Landesverband).
   **Entscheidung:** Für den ersten Schritt nur die in Abschnitt 2.2 vorgeschlagene, feste
   Liste. Eine je Verein frei konfigurierbare Werteliste ist eine mögliche spätere
   Erweiterung, aber nicht Teil dieses Plans.
2. **Darf eine Person eigene Qualifikationen selbst erfassen**, oder ausschließlich
   Admins? **Entscheidung:** Ausschließlich `admin` schreibt (anlegen/bearbeiten/löschen);
   jede Person sieht nur lesend die eigenen (siehe Abschnitt 3).
3. **Nachweis-Upload** (Foto/PDF des Zertifikats). **Entscheidung:** Aktuell bewusste
   Datensparsamkeit — kein Upload in diesem Plan, da kein bestehender
   Datei-Upload-Mechanismus im Repo vorhanden ist. Bei Bedarf künftig eine eigene Tabelle,
   die je Qualifikation auf Nachweisdokumente verweist (separates Feature).
4. **Erinnerungs-Schwellen** und ob sie konfigurierbar sein sollen. **Entscheidung:**
   Konfigurierbar je Verein UND je Qualifikationstyp (Trainerscheine brauchen einen
   längeren Vorlauf als z. B. Erste-Hilfe-Nachweise) — umgesetzt über
   `ClubQualificationReminderSetting` (Abschnitt 2.4) mit Fallback-Werten, falls ein
   Verein/Typ nichts konfiguriert.
5. **Sichtbarkeit für `superadmin`**. **Entscheidung:** Superadmins benötigen **keinen**
   Zugriff auf Qualifikationen — konsequent in Abschnitt 1.2/3 als ausgeschlossene Rolle
   geführt (passt zur bestehenden Systemgrenze: `superadmin` hat ohnehin keinen eigenen
   Verein, siehe `User.clubId`-Kommentar in `schema.prisma`).

### Verbleibende offene Punkte

- Genaue Fallback-Werte für `DEFAULT_REMINDER_THRESHOLDS_DAYS` (Vorschlag: `[60, 14]`
  Tage) — final mit Vereinsbedarf abstimmen.
- Ob bestehende Vereine das neue Modul beim Rollout rückwirkend automatisch gebucht
  bekommen (wie bei einer Migration üblich, da `enabledModules` beim Anlegen, nicht bei
  jedem neuen Paket, befüllt wird) oder ob ein Superadmin es je Verein manuell aktivieren
  muss — technisch unproblematisch (`enabledModules: string[]`-Spalte), reine
  Rollout-Entscheidung.

## 9. Umsetzungsschritte

1. `packages/shared-types/src/modules.ts`: `qualifications`-Paket ergänzen (Abschnitt
   1.2); `apps/web/js/router.js`: `ROUTE_TO_PACKAGE`-Eintrag spiegeln.
2. Prisma-Modelle `UserQualification` und `ClubQualificationReminderSetting` +
   Migration (`npx prisma migrate dev`).
3. Zod-Schema `QualificationTypeSchema`/`UserQualificationSchema` in `shared-types`.
4. Neues Backend-Modul `apps/api/src/modules/qualifications/` (Repository + Memory-
   Variante, Service, Routen inkl. Modul-Gate-Cache analog `sync.route.ts` und
   Einstellungs-Endpunkten aus Abschnitt 2.4/3).
5. `GET /api/me/export` um Qualifikationsdaten ergänzen (DSGVO-Auskunft).
6. Frontend-Modul `qualifications.js` (rollenabhängige Ansicht, Einstellungen-Tab für
   `admin`) + Registrierung in `router.js`.
7. i18n-Keys (`qualification.type.*`, Statuslabels inkl. neuer `scheduled`-Badge-Variante)
   in beiden Sprachdateien ergänzen.
8. Erinnerungsjob `notifyExpiringQualifications.ts` + Registrierung im Cron-Setup
   (analog `purgeExpiredDeletions.ts`) + Dashboard-Hinweis.
9. Tests je Schicht (Abschnitt 7).
10. `docs/backend-plan.md` Abschnitt „6 — Erweiterungen" bzw. `docs/todo.md` um den
    erledigten/laufenden Stand ergänzen, sobald die Umsetzung beginnt.
