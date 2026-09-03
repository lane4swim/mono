# Plan: Erfassung von Nutzer-Qualifikationen

Ziel: Für jede Person mit Konto (insbesondere Trainer:innen, aber nicht auf diese Rolle
beschränkt) erfassbar machen, welche Qualifikationen sie besitzt — z. B. Trainerlizenz
(C-/B-/A-Trainerschein), Rettungsschwimmschein (DLRG Silber/Gold), Erste-Hilfe-Kurs,
Kinderschutz-Schulung — jeweils mit **Erwerbsdatum**, **Art der Qualifikation** und
optionalem **Ablaufdatum**. Vereine müssen heute außerhalb der App (Excel, Papier)
nachhalten, wessen Nachweise bald ablaufen; Ziel dieses Features ist, das direkt im
Nutzerkonto abzubilden und rechtzeitig vor Ablauf zu erinnern.

Stand: Greenfield-Feature, kein bestehender Code. `docs/backend-plan.md` (Phasen 0–4)
und eine Code-Recherche in `apps/api`/`apps/web`/`packages/*` bilden die Grundlage für
die Architekturentscheidungen unten (Fastify/Prisma-Backend, Vanilla-JS-PWA-Frontend mit
IndexedDB-Offline-Cache, Sync-API als Schreibpfad für die zehn fachlichen Stores unter
`packages/shared-types/src/entities.ts: ENTITY_SCHEMAS`).

## 1. Architekturentscheidung: eigene Ressource statt Sync-Store

`User` ist **kein** Sync-Store (kein Eintrag in `ENTITY_SCHEMAS`/`ENTITY_STORE_NAMES`,
kein Prisma-Delegate in `apps/api/src/db/entityRegistry.ts`). Nutzerdaten werden nicht
offline bearbeitet und über die Outbox synchronisiert wie Athlet:innen oder
Trainingspläne, sondern über dedizierte REST-Endpunkte im `auth`-Modul verwaltet
(`GET/PATCH /api/me`, `GET /api/users`, `POST /api/invitations`, …); das Frontend hält
davon nur einen lokalen **Lese**-Cache im `users`-IndexedDB-Store (`apps/web/js/db.js`).

Qualifikationen sind Metadaten zu einem `User`, keine eigenständige, offline von
Athlet:innen editierbare fachliche Entität. Sie sollten deshalb **denselben Weg wie
`Invitation`/`PasswordResetToken`/`DataDeletionRequest` gehen**: ein eigenes
Prisma-Modell mit Fremdschlüssel auf `User`, eigene REST-Endpunkte im `auth`-Modul,
**kein** neuer Eintrag in `ENTITY_SCHEMAS` und **kein** neuer IndexedDB-Store in
`STORES` (`apps/web/js/db.js`). Das vermeidet unnötige Komplexität (kein
Modul-Paket in `packages/shared-types/src/modules.ts` nötig, keine Änderung an
`sync.permissions.ts`/`sync.service.ts`) und passt zum bestehenden Muster für
kontobezogene, aber nicht offline-fachliche Daten.

Alternative verworfen: Qualifikationen als eigener Sync-Store analog `Athlete` hätte
offline Anlegen/Bearbeiten auf dem Gerät ermöglicht, bringt hier aber keinen Mehrwert
(Qualifikationen werden typischerweise online von Admins/der betroffenen Person selbst
gepflegt) und hätte den Sync-Layer unnötig aufgebläht.

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
  // Feste Werteliste (siehe Abschnitt 2.2) statt Freitext — ermöglicht
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

  // Zugriffsmuster: "alle Qualifikationen einer Person" (Profilseite) und
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
eine geschlossene, aber erweiterbare Liste, damit Anzeige-Labels über `t('qualification.type.*')`
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

Genaue Werte in Abstimmung mit tatsächlichen Vereinsanforderungen finalisieren (siehe
Abschnitt 8, offene Frage). `'sonstige'` + `note`-Freitextfeld deckt Sonderfälle ab, ohne
das Enum für jeden Einzelfall erweitern zu müssen.

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

Bewusst **nicht** Teil von `ENTITY_SCHEMAS` (siehe Abschnitt 1) — eigenständig
exportiert und vom `auth`-Modul importiert.

## 3. Backend: REST-Endpunkte (`apps/api/src/modules/auth/`)

Neue Dateien `qualifications.repository.ts` (+ `.memory.ts` fürs Testen, analog
`erasure.repository.ts`/`erasure.repository.memory.ts`) und Ergänzungen in
`auth.route.ts`/`auth.service.ts`, oder — bei wachsendem Umfang — ein eigenes
`apps/api/src/modules/qualifications/`-Modul nach demselben Zuschnitt.

| Methode & Pfad | Zweck | Berechtigung |
|---|---|---|
| `GET /api/users/:userId/qualifications` | Liste für eine Person | eigenes Konto; sonst `admin`/`superadmin` desselben Vereins |
| `POST /api/users/:userId/qualifications` | Anlegen | `admin`/`superadmin` desselben Vereins (siehe Abschnitt 8, offene Frage zu Selbsterfassung) |
| `PATCH /api/users/:userId/qualifications/:id` | Bearbeiten (Datum korrigieren etc.) | wie Anlegen |
| `DELETE /api/users/:userId/qualifications/:id` | Soft-Delete (`deletedAt`) | wie Anlegen |
| `GET /api/me/qualifications` | Bequemer Alias auf die eigenen | jede angemeldete Person |

Rollen-/Mandantenprüfung analog bestehender Muster in `auth.route.ts`: `clubId` des
Ziel-`User` muss mit `request.user.clubId` übereinstimmen (Ausnahme `superadmin`,
vereinsübergreifend nur lesend über bestehende Superadmin-Oberfläche relevant, siehe
Abschnitt 8).

## 4. Frontend

### 4.1 Neues Modul `apps/web/js/modules/qualifications.js`

Zwei Einstiegspunkte, kein eigener Router-Eintrag (kein Modul-Paket in
`packages/shared-types/src/modules.ts` nötig, siehe Abschnitt 1):

- **Eigenes Profil** (`apps/web/js/modules/profile.js`): neuer Abschnitt „Meine
  Qualifikationen" mit Liste + „Hinzufügen"-Formular (Typ-Auswahl, Erwerbsdatum,
  optionales Ablaufdatum, Notiz, optionales Datum „Verlängerungslehrgang
  organisiert am").
- **Nutzerverwaltung** (`apps/web/js/modules/userManagement.js`): pro Mitglied in der
  Mitgliederliste ein Detail-/Ausklapp-Bereich mit derselben Liste, für Admins
  bearbeitbar.

Gemeinsame Render-/Formular-Bausteine liegen im neuen `qualifications.js` und werden aus
beiden Modulen importiert (analog `comments.js`, das ebenfalls von mehreren Modulen aus
eingebunden wird).

### 4.2 Statusanzeige

Farbcodierter Badge (vorhandene `badge()`-Helper aus `ui.js`, siehe Nutzung in
`userManagement.js`) nach verbleibender Zeit bis `expiresOn`:

- kein `expiresOn` → neutral, „unbefristet"
- `expiresOn` > 60 Tage entfernt → `done` (grün), „gültig"
- `expiresOn` ≤ 60 Tage entfernt **und kein** `renewalCourseOrganizedOn` → `progress`
  (gelb), „läuft bald ab"
- `expiresOn` ≤ 60 Tage entfernt **und** `renewalCourseOrganizedOn` gesetzt → eigener
  Badge-Zustand (blau, kein bestehender `badge()`-Variant-Name passt — neue Variante
  `scheduled` in `ui.js` ergänzen), „Verlängerung am {renewalCourseOrganizedOn} geplant"
- `expiresOn` in der Vergangenheit und kein `renewalCourseOrganizedOn` → `open` (rot),
  „abgelaufen"
- `expiresOn` in der Vergangenheit, aber `renewalCourseOrganizedOn` in der Zukunft →
  wie „Verlängerung geplant" oben, nicht als hartes „abgelaufen" einfärben (Lehrgang
  liegt terminlich nur noch nicht in der Vergangenheit)

Schwellenwert 60 Tage vorläufig — abzustimmen (siehe Abschnitt 8).

### 4.3 Kein neuer IndexedDB-Store

Kein Eintrag in `STORES` (`apps/web/js/db.js`) und kein Offline-Anlegen: Qualifikationen
werden — wie Einladungen — direkt über die REST-Endpunkte aus Abschnitt 3 geladen/
geschrieben, ohne Outbox-Queue. Das deckt sich mit der Erwartung, dass diese Verwaltung
i. d. R. online (am Vereinsabend, im Büro) stattfindet, nicht im Schwimmbad offline.

## 5. Ablauf-Erinnerungen

Analog zu `apps/api/src/jobs/purgeExpiredDeletions.ts` (bestehender Cron-Job) ein neuer
Job `apps/api/src/jobs/notifyExpiringQualifications.ts`:

- läuft täglich, sucht `UserQualification`-Zeilen mit `expiresOn` in z. B. 30/7 Tagen
  (zwei Schwellen, jeweils einmalig, kein Spam) sowie bereits abgelaufene,
- **überspringt Zeilen mit gesetztem `renewalCourseOrganizedOn`**: ist der
  Verlängerungslehrgang bereits organisiert, besteht kein Handlungsbedarf mehr — die
  Erinnerung würde nur unnötig Rauschen erzeugen. Liegt `renewalCourseOrganizedOn`
  seinerseits in der Vergangenheit, ohne dass eine neue `UserQualification` mit
  aktuellerem `acquiredOn` nachgetragen wurde (Lehrgang fand vermutlich statt, wurde
  aber nicht nachgepflegt), erneut erinnern — sonst bleibt eine vergessene Nachpflege
  dauerhaft unsichtbar,
- verschickt E-Mail über den bestehenden `apps/api/src/mail/mailer.ts` an die betroffene
  Person **und** an die Admins des Vereins,
- markiert je Schwelle den Versand (neues Feld `remindersSentAt: Json?` oder eigene
  kleine Tabelle `QualificationReminderLog`, um Doppelversand bei mehrfachem Cron-Lauf
  zu vermeiden — Muster wie bei `DataDeletionRequest`/`purgeAfter` prüfen, das denselben
  „einmalig nach Fälligkeit ausführen"-Charakter hat).

Ergänzend ein Dashboard-Hinweis für Admins (`apps/web/js/modules/dashboard.js`): Anzahl
bald ablaufender/abgelaufener Qualifikationen im Verein, mit Link zur Nutzerverwaltung.

## 6. DSGVO

Qualifikationsdaten sind personenbezogen und gehören in die bestehenden
Auskunfts-/Löschmechanismen (`docs/backend-plan.md`, Abschnitt 14):

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
- Route: Autorisierung (fremder Verein → 403, eigenes Konto lesbar, Admin kann fremde
  Konten im eigenen Verein verwalten, `superadmin` je nach Entscheidung aus Abschnitt 8).
- Job: `notifyExpiringQualifications` — kein Doppelversand bei zweimaligem Lauf am
  selben Tag, korrekte Schwellenauswahl, Zeilen mit gesetztem und zukünftigem
  `renewalCourseOrganizedOn` werden übersprungen, ein in der Vergangenheit liegendes
  `renewalCourseOrganizedOn` ohne neue Qualifikation löst wieder eine Erinnerung aus.

## 8. Offene Fragen (vor Umsetzung zu klären)

1. **Werteliste der Qualifikationsarten** (Abschnitt 2.2) — mit tatsächlichem
   Vereinsbedarf abgleichen (DSV-/DLRG-Bezeichnungen variieren je Landesverband).
2. **Darf eine Person eigene Qualifikationen selbst erfassen**, oder ausschließlich
   Admins (Nachweispflicht/Vertrauenswürdigkeit)? Aktueller Vorschlag in Abschnitt 3:
   nur Admins schreiben, jede Person sieht nur lesend die eigenen.
3. **Nachweis-Upload** (Foto/PDF des Zertifikats) — nicht Teil dieses Plans, da kein
   bestehender Datei-Upload-Mechanismus im Repo vorhanden ist; separates Feature,
   falls gewünscht.
4. **Erinnerungs-Schwellen** (30/7 Tage, Abschnitt 5) und ob Admins die Schwellen pro
   Verein konfigurieren können sollen, oder ein fester Wert für alle reicht.
5. **Sichtbarkeit für `superadmin`**: reine Systemadministration ohne Vereinszugehörigkeit
   (siehe `User.clubId` Kommentar in `schema.prisma`) — vermutlich keine Notwendigkeit,
   vereinsübergreifend Qualifikationen einzusehen; zu bestätigen.

## 9. Umsetzungsschritte

1. Prisma-Modell `UserQualification` + Migration (`npx prisma migrate dev`).
2. Zod-Schema `QualificationTypeSchema`/`UserQualificationSchema` in `shared-types`.
3. Repository (+ Memory-Variante) und Routen im `auth`-Modul.
4. `GET /api/me/export` um Qualifikationsdaten ergänzen (DSGVO-Auskunft).
5. Frontend-Modul `qualifications.js` + Einbindung in `profile.js`/`userManagement.js`.
6. i18n-Keys (`qualification.type.*`, Statuslabels) in beiden Sprachdateien ergänzen.
7. Erinnerungsjob `notifyExpiringQualifications.ts` + Registrierung im Cron-Setup
   (analog `purgeExpiredDeletions.ts`) + Dashboard-Hinweis.
8. Tests je Schicht (Abschnitt 7).
9. `docs/backend-plan.md` Abschnitt „6 — Erweiterungen" bzw. `docs/todo.md` um den
   erledigten/laufenden Stand ergänzen, sobald die Umsetzung beginnt.
