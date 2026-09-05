# Plan: Kampfrichter-Modul (Rolle, Qualifikationen, Wettkampfeinsätze)

Ziel: Kampfrichter:innen als eigene Personengruppe im System abbilden — mit
eigener **Rolle** `referee`, ihren **Qualifikationen** (Kampfrichterschein,
Protokollführer:in, Schiedsrichter:in, Startrichter:in, Zeitnehmer:in, …)
**inklusive Requalifikationsdaten**, sowie einem Verlauf ihrer
**Wettkampfeinsätze** (wann, wo, in welcher Funktion eingesetzt). Das Ganze
als eigenständiges, **je Verein zubuchbares Modul**, analog zum bestehenden
Wettkampf- und Qualifikationsmodul.

Zusätzliche, über das reine Feature hinausgehende Anforderung: **Nutzer:innen
müssen mehrere Rollen gleichzeitig innehaben können** (z. B. Trainer:in UND
Athlet:in UND Kampfrichter:in in einer Person) — das ist heute architektonisch
nicht möglich (`User.role` ist ein einzelner Wert) und muss als **Vorstufe**
dieses Plans behandelt werden (Abschnitt 1). Alles Weitere in diesem Dokument
baut darauf auf.

Stand: Greenfield-Feature für Kampfrichter, aber auf bereits **produktivem
Code** aufbauend — anders als beim ursprünglichen
`docs/nutzer-qualifikationen-plan.md` (der inzwischen vollständig umgesetzt
ist, siehe `apps/api/src/modules/qualifications/`,
`apps/web/js/modules/qualifications.js`) ist die Qualifikationsverwaltung
bereits fertige Infrastruktur, die dieser Plan bewusst **wiederverwendet**
statt dupliziert (Abschnitt 3). Grundlage: Code-Recherche in
`apps/api/src/plugins/authorize.ts`, `packages/shared-types/src/{user,auth,
invitation,modules}.ts`, `apps/api/prisma/schema.prisma`,
`apps/web/js/{state,router}.js` sowie der bereits umgesetzte
`nutzer-qualifikationen-plan.md` als unmittelbares Vorbild für Modul-Zuschnitt
und Entscheidungsstil.

---

## 1. Vorstufe: Mehrere Rollen gleichzeitig

### 1.1 Ist-Zustand

- `RoleSchema = z.enum(['superadmin', 'admin', 'trainer', 'athlete'])`
  (`packages/shared-types/src/user.ts:15`) — **ein** Wert pro Konto.
- `User.role` in `schema.prisma` ist eine einzelne `String`-Spalte, keine
  Liste/Relation.
- Access-Token-Claims tragen `role: Role` (`auth.ts: AccessTokenClaimsSchema`),
  nicht `roles`.
- `requireRole(...allowed)` (`apps/api/src/plugins/authorize.ts`) prüft
  `allowed.includes(request.user.role)` — ein Konto kann nur eine einzige
  Rollenprüfung gleichzeitig erfüllen.
- Frontend: `apps/web/js/router.js: isModuleVisible()` prüft
  `mod.roles.includes(role)` mit dem einzelnen `getRole()`-Wert aus
  `state.js`. Jedes Modul (`athletes.js`, `plans.js`, `qualifications.js`, …)
  registriert `roles: [...]` als Array **möglicher** Rollen, nicht als
  Rollen, die eine Person gleichzeitig haben könnte.
- Einladungen (`InvitationRoleSchema`, `invitation.ts:89`) vergeben genau
  eine Rolle bei Kontoerstellung; es gibt **keinen** Endpunkt, der einem
  bestehenden Konto nachträglich eine weitere Rolle hinzufügt.

Konsequenz: Eine Person, die z. B. sowohl selbst schwimmt (`athlete`) als
auch Kampfrichter:in ist (`referee`), bräuchte heute zwei Konten mit
unterschiedlichen E-Mail-Adressen — nicht praktikabel und nicht das, was
gefordert ist.

### 1.2 Zielmodell: `roles: Role[]` statt `role: Role`

**`superadmin` bleibt Sonderfall, exklusiv und unverändert:** kein Verein
(`clubId: null`), von der gesamten Sync-API ausgeschlossen (siehe
`backend-plan.md` Abschnitt 9) — wird **nie** mit anderen Rollen kombiniert
und bleibt weiterhin nie per API vergebbar (nur `scripts/createSuperAdmin.ts`).
Alles Folgende betrifft ausschließlich Vereinsmitglieder.

```ts
// packages/shared-types/src/user.ts
export const RoleSchema = z.enum(['superadmin', 'admin', 'trainer', 'athlete', 'referee']);
export type Role = z.infer<typeof RoleSchema>;

// Nicht-leere Liste; superadmin nie gemeinsam mit einer anderen Rolle
// (serverseitig zusätzlich per .refine() geprüft, siehe 1.5).
export const UserRolesSchema = z.array(RoleSchema).min(1);
```

`User.role: RoleSchema` wird zu `User.roles: UserRolesSchema`. Jede Stelle,
die bisher `user.role === 'x'` oder `allowed.includes(role)` prüfte, wird zu
einer Mengen-Prüfung: `hasRole(user, 'x')` bzw.
`allowed.some(r => user.roles.includes(r))`.

**Warum Array-Spalte statt eigener `UserRole`-Zwischentabelle:** Die Menge
möglicher Rollen ist klein und fest (`RoleSchema`), es gibt keinen Bedarf an
zusätzlichen Metadaten pro Rollenzuweisung (kein "seit wann", kein "von wem
vergeben" — anders als z. B. bei `UserQualification`, wo genau solche
Metadaten den fachlichen Kern bilden). PostgreSQL/Prisma unterstützen native
`String[]`-Spalten bereits im Schema (`Club.enabledModules` ist exakt dieses
Muster). Eine Zwischentabelle wäre hier zusätzliche Komplexität ohne
Mehrwert — bewusst **verworfene Alternative**, analog zur Begründung in
Abschnitt 1.1 des Qualifikationsplans gegen einen eigenen Sync-Store.

### 1.3 Migration (expand → migrate → contract)

1. **Expand:** Neue Spalte `User.roles String[] @default([])` per Prisma-
   Migration ergänzen, `role String` bleibt vorerst bestehen.
2. **Backfill:** Einmaliges Migrations-Skript (analog
   `scripts/createSuperAdmin.ts`) setzt `roles = [role]` für jede bestehende
   Zeile.
3. **Cutover:** Anwendungscode (Backend + Frontend, siehe 1.4/1.5) liest/
   schreibt ausschließlich noch `roles`. `role` wird nicht mehr befüllt.
4. **Contract:** Nach einer Übergangszeit eigene Migration, die die `role`-
   Spalte entfernt. Bis dahin bleibt sie als Sicherheitsnetz (Rollback ohne
   Datenverlust) bestehen, wird aber von keinem Code mehr gelesen.

### 1.4 Backend-Anpassungen

- **JWT-Claims:** `AccessTokenClaimsSchema.role` → `.roles: UserRolesSchema`
  (`auth.ts`). Jede Signier-/Verifizierstelle in `auth/tokens.ts` entsprechend
  anpassen.
- **`requireRole()` → `requireAnyRole()`** (`plugins/authorize.ts`): prüft
  `allowed.some(r => request.user.roles.includes(r))` statt Gleichheit. Name
  bewusst geändert (nicht nur Body), damit jede der 16 bestehenden
  Aufrufstellen (`grep -rn "requireRole("`) beim Kompilieren auffällt und
  manuell auf die neue Semantik geprüft wird — ein stiller Drop-in-Ersatz
  wäre hier riskant, weil sich die Bedeutung von "die eine Rolle" zu "mindestens
  eine der Rollen" ändert.
- **Neuer Endpunkt `PATCH /api/users/:userId/roles`** (`admin`, eigener
  Verein — analog bestehender `:userId`-Routen-Autorisierung): Body
  `{ roles: Role[] }`, ersetzt die vollständige Rollenmenge (kein
  Add/Remove-Diff-Endpunkt, um Race Conditions zwischen zwei gleichzeitigen
  Änderungen zu vermeiden — Client schickt immer die vollständige Zielmenge,
  wie bei `PUT /api/qualification-settings/:type`).
  - Validierung: `roles` nicht leer, `superadmin` nicht enthalten (kann nur
    über `scripts/createSuperAdmin.ts` vergeben werden), Ziel-`User` im
    eigenen Verein.
  - **Sicherheitsregel „kein Verein ohne Admin":** Entzieht diese Änderung
    der letzten `admin`-Rolle im Verein, wird `409` zurückgegeben (analog zu
    bestehenden Konflikt-Antworten im Sync-Bereich) — Prüfung per
    `COUNT(*) WHERE clubId = X AND 'admin' = ANY(roles)` vor dem Schreiben.
  - **Sofortige Wirkung statt bis zu 30 Tage Verzögerung:** Ohne weitere
    Maßnahme bliebe eine entzogene Rolle bis zu `JWT_REFRESH_TTL_DAYS` (30
    Tage) lang wirksam, weil das Access Token die Rollen zum Ausstellzeitpunkt
    einfriert und ein Refresh sie einfach unverändert erneuert. Analog zu
    `revokeAllForUser()` bei der DSGVO-Löschung (`backend-plan.md`
    Abschnitt 14) ruft `PATCH /api/users/:userId/roles` deshalb ebenfalls
    `revokeAllForUser(userId)` auf — die betroffene Person muss sich neu
    einloggen, danach trägt das neue Access Token die aktuelle Rollenmenge.
    Bewusste, kleine UX-Einbuße (erzwungenes Re-Login) zugunsten sofort
    wirksamer Rechteänderungen — passt zum bisherigen Sicherheitsanspruch des
    Projekts (siehe die zahlreichen Härtungsrunden in
    `backend-plan.md` Abschnitt 15).
- **Einladungen:** `InvitationRoleSchema` um `'referee'` erweitern
  (`admin | trainer | athlete | referee`) — eine Person kann direkt als
  Kampfrichter:in eingeladen werden (z. B. ein:e reine:r Verbands-Kampfrichter:in
  ohne Trainer-/Athletenfunktion im Verein). `AcceptInvitationRequestSchema`/
  `acceptInvitation()` legt `roles: [invitation.role]` an (Startmenge mit
  genau einer Rolle) — weitere Rollen kommen ausschließlich über den neuen
  Endpunkt aus 1.4 hinzu, nie direkt bei Registrierung.
- **`GET /api/users`-Sortierung:** bisher „admin → trainer → athlete"; mit
  Mehrfachrollen sortiert nach einer Prioritätsreihenfolge
  (`admin > trainer > referee > athlete`) der jeweils **höchsten** Rolle
  einer Person — reine Anzeige-/Gruppierungslogik, keine Berechtigung.

### 1.5 Sync-API: bestehende athlete-Einschränkungen nicht versehentlich lockern oder verschärfen

`backend-plan.md` Abschnitt 6.5/15 (Fund 6/7) schränkt für Rolle `athlete`
bewusst `actionItems`/`sessions`-Schreibzugriff und `Athlete.notes`-Lesezugriff
ein. Mit Mehrfachrollen muss klar sein, **wessen** Zugriff das betrifft:

- **Neue Regel:** Die athlete-spezifischen Einschränkungen in
  `sync.service.ts` greifen nur, wenn die Person **ausschließlich** die Rolle
  `athlete` hat und **keine** Staff-Rolle (`trainer`/`admin`). Eine Person mit
  `roles: ['trainer', 'athlete']` bleibt vollzugriffsberechtigt wie ein reiner
  Trainer — das entspricht der bereits heute geltenden Prämisse „Trainer:innen
  und Admins sind gleichberechtigte Staff-Rollen mit vollem Datenzugriff"
  (Abschnitt 6.5) und ändert an deren Umfang nichts.
- **`referee` bleibt für die Sync-API bedeutungslos:** Kampfrichter:innen
  bekommen über diesen Plan **keinen** zusätzlichen Zugriff auf Athlet:innen-/
  Trainings-/Ergebnisdaten. Eine Person mit `roles: ['athlete', 'referee']`
  unterliegt weiterhin genau den athlete-Einschränkungen aus Abschnitt 6.5 —
  `referee` ist kein „Staff"-Rolle im Sinne dieser Prüfung.
- **Regressionstest zwingend:** bestehende Tests zu Fund 6/7
  (`sync.service.ts`) um Fallkombinationen `['athlete','referee']` (weiterhin
  eingeschränkt) und `['trainer','athlete']` (weiterhin voll berechtigt)
  ergänzen — genau die Stelle, an der eine Mehrfachrollen-Einführung
  unbemerkt eine bestehende Sicherheitsgrenze aufweichen könnte, wenn die
  Prüfung naiv auf „Rolle `athlete` enthalten" statt „ausschließlich
  `athlete`" umgestellt würde.

### 1.6 Frontend-Anpassungen

- `apps/web/js/state.js`: `getRole()` → `getRoles(): Role[]`, dazu
  `hasRole(r)`/`isTrainerOrAdmin()` (bestehende Helper) auf `roles.some(...)`
  umstellen.
- `apps/web/js/router.js`: `isModuleVisible(mod, roles, enabledModules)`
  prüft `mod.roles.some(r => roles.includes(r))` — **das ist bereits der
  Mechanismus, der „mehrere Rollen gleichzeitig wahrnehmen" im Alltag
  löst:** Navigation/Bottom-Nav zeigen automatisch die Vereinigung aller
  Module, für die irgendeine der eigenen Rollen berechtigt ist — Trainer- UND
  Athlet:innen- UND Kampfrichter-Module gleichzeitig, ohne Rollen-Umschalter,
  ohne „aktive Rolle" als zusätzliches UI-Konzept. Es ist bewusst **kein**
  Rollen-Switcher geplant (wie er z. B. für Superadmin/Admin denkbar wäre) —
  die Anforderung lautet ausdrücklich „gleichzeitig wahrnehmen", nicht
  „zwischen Rollen wechseln".
- `apps/web/js/modules/userManagement.js`: Rollenanzeige pro Person wird von
  einem einzelnen Label zu einer Reihe kleiner Badges (eine je Rolle);
  Admin-Ansicht bekommt einen „Rollen verwalten"-Dialog (Checkboxen je
  `RoleSchema`-Wert außer `superadmin`), der `PATCH /api/users/:userId/roles`
  aufruft. Hinweistext im Dialog: „Nach dem Speichern muss sich diese Person
  neu anmelden" (siehe 1.4, `revokeAllForUser`).
- Alle bestehenden Modul-Registrierungen (`athletes.js`, `plans.js`, …)
  bleiben inhaltlich unverändert (`roles: [...]` beschreibt weiterhin, welche
  Rollen das Modul sehen dürfen) — nur die Auswertung in `router.js` ändert
  sich von „ist gleich" zu „ist enthalten in".

### 1.7 Tests

- Zod: `UserRolesSchema` (leer abgelehnt, `superadmin` in Kombination mit
  anderer Rolle abgelehnt).
- `requireAnyRole()`: Einzelrolle wie bisher, Kombinationen, keine
  passende Rolle → `403`.
- `PATCH /api/users/:userId/roles`: eigener Verein, fremder Verein → `403`,
  letzte `admin`-Rolle eines Vereins entziehen → `409`, `superadmin` in
  `roles` → `400`, erfolgreiche Änderung widerruft alle Refresh-Tokens der
  Zielperson.
- Sync-Regression wie in 1.5 beschrieben.
- Frontend: `isModuleVisible()`/`visibleModules()` mit Mehrfachrollen-Arrays.

---

## 2. Neue Rolle `referee` (Kampfrichter:in)

Mit Abschnitt 1 als Grundlage ist die neue Rolle selbst nur noch ein weiterer
Enum-Wert (`RoleSchema`, `InvitationRoleSchema`) plus die üblichen
Folgestellen, die jede neue Rolle im Projekt schon heute berührt (Beispiel
`admin`/`athlete` als Vorlage):

- `apps/web/js/i18n/{de-DE,en-US}.js`: neues Label `role.referee` = „Kampfrichter:in" / "Referee".
- `userManagement.js`: neue Gruppierungs-/Filterkategorie in der Mitgliederliste.
- `GET /api/users`-Sortierpriorität (siehe 1.4).
- Superadmin-Oberfläche (`apps/web/admin/`): `ClubMemberCountsSchema`
  (`invitation.ts:35`) um `referee: z.number().int().nonnegative()` erweitern,
  `prisma.user.groupBy()` in der Mitgliederzahl-Ermittlung entsprechend
  anpassen (Achtung: `groupBy` über eine Array-Spalte funktioniert nicht wie
  über eine skalare Spalte — Zählung muss über
  `WHERE 'referee' = ANY(roles)` je Rolle einzeln erfolgen, nicht per
  einzelnem `groupBy(['role'])` wie bisher; das betrifft auch die Zählung von
  `admin`/`trainer`/`athlete`, da diese künftig ebenfalls Mehrfachrollen sein
  können und sich nicht mehr gegenseitig ausschließen).

Kein eigener Login-/Registrierungsweg nötig — Kampfrichter:innen werden wie
jede andere Rolle per Einladung (`admin` lädt ein, `role: 'referee'`) oder
nachträglich per Rollen-Zuweisung (Abschnitt 1.4) angelegt.

---

## 3. Qualifikationen: bestehende Infrastruktur erweitern statt duplizieren

### 3.1 Entscheidung: kein zweites Qualifikationssystem

Die Anforderung „Qualifikationen (Kampfrichter, Protokoll, etc.) inklusive
Requalifikationsdaten" beschreibt **exakt** die Datenform, die
`UserQualification` (`docs/nutzer-qualifikationen-plan.md`, inzwischen
produktiv: `apps/api/prisma/schema.prisma: model UserQualification`,
`packages/shared-types/src/entities.ts` o. ä.) bereits liefert:
`type`, `acquiredOn`, `expiresOn`, `renewalCourseOrganizedOn`
(„Requalifikation organisiert am") — letzteres deckt den Begriff
„Requalifikationsdaten" bereits ab. Ein zweites, paralleles Modell nur für
Kampfrichter-Qualifikationen würde CRUD, Erinnerungsjob
(`notifyExpiringQualifications.ts`), DSGVO-Export und Tests komplett
duplizieren, ohne fachlich etwas anderes zu tun.

**Umsetzung:** `QualificationTypeSchema` (`packages/shared-types/src/
entities.ts` bzw. wo die Werteliste heute lebt) um Kampfrichter-spezifische
Werte erweitern:

```ts
export const QualificationTypeSchema = z.enum([
  // … bestehende Werte (trainer_c, trainer_b, trainer_a,
  // rettungsschwimmer_silber, rettungsschwimmer_gold, erste_hilfe,
  // kinderschutz, sonstige) …
  'kampfrichter',
  'schiedsrichter',
  'startrichter',
  'zeitnehmer',
  'bahnrichter',
  'wettkampfsekretaer',   // Protokollführer:in
]);
```

**Entscheidung (Abstimmung 2026-09-05):** DSV-Standardbegriffe, bewusst
**ohne** C/B/A-Stufung wie bei Trainerscheinen — im DSV-Kampfrichterwesen
gibt es je Amt genau eine Lizenz (man ist „Kampfrichter:in"/„Schiedsrichter:in"/
… oder nicht), keine gestuften Ausbaustufen. Dieselbe flache Liste wird in
Abschnitt 5.3 für `RefereeFunctionSchema` verwendet — beide Enums bleiben
trotzdem, wie dort begründet, unabhängige Definitionen. Landesverbands-
spezifische Abweichungen in der Bezeichnung sind unkritisch, da `type` nur
als String-Key referenziert wird (i18n-Keys `qualification.type.*` folgen der
Benennung 1:1) und sich später anpassen lässt, ohne bestehende Daten zu
migrieren.

**Schreibrecht bleibt unverändert admin-only** (Entscheidung 2 des
Qualifikationsplans gilt hier unverändert weiter — bewusst **kein**
Sonderfall für Kampfrichter-Typen): eine Person trägt ihre eigene
Kampfrichter-Requalifikation nicht selbst ein, das bleibt Verwaltungsaufgabe.

### 3.2 Sichtbarkeit — zwei Blickwinkel auf dieselben Daten

- Die **bestehende** Qualifikationsseite (`qualifications.js`, Modul
  `qualifications`) zeigt weiterhin **alle** Qualifikationstypen einer Person
  unverändert an — inklusive der neuen Kampfrichter-Typen, falls vorhanden.
  Keine Änderung an ihrem Zuschnitt nötig.
- Das **neue** Kampfrichter-Modul (Abschnitt 4) zeigt zusätzlich, gefiltert
  auf **nur** die Kampfrichter-relevanten Typen, kombiniert mit den
  Wettkampfeinsätzen (Abschnitt 5) — als fachlicher Arbeitsbereich einer
  Kampfrichter:in, nicht als Konkurrenz zur allgemeinen Qualifikationsseite.
  Eine Konstante `REFEREE_QUALIFICATION_TYPES` (Teilmenge von
  `QualificationTypeSchema`, siehe 3.1) wird von beiden Frontend-Modulen
  importiert, um Drift zwischen „was zeigt qualifications.js" und „was
  filtert kampfrichter.js" zu vermeiden.

### 3.3 Erinnerungs-Schwellen

`ClubQualificationReminderSetting` (Abschnitt 2.4 des Qualifikationsplans)
ist bereits **je Typ** konfigurierbar — Kampfrichter-Lizenzen brauchen keine
neue Tabelle, nur ggf. andere Standardwerte in
`DEFAULT_REMINDER_THRESHOLDS_DAYS` bzw. eigene Einträge in
`ClubQualificationReminderSetting` je Verein. Kein Code-Änderungsbedarf.

---

## 4. Neues Modul `kampfrichter`

### 4.1 Modul-Paket

```ts
// packages/shared-types/src/modules.ts
export const MODULE_PACKAGES = {
  // … bestehende Pakete …
  kampfrichter: { routeIds: ['kampfrichter'], stores: [] },
} as const satisfies Record<string, ModulePackage>;
```

`stores: []` wie bei `qualifications`/`times`/`stats` — kein Sync-Store,
siehe Abschnitt 5.1. `apps/web/js/router.js: ROUTE_TO_PACKAGE` um
`kampfrichter: 'kampfrichter'` spiegeln (bestehendes Doppelpflege-Muster,
siehe Kommentar dort).

**Warum ein eigenes Modul statt Erweiterung von `qualifications`:** Das
Modul-Flag steuert, ob ein Verein die Funktion **überhaupt** gebucht hat —
ein Verein ohne eigene Kampfrichter:innen (z. B. reiner Freizeitverein ohne
Wettkampfbetrieb) braucht weder die Wettkampfeinsatz-Erfassung noch die
Kampfrichter-Übersichtsseite, während er `qualifications` (Trainerlizenzen,
Erste-Hilfe, …) sehr wohl nutzen kann. Getrennte Buchbarkeit spiegelt genau
diese unabhängige fachliche Entscheidung wider, analog zur bestehenden
Trennung von `competitions` und `qualifications`.

### 4.2 Frontend-Modul `apps/web/js/modules/kampfrichter.js`

`roles: ['admin', 'referee']` — anders als die allgemeine
Qualifikationsseite (dort sehen `trainer`/`athlete` ebenfalls ihre eigenen,
i. d. R. nicht-Kampfrichter-Qualifikationen) ist diese Seite fachlich nur für
Kampfrichter:innen selbst sowie zur Verwaltung/Auswertung durch `admin`
relevant. Eine Person mit `roles: ['trainer', 'referee']` sieht das Modul
also — genau das im Sinn von Abschnitt 1.6 „mehrere Rollen gleichzeitig
wahrnehmen".

- **`referee`:** eigene Ansicht — Kampfrichter-Qualifikationsstatus
  (schreibgeschützt, wie in 3.2 gefiltert) sowie die eigene Liste der
  Wettkampfeinsätze (Abschnitt 5) mit CRUD (siehe dort — hier **abweichend**
  von der Qualifikationsseite bewusst Selbstverwaltung erlaubt).
- **`admin`:** vollständige Übersicht aller Kampfrichter:innen des Vereins
  (Personen mit `'referee'` in `roles`) mit Qualifikationsstatus und
  Einsatzhistorie — als Planungs-/Nachweisgrundlage (z. B. für die jährliche
  Kampfrichter-Meldung an den Landesverband). Zusätzlich CRUD-Formular je
  Kampfrichter:in für deren Wettkampfeinsätze (Abschnitt 5.5) — sichtbar als
  „im Namen von {Name} erfassen", mit deutlicher Kennzeichnung admin-seitig
  angelegter Einträge (`createdByAdminId`, siehe 5.2) in der Liste.

### 4.3 i18n

Neue Keys: `nav.kampfrichter`, `role.referee`, `qualification.type.kampfrichter_*`
usw. (siehe 3.1), `referee.assignment.function.*` (siehe 5.2), Status-/
Formularlabels analog zum bestehenden `qualifications.js`-Wortschatz.

---

## 5. Wettkampfeinsätze

### 5.1 Eigene Ressource, kein Sync-Store — und bewusst ohne feste Kopplung an `Competition`

Wie `UserQualification` (Abschnitt 1.1 des Qualifikationsplans) ist ein
Wettkampfeinsatz Metadaten zu einer Person, nicht offline von mehreren
Geräten aus konkurrierend zu bearbeiten — eigene REST-Ressource, **kein**
Eintrag in `ENTITY_SCHEMAS`/`STORES`.

**Bewusst keine Pflicht-Verknüpfung mit dem bestehenden `Competition`-Store:**
Kampfrichter:innen amtieren typischerweise nicht nur bei Wettkämpfen des
eigenen Vereins, sondern bei Wettkämpfen anderer Vereine im Kreis-/
Landesverband — diese existieren in aller Regel **nicht** als
`Competition`-Datensatz in diesem System (der andere Verein nutzt dieses
System evtl. gar nicht, oder das eigene Vereins-`Competition`-Modell kennt
fremde Wettkämpfe grundsätzlich nicht, siehe `CompetitionSchema.clubId`).
Eine Pflicht-Verknüpfung hätte entweder erzwungen, jeden fremden Wettkampf
zusätzlich als vereinsfremden `Competition`-Datensatz nachzupflegen (Bruch
der Mandantentrennung), oder Wettkampfeinsätze künstlich auf
vereinseigene Wettkämpfe beschränkt — beides bildet die Realität nicht ab.
**Lösung:** freie Texteingabe für den Wettkampf (Name, Ort, Datum,
ausrichtender Verein als Freitext) plus **optionaler** Verweis auf einen
vereinseigenen `Competition`-Datensatz, falls es sich um einen eigenen
Wettkampf handelt (spart dann Doppelerfassung von Name/Datum/Ort).

### 5.2 Prisma (`apps/api/prisma/schema.prisma`)

```prisma
// Erfasster Einsatz einer Kampfrichter:in bei einem Wettkampf (eigenem
// oder fremdem, siehe Abschnitt 5.1 des Kampfrichter-Modul-Plans).
// onDelete: Cascade analog UserQualification — ein gelöschtes Konto
// braucht keine eigenständig fortbestehende Einsatzhistorie mehr.
model RefereeAssignment {
  id              String       @id @default(uuid())
  userId          String
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Verein, dem die Kampfrichter:in zum Erfassungszeitpunkt angehört —
  // Scoping für die Admin-Übersicht (Abschnitt 4.2), NICHT zwingend der
  // ausrichtende Verein des Wettkampfs (siehe Freitextfelder unten).
  clubId          String
  club            Club         @relation(fields: [clubId], references: [id])
  // Freitext, da der Wettkampf oft nicht als eigener Competition-Datensatz
  // existiert (Abschnitt 5.1).
  competitionName String
  competitionPlace String      @default("")
  // Optionaler Verweis auf einen vereinseigenen Wettkampf-Datensatz —
  // onDelete: SetNull, damit ein gelöschter Competition-Datensatz nicht
  // die Einsatzhistorie mitreißt (die Historie soll auch nach Löschung des
  // Wettkampf-Datensatzes bestehen bleiben, sie ist dann nur wieder ein
  // reiner Freitext-Eintrag).
  competitionId   String?
  competition     Competition? @relation(fields: [competitionId], references: [id], onDelete: SetNull)
  date            DateTime
  // RefereeFunctionSchema-Wert (Abschnitt 5.3) — kein Fremdschlüssel,
  // analog UserQualification.type (Abschnitt 2.2 des Qualifikationsplans).
  function        String
  note            String       @default("")
  // Gesetzt, wenn der Eintrag über den admin-Schreibpfad (Abschnitt 5.5)
  // statt von der Kampfrichter:in selbst angelegt/zuletzt geändert wurde —
  // reines Audit-Feld für die Anzeige („von {name} erfasst"), keine
  // Berechtigungsprüfung hängt daran. onDelete: SetNull, damit ein
  // gelöschtes Admin-Konto nicht die Einsatzhistorie der Kampfrichter:in
  // mitreißt (der Eintrag bleibt bestehen, nur die Zuordnung „von wem"
  // geht verloren — analog Invitation.invitedById).
  createdByAdminId String?
  createdByAdmin  User?        @relation("RefereeAssignmentCreatedByAdmin", fields: [createdByAdminId], references: [id], onDelete: SetNull)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  deletedAt       DateTime?

  @@index([userId, deletedAt])
  @@index([clubId, date])
  @@map("referee_assignments")
}
```

Ergänzung in `model User`: `refereeAssignments RefereeAssignment[]`
(Relation über `userId`) sowie `refereeAssignmentsCreatedAsAdmin
RefereeAssignment[] @relation("RefereeAssignmentCreatedByAdmin")` (Gegenstück
zu `createdByAdminId` — zwei getrennte Relationsnamen nötig, da `User` hier
zweimal auf `RefereeAssignment` verweist); in `model Club`:
`refereeAssignments RefereeAssignment[]`; in `model Competition`:
`refereeAssignments RefereeAssignment[]`.

### 5.3 Funktion beim Wettkampf — feste Werteliste

```ts
export const RefereeFunctionSchema = z.enum([
  'kampfrichter',
  'schiedsrichter',
  'startrichter',
  'zeitnehmer',
  'bahnrichter',
  'wettkampfsekretaer',
  'sonstige',
]);
```

Bewusst eine **eigene** Liste, getrennt von `QualificationTypeSchema`
(Abschnitt 3.1), auch wenn beide inhaltlich ähnliche Begriffe verwenden: eine
Qualifikation ist ein Befähigungsnachweis („darf die Funktion X ausüben"),
ein Einsatz ist ein tatsächlich ausgeübter Termin („hat die Funktion X am
Datum Y ausgeübt") — jemand kann z. B. als `schiedsrichter` qualifiziert sein,
an einem konkreten Wettkampf aber nur als `zeitnehmer` eingesetzt worden sein.
Eine gemeinsame Enum-Definition würde diese fachliche Unabhängigkeit
verschleiern; die Werte dürfen unabhängig voneinander weiterentwickelt werden.

### 5.4 Zod-Schema

```ts
export const RefereeAssignmentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  competitionName: z.string().min(1).max(200),
  competitionPlace: z.string().max(300).default(''),
  competitionId: z.string().uuid().nullable(),
  date: isoDate,
  function: RefereeFunctionSchema,
  note: z.string().max(500).default(''),
  createdByAdminId: z.string().uuid().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type RefereeAssignment = z.infer<typeof RefereeAssignmentSchema>;
```

Bewusst **nicht** Teil von `ENTITY_SCHEMAS` (siehe 5.1).

### 5.5 REST-Endpunkte — eigenes Backend-Modul `apps/api/src/modules/referees/`

Struktur analog `apps/api/src/modules/qualifications/`
(`referees.repository[.memory].ts`, `referees.service.ts`,
`referees.route.ts`), inkl. desselben Modul-Gate-Cache-Musters
(`resolveEnabledModules()`/`clubModulesCache`, siehe Abschnitt 1.2 des
Qualifikationsplans) für `'kampfrichter'` statt `'qualifications'`.

| Methode & Pfad | Zweck | Berechtigung |
|---|---|---|
| `GET /api/me/referee-assignments` | Eigene Einsatzliste | `referee` |
| `POST /api/me/referee-assignments` | Eigenen Einsatz anlegen | `referee` |
| `PATCH /api/me/referee-assignments/:id` | Eigenen Einsatz bearbeiten | `referee` |
| `DELETE /api/me/referee-assignments/:id` | Eigenen Einsatz löschen (Soft-Delete) | `referee` |
| `GET /api/users/:userId/referee-assignments` | Einsatzliste einer beliebigen Kampfrichter:in im eigenen Verein | `admin` |
| `POST /api/users/:userId/referee-assignments` | Einsatz **im Namen von** `:userId` anlegen | `admin` |
| `PATCH /api/users/:userId/referee-assignments/:id` | Beliebigen Einsatz von `:userId` bearbeiten | `admin` |
| `DELETE /api/users/:userId/referee-assignments/:id` | Beliebigen Einsatz von `:userId` löschen (Soft-Delete) | `admin` |

**Selbstverwaltung UND Admin-Schreibzugriff (Entscheidung 2026-09-05,
abweichend vom ursprünglichen Entwurf dieses Plans):** Anders als bei
Qualifikationen (dort ausschließlich `admin`-Schreibzugriff, Entscheidung 2
des Qualifikationsplans) verwaltet die Kampfrichter:in ihre eigenen Einsätze
primär **selbst** — niemand kann die eigene Teilnahme zuverlässiger
protokollieren. Zusätzlich darf `admin` im eigenen Verein Einsätze **im
Namen einer Kampfrichter:in** anlegen/bearbeiten/löschen (z. B. vergessene
Einträge vor einer Verbandsmeldung nacherfassen). Jeder admin-seitig
angelegte oder zuletzt bearbeitete Eintrag setzt `createdByAdminId` auf die
ID der handelnden Admin-Person (Abschnitt 5.2/5.4) — rein informativ in der
UI („von {Admin-Name} erfasst"), keine Zugriffsbeschränkung: die
Kampfrichter:in kann einen so entstandenen Eintrag danach genauso über
`/api/me/referee-assignments/:id` weiter bearbeiten wie einen selbst
angelegten (`createdByAdminId` bleibt dabei unverändert stehen — reines
Herkunfts-Audit, kein „Gesperrt für Selbstbearbeitung"-Flag).

`clubId`-Prüfung wie bei den Qualifikationsendpunkten: Ziel-`User` von
`:userId`-Routen muss im selben Verein sein wie die anfragende Person.
`competitionId` (falls gesetzt) muss — sofern vorhanden — zum `clubId` der
anfragenden Person gehören (keine Verknüpfung mit fremden
`Competition`-Datensätzen).

### 5.6 Kein Erinnerungsjob nötig

Anders als Qualifikationen (Abschnitt 5 des Qualifikationsplans) haben
Wettkampfeinsätze kein Ablaufdatum — sie sind ein Verlaufsprotokoll, keine
befristete Berechtigung. Kein neuer Cron-Job erforderlich.

### 5.7 DSGVO

- **Auskunft:** `GET /api/me/export` (`auth.service.ts`) um
  `RefereeAssignment`-Zeilen der anfragenden Person ergänzen (analog zur in
  Abschnitt 6 des Qualifikationsplans vorgesehenen Ergänzung um
  `UserQualification`).
- **Löschung:** `onDelete: Cascade` auf `RefereeAssignment.userId` reicht,
  der bestehende Hard-Purge-Job (`purgeExpiredDeletions.ts`) räumt die
  Zeilen automatisch mit ab.

### 5.8 Tests

- Zod-Schema: Grenzfälle (`function` außerhalb der Werteliste,
  `competitionName` leer).
- Repository: In-Memory-Variante analog `qualifications.repository.memory.ts`.
- Route: `referee` kann eigene Einsätze anlegen/bearbeiten/löschen, **nicht**
  die einer anderen Person (auch nicht im eigenen Verein) — Schreibversuch
  über `/api/users/:userId/...` mit `userId !== eigene ID` und Rolle
  `referee` (ohne `admin`) → `403`; `admin` kann sowohl lesen als auch im
  Namen jeder Kampfrichter:in des eigenen Vereins schreiben (nicht eines
  fremden Vereins → `403`), gesetztes `createdByAdminId` nach admin-seitigem
  Anlegen, unverändert nach nachfolgender Selbstbearbeitung durch die
  Kampfrichter:in; Modul-Gate `403`, wenn `kampfrichter` nicht gebucht ist;
  `competitionId` aus fremdem Verein wird abgelehnt.

---

## 6. Entscheidungen

Ursprünglich als offene Fragen formuliert (analog zum Stil in Abschnitt 8 des
Qualifikationsplans); die folgenden Entscheidungen wurden am 2026-09-05
getroffen und oben in den jeweiligen Abschnitten bereits eingearbeitet:

1. **Bezeichnungen/Stufung der Kampfrichter-Qualifikationstypen**
   (Abschnitt 3.1). **Entscheidung:** DSV-Standardbegriffe, flache Liste ohne
   C/B/A-Stufung (`kampfrichter`, `schiedsrichter`, `startrichter`,
   `zeitnehmer`, `bahnrichter`, `wettkampfsekretaer`) — im
   DSV-Kampfrichterwesen gibt es je Amt eine Lizenz, kein Stufensystem wie
   bei Trainerscheinen. Landesverbandsspezifische Abweichungen bleiben
   unkritisch (String-Key, siehe 3.1).
2. **Admin-Schreibzugriff auf fremde Wettkampfeinsätze** (Abschnitt 5.5).
   **Entscheidung:** Ja — zusätzlich zur Selbstverwaltung durch die
   Kampfrichter:in darf `admin` im eigenen Verein Einsätze im Namen einer
   Kampfrichter:in anlegen/bearbeiten/löschen (z. B. Nacherfassung vor einer
   Verbandsmeldung), mit `createdByAdminId` als reinem Herkunfts-Audit-Feld
   (Abschnitt 5.2/5.4/5.5).
3. **Reporting-Export** (z. B. „Kampfrichter-Einsatzstatistik" als PDF/CSV
   für die jährliche Landesverbandsmeldung). **Entscheidung:** Nicht Teil
   dieses Plans — der `admin`-Leseendpunkt aus Abschnitt 5.5 liefert die
   Rohdaten bereits; ein Export bleibt eine spätere, eigenständige
   Erweiterung, um den Umfang hier nicht vorzeitig aufzublähen.
4. **Bestandsvereine beim Rollout.** **Entscheidung:** `kampfrichter` wird
   bestehenden Vereinen automatisch zugebucht (siehe Migrationsschritt in
   Abschnitt 7, Phase C) — analog zum Standardverhalten neuer Vereine
   (`enabledModules: input.enabledModules ?? [...MODULE_KEYS]`, siehe
   Abschnitt 1.2 des Qualifikationsplans). Ein Superadmin kann das Modul
   danach je Verein über die bestehende Checkbox-Liste in `clubForm.js`
   wieder deaktivieren, falls ein Verein keine Kampfrichter:innen hat.

### Verbleibender offener Punkt

- **Rollen-Umschalter als spätere UX-Verbesserung:** Abschnitt 1.6
  entscheidet sich bewusst gegen einen Rollen-Switcher, da „gleichzeitig
  wahrnehmen" die Vereinigung aller Module verlangt. Bei sehr vielen
  Rollen/Modulen pro Person könnte die Navigation dadurch überladen wirken;
  eine optionale visuelle Gruppierung nach Rolle in der Navigation (nicht
  Ausblendung) wäre eine spätere, rein gestalterische Ergänzung, nicht Teil
  dieses Plans — bislang nicht zur Abstimmung gestellt.

---

## 7. Umsetzungsschritte

**Phase A — Mehrfachrollen (Voraussetzung, Abschnitt 1): ✅ umgesetzt
(2026-09-05)**
1. ✅ Prisma: `User.roles String[]` ergänzt (Migration
   `20260905120000_add_user_roles_array`, inkl. Backfill `roles = [role]`
   für Bestandszeilen), `role`-Spalte bleibt bewusst bestehen
   (Übergangsphase) und wird von `PrismaUserRepository` weiterhin als
   `roles[0]` mitgepflegt.
2. ✅ `UserRolesSchema`, `AccessTokenClaimsSchema.roles`,
   `requireAnyRole()` (Backend), `getRoles()`/`hasRole()`/
   `isAthleteScoped()`, `isModuleVisible()`/`visibleModules()` (Frontend)
   umgestellt — inkl. aller Aufrufstellen in `auth`/`invitations`/
   `qualifications`/`sync`-Modulen sowie `shell.js`/`sessions.js`/
   `dashboard.js`/`actionItems.js`.
3. ✅ `PATCH /api/users/:userId/roles` (admin, eigener Verein) inkl.
   „letzter Admin"-Schutz (`LastAdminError`, 409),
   `CannotAssignSuperadminError` (400) und `revokeAllForUser()`;
   `userManagement.js`-Dialog (`openManageRolesModal()`) dafür, inkl.
   Rollen-Badges je Mitglied.
4. ✅ Sync-Regressionen: `isAthleteScoped()` in `sync.permissions.ts`
   greift nur, wenn keine Staff-Rolle vorhanden ist (nicht nur bei
   „ausschließlich athlete") — deckt sowohl `['trainer','athlete']`
   (weiterhin voller Zugriff) als auch künftige Nicht-Staff-Rollen ab.
5. ⏳ `role`-Spalte nach Übergangszeit entfernen — bewusst noch NICHT Teil
   dieser Umsetzung (separate, spätere Contract-Migration, siehe
   Abschnitt 1.3).

**Phase B — Rolle & Qualifikationen:**
6. `'referee'` in `RoleSchema`/`InvitationRoleSchema`;
   `ClubMemberCountsSchema` + Zähllogik anpassen (Abschnitt 2).
7. `QualificationTypeSchema` um Kampfrichter-Typen erweitern, i18n-Labels
   ergänzen (Abschnitt 3.1); `REFEREE_QUALIFICATION_TYPES`-Konstante.

**Phase C — Kampfrichter-Modul & Wettkampfeinsätze:**
8. `MODULE_PACKAGES.kampfrichter` + `ROUTE_TO_PACKAGE`-Eintrag
   (Abschnitt 4.1) **plus** Datenmigration, die `'kampfrichter'` in
   `Club.enabledModules` für jeden bestehenden Verein ergänzt, der es noch
   nicht enthält (Entscheidung 4, Abschnitt 6 — automatisches Rollout statt
   manueller Superadmin-Aktivierung; einmaliges Skript analog dem Backfill
   aus Phase A, Schritt 1, kein Rückwärts-Feature-Flag nötig, da ein
   Superadmin das Modul danach jederzeit über `clubForm.js` wieder
   deaktivieren kann).
9. Prisma-Modell `RefereeAssignment` inkl. `createdByAdminId` + Migration
   (Abschnitt 5.2).
10. `RefereeFunctionSchema`/`RefereeAssignmentSchema` in `shared-types`
    (Abschnitt 5.3/5.4).
11. Backend-Modul `apps/api/src/modules/referees/` inkl. Selbstverwaltungs-
    UND Admin-Schreibpfad (Abschnitt 5.5).
12. `GET /api/me/export` um `RefereeAssignment` ergänzen (Abschnitt 5.7).
13. Frontend-Modul `apps/web/js/modules/kampfrichter.js` (Abschnitt 4.2,
    inkl. admin-seitigem „im Namen von"-Formular) + Registrierung in
    `router.js`.
14. i18n-Keys ergänzen (Abschnitt 4.3).
15. Tests je Schicht (Abschnitt 1.7, 5.8).
16. `docs/backend-plan.md` Abschnitt „6 — Erweiterungen" um den
    Umsetzungsstand ergänzen, sobald begonnen wird.
