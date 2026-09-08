# Plan: Trainingsplanung — Phase 1 (Abschnitt 3 des Feature-Brainstorms)

Detaillierter Umsetzungsplan für Phase 1 aus
`docs/future-features-brainstorm.md` (Abschnitt „Priorisierung:
Phasenplanung"): Abschnitt 3, bestehend aus drei Einzelfeatures —
3.1 Wiederkehrende Trainingspläne/Vorlagen-Zyklen, 3.2
Belastungssteuerung/Trainingsumfang-Auswertung, 3.3
Anwesenheitsstatistik & -prognose. Anders als das Brainstorm-Dokument ist
dies ein konkreter Umsetzungsplan (analog zu
`docs/kampfrichter-modul-plan.md`/`docs/nutzer-qualifikationen-plan.md`),
noch vor jeder Implementierung als Diskussionsgrundlage gedacht.

## Umsetzungsstand

| Teil | Status |
|---|---|
| 3.1 Wiederkehrende Trainingspläne/Vorlagen-Zyklen | offen |
| 3.2 Belastungssteuerung/Trainingsumfang-Auswertung | **umgesetzt** — siehe Abschnitt 2.5 |
| 3.3 Anwesenheitsstatistik & -prognose | **umgesetzt** — siehe Abschnitt 3.4 |

## 0. Ausgangslage

Bevor neue Modelle entworfen werden, was bereits vorhanden ist und wofür
sich Phase 1 darauf stützt:

- **`Template`** (`sets: Json`) und **`Plan`** (`weekStart`, `groupId`,
  `status`, `days: Json` — je Tag `{ date, sets }`) existieren bereits;
  `sets` folgt in beiden derselben `SetEntrySchema`-Struktur (`PlainSet` /
  `RepeatBlock` / `Section`, siehe `packages/shared-types/src/entities.ts`).
- **`TrainingSession`** (`date`, `groupId`, `planId`, `attendance: Json`)
  trägt pro Athlet:in bereits `{ athleteId, present, rpe, note }` —
  **RPE-Erfassung existiert also bereits** (`AttendanceRecordSchema.rpe`,
  1–10, nullable) inklusive UI (`sessions.js`) und einem ersten
  Team-Trend-Chart (`stats.js`: „Empfundene Belastung (Ø RPE je
  Einheit)"). Phase 1 muss RPE also nicht neu einführen, nur die
  Auswertung (3.2) darauf aufbauen und erweitern.
- **`setEditor.js: totalDistance(items)`** berechnet bereits rekursiv die
  Gesamtdistanz einer Sets-/Blöcke-/Abschnitte-Liste (Summe aus
  `distance × reps`, inkl. `RepeatBlock.repeatCount` und Rekursion durch
  `Section`); `plans.js` nutzt das schon für die Meter-Anzeige je
  Plan-Karte (`p.days.reduce((sum, d) => sum + totalDistance(d.sets), 0)`).
  Für 3.2 lässt sich dieselbe Funktion wiederverwenden statt einer neuen
  Distanzberechnung.
- **Snapshot- statt Referenz-Semantik ist bereits das etablierte Muster:**
  `plans.js: openPlanModal()` übernimmt beim „Vorlage anwenden" bereits
  `cloneItems(tpl.sets)` — eine spätere Änderung an der Vorlage wirkt sich
  NICHT rückwirkend auf bereits erzeugte Plan-Tage aus. Für 3.1 (Zyklen)
  wird genau dasselbe Muster übernommen.
- **`plans`, `sessions`, `stats` sind bereits bestehende, togglebare
  Module** (`router.js: ROUTE_TO_PACKAGE`), keine neuen zubuchbaren
  Pakete. 3.1–3.3 erweitern diese drei bestehenden Module — es entsteht
  in Phase 1 **kein** neues Paket in `packages/shared-types/src/modules.ts`.

## 1. Abschnitt 3.1 — Wiederkehrende Trainingspläne / Vorlagen-Zyklen

### 1.1 Konzept

Ein **Zyklus** (`PlanCycle`) ist eine Vorlage für eine *Abfolge von
Wochen* — das, was `Template` für eine einzelne Übungsserie und `Plan`
für eine einzelne Woche bereits ist, aber eine Ebene darüber. Jede
Zyklus-Woche ordnet bestimmten Wochentagen ein `Template` zu. „Zyklus
anwenden" erzeugt daraus konkrete `Plan`-Datensätze — einen pro
Zyklus-Woche, mit Tages-Snapshots nach demselben Muster wie die
bestehende „Vorlage anwenden"-Funktion.

**Beispiel:** Ein 4-Wochen-Aufbauzyklus zur Wettkampfvorbereitung: Woche
1–2 „Grundlagenausdauer" (Mo/Mi/Fr → Vorlage A), Woche 3 „Intensiv"
(Mo/Mi/Fr → Vorlage B), Woche 4 „Taper" (nur Mo/Mi → Vorlage C, reduzierter
Umfang). Trainer:in wählt den Zyklus einmal, gibt ein Startdatum an — die
App legt automatisch vier `Plan`-Einträge mit korrekt versetztem
`weekStart` an, alle bereits mit den richtigen Tages-Sets befüllt.

### 1.2 Datenmodell

**Prisma (`apps/api/prisma/schema.prisma`):**

**Entscheidung: `PlanCycle` ist NICHT gruppengebunden** — analog zu
`Template`, das ebenfalls keine `groupId` trägt und beliebig über Gruppen
hinweg wiederverwendbar ist (Begründung siehe Abschnitt 7). Die Zielgruppe
wird stattdessen bei jedem „Anwenden" explizit abgefragt (siehe 1.4).

```prisma
model PlanCycle {
  id          String    @id @default(uuid())
  clubId      String
  club        Club      @relation(fields: [clubId], references: [id])
  name        String
  description String    @default("")
  // Array von Wochen: [{ weekOffset, label, days: [{ dayOfWeek, templateId }] }]
  // — siehe CycleWeekSchema unten. weekOffset ist bewusst redundant zum
  // Array-Index (0-basiert), damit sich einzelne Wochen ohne Reindizierung
  // der übrigen Einträge einfügen/entfernen lassen.
  weeks       Json
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  // [clubId, updatedAt] statt [clubId] — Begründung wie bei den übrigen
  // Sync-Stores (Group, Template, Plan, …): bedient den Sync-Pull-Zugriff
  // (sync.gateway.ts: listChangedSince()) direkt ohne zusätzlichen Sortierschritt.
  @@index([clubId, updatedAt])
  @@map("plan_cycles")
}
```

**Zod (`packages/shared-types/src/entities.ts`)** — Wochentag-Zählung
analog zu `dates.js: startOfWeek()` (Montag = 0):

```ts
export const CycleDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Montag … 6 = Sonntag
  templateId: z.string().uuid(),
}).strict();
export type CycleDay = z.infer<typeof CycleDaySchema>;

export const CycleWeekSchema = z.object({
  weekOffset: z.number().int().min(0).max(51),
  label: z.string().max(200).default(''),
  days: z.array(CycleDaySchema).max(7),
}).strict();
export type CycleWeek = z.infer<typeof CycleWeekSchema>;

export const PlanCycleSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  weeks: z.array(CycleWeekSchema).max(52), // Obergrenze analog Plan.days (max 60)
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type PlanCycle = z.infer<typeof PlanCycleSchema>;
```

Registry-Eintrag `ENTITY_SCHEMAS.planCycles = PlanCycleSchema` (11. Store
neben den bisherigen zehn); `ENTITY_STORE_NAMES` erweitert sich dadurch
automatisch (wird aus den Schlüsseln von `ENTITY_SCHEMAS` abgeleitet, wie
im entityRegistry.ts-Kommentar beschrieben).

**Backend `entityRegistry.ts`:** neuer `case 'planCycles': return
prisma.planCycle;` — der bewusst `never`-exhaustive `switch` in
`getEntityDelegate()` erzwingt das ohnehin (TypeScript-Fehler ohne diesen
Fall).

**Frontend `db.js`:** neuer Eintrag in `STORES` und in
`CLUB_SCOPED_STORES` (analog `templates`/`plans`).

Bewusst **kein** eigener REST-Endpunkt für „Zyklus anwenden" — das
Erzeugen der `Plan`-Datensätze passiert rein client-seitig über die
bestehende `put()`-Funktion (genau wie das manuelle Anlegen mehrerer
Pläne); die generische Sync-Push-API überträgt sie wie jeden anderen
Plan.

### 1.3 Workflow „Zyklus erstellen"

1. Trainer:in/Admin öffnet neuen Bereich „Zyklen" (siehe 1.5) → „Neuer
   Zyklus".
2. Name, Beschreibung — bewusst KEINE Gruppenauswahl an dieser Stelle
   (siehe Entscheidung in Abschnitt 7): ein Zyklus ist gruppenunabhängig
   und wiederverwendbar.
3. Wochen hinzufügen: je Woche ein Label (z. B. „Woche 1 —
   Grundlagenausdauer") sowie für jeden gewünschten Wochentag eine
   Vorlagen-Auswahl (`selectInput` über die bestehenden `templates`,
   exakt das UI-Muster, das `openPlanModal()` in `plans.js` heute schon
   für die Tages-Vorlagenauswahl verwendet — Wiederverwendung statt
   Neubau).
4. Wochen lassen sich duplizieren (z. B. „Woche 1" für „Woche 2"
   übernehmen und nur einzelne Tage austauschen) — reine Client-Logik
   (Deep-Copy des Wochen-Objekts mit neuem `weekOffset`).
5. Speichern → `PlanCycle` wird per `put()` angelegt/aktualisiert, landet
   in der normalen Sync-Warteschlange.

### 1.4 Workflow „Zyklus anwenden"

1. In der Zyklus-Detailansicht: Button „Anwenden".
2. Modal: Startdatum wählen (ein `dateInput`, wird intern auf
   `startOfWeek()` normalisiert — konsistent mit `Plan.weekStart`, das
   ebenfalls immer ein Wochenanfang ist) sowie **verpflichtend** eine
   Zielgruppe (`selectInput`, keine Vorbelegung) — derselbe Pflichtschritt,
   den auch das manuelle Anlegen eines einzelnen `Plan` heute schon verlangt
   (`Plan.groupId`), hier nur einmal für alle N erzeugten Pläne des Zyklus
   statt je Plan einzeln.
3. Bestätigung → für jede `CycleWeek` in `weeks`:
   - `weekStart = isoAddDays(startDate, weekOffset * 7)`
   - für jeden `CycleDay`: `date = isoAddDays(weekStart, dayOfWeek)`,
     `sets = cloneItems(template.sets)` (identische Funktion wie
     bei „Vorlage anwenden" heute)
   - ein neuer `Plan`-Datensatz mit `name` (z. B. `"${cycle.name} —
     ${week.label || 'Woche ' + (i+1)}"`), `status: 'aktiv'`, der im
     Modal gewählten `groupId`, den erzeugten `days`.
4. Alle N Pläne werden per `put()` angelegt (Batch, aber kein neuer
   Endpunkt — dieselbe Sync-Push-API wie beim manuellen Einzelanlegen,
   nur mehrfach hintereinander aufgerufen).
5. Erfolgsmeldung mit Link zur Plan-Liste (gefiltert/hervorgehoben auf die
   neu erzeugten Pläne).

**Bewusst KEINE Rückverknüpfung `Plan.cycleId`** in Phase 1: ein erzeugter
`Plan` ist danach ein ganz normaler, unabhängiger Plan (editierbar,
löschbar, archivierbar wie jeder andere) — der Zyklus ist reine
*Erzeugungslogik*, keine dauerhafte Datenbeziehung. Das vermeidet
Kaskadenfragen („was passiert mit den Plänen, wenn der Zyklus gelöscht
wird?") komplett, konsistent mit dem bereits etablierten
Snapshot-Prinzip.

### 1.5 UI-Verortung

Neuer Tab/Reiter „Zyklen" innerhalb des bestehenden `plans`-Moduls
(analog dazu, wie `templates` und `catalog` bereits getrennte, aber
thematisch verwandte Module sind) — Rollen wie `plansModule`: `['trainer',
'admin', 'athlete']`, wobei Athlet:innen nur lesend auf die Zyklus-Liste
zugreifen (Erstellen/Anwenden ausschließlich `trainer`/`admin`, analog zu
`templates`).

### 1.6 Migration & Tests

- Neue Prisma-Migration: `npm run prisma:migrate -- --name add_plan_cycle`.
- `packages/shared-types`: `PlanCycleSchema`-Validierungstests (gültige/
  ungültige Payloads, analog bestehender `TemplateSchema`-Tests) sowie
  Registry-Vollständigkeit (`ENTITY_SCHEMAS` enthält `planCycles`).
- `apps/api`: `entityRegistry.test.ts` deckt `planCycles` automatisch mit
  ab (iteriert über `ENTITY_STORE_NAMES`); Autorisierungs-/Scoping-Tests
  für den neuen Sync-Store analog zu `templates`/`plans` (Vereins-Scoping
  beim Push/Pull).
- `apps/web`: Unit-Test für die „Zyklus anwenden"-Funktion als reine
  Funktion (`weeks + startDate + templates → Plan[]`), unabhängig vom
  DOM testbar, analog zum Trennungsprinzip bei `buildDemoData()`.

## 2. Abschnitt 3.2 — Belastungssteuerung / Trainingsumfang-Auswertung

### 2.1 Was schon da ist, was fehlt

Vorhanden: RPE-Erfassung je Athlet:in/Einheit (`AttendanceRecord.rpe`)
und ein einfacher Team-Durchschnitts-Trend in `stats.js`. **Fehlend:**

- RPE-Trend **je einzelner Athlet:in** (bisher nur Team-Durchschnitt).
- **Trainingsumfang** (Streckenmeter) überhaupt als zeitliche Auswertung
  — bisher zeigt `plans.js` nur die Gesamtmeter *eines* Plans, keine
  Aggregation über mehrere Wochen/Athlet:innen hinweg.
- Verknüpfung von „geplantem Umfang" (Plan-Meter) mit „wer war
  tatsächlich anwesend" — bisher zwei getrennte Datenquellen
  (`Plan.days` vs. `TrainingSession.attendance`).

### 2.2 Datenmodell

**Kein neues Pflichtfeld nötig** für die Kernauswertung — die
Wochenkilometer-Berechnung ist eine **reine Aggregationsfunktion** über
bereits vorhandene, synchronisierte Daten:

```
für jede TrainingSession s mit s.planId != null:
  plan = plans.find(p => p.id === s.planId)
  day  = plan?.days.find(d => dateOnly(d.date) === dateOnly(s.date))
  volumeOfSession = day ? totalDistance(day.sets) : null
  für jeden AttendanceRecord a in s.attendance mit a.present === true:
    athleteVolume[a.athleteId] += volumeOfSession ?? 0
```

**Entscheidung (siehe Abschnitt 7): `actualDistance` wird in Phase 1
aufgenommen**, für den Fall, dass eine Einheit *ohne* verknüpften Plan
stattfand (Ad-hoc-Training) oder tatsächlich abweichend vom geplanten
Umfang absolviert wurde:

```prisma
model TrainingSession {
  // … bestehende Felder unverändert …
  // Manuelle Distanzangabe — NUR relevant, wenn planId null ist (Ad-hoc-
  // Einheit ohne Vorlage) ODER der tatsächliche Umfang bewusst vom
  // verknüpften Plan-Tag abweicht (z. B. Einheit abgebrochen). null
  // bedeutet "aus dem verknüpften Plan-Tag berechnen" (Standardfall).
  actualDistance Int?
}
```

Zod-Erweiterung: `TrainingSessionSchema` bekommt
`actualDistance: z.number().int().nonnegative().nullable().default(null)`.
Migration ist rein additiv (`ALTER TABLE "sessions" ADD COLUMN
"actualDistance" INTEGER` — camelCase, wie in dieser Codebasis für
Spaltennamen üblich, siehe z. B. `nationalID`/`nationalIDType`), kein
Backfill nötig — bestehende Zeilen bekommen `null` (= „aus Plan
berechnen", unverändertes Verhalten).

Aggregationslogik damit: `volumeOfSession = s.actualDistance ??
(day ? totalDistance(day.sets) : null)`.

**UI:** `sessions.js: openSessionModal()` erlaubt bereits heute
`planId: null` als Standardfall für neu angelegte Einheiten (Ad-hoc-Training
ohne Vorlage ist also bereits ein regulär unterstützter, kein
hypothetischer Fall) — das neue `actualDistance`-Feld (`numberInput`,
Meter) erscheint im selben Modal, **nur sichtbar, wenn kein `planId`
gewählt ist** (bei verknüpftem Plan bleibt die automatische Berechnung
aus `day.sets` der Standardfall, ohne Zusatzeingabe).

### 2.3 Workflow / UI

Neuer Abschnitt „Trainingsumfang" in `stats.js` (Rollen unverändert
`['trainer', 'admin']`, wie das bestehende Modul):

1. **Wochenkilometer-Chart je Gruppe** (`svgBarChart`, wiederverwendet):
   x-Achse = Kalenderwoche (`startOfWeek(session.date)`), y-Achse = Summe
   `athleteVolume` aller Athlet:innen der Gruppe / Anzahl anwesender
   Athlet:innen (= durchschnittlicher Umfang pro Kopf, damit
   Gruppengröße nicht verzerrt).
2. **RPE-Trend je Athlet:in** (Erweiterung des bestehenden
   `rpeCard`-Bereichs um eine Athlet:innen-Auswahl — `selectInput`
   analog zu den bereits vorhandenen Filtern in `stats.js`): derselbe
   `svgLineChart` wie heute, nur gefiltert auf eine `athleteId` statt
   Team-Durchschnitt.
3. **Kombinierte Ansicht** „Umfang vs. RPE" pro Athlet:in — zwei
   Linien im selben Chart (Volumen und RPE je Woche), macht sichtbar,
   wenn RPE bei gleichbleibendem/steigendem Umfang selbst ansteigt
   (einfacher, rein visueller Hinweis auf Übertrainingsrisiko — **kein**
   automatisierter Alarm in Phase 1, das wäre eine spätere Ausbaustufe).

### 2.4 Tests

Reine Funktionen (`computeWeeklyVolume(sessions, plans)`,
`athleteRpeTrend(sessions, athleteId)`) — unabhängig vom DOM in Vitest
testbar, analog zum bestehenden Trennungsprinzip zwischen reiner
Aggregationslogik und Rendering in `stats.js`.

### 2.5 Umsetzungsstand: **umgesetzt**

- `apps/api/prisma/schema.prisma` / neue Migration
  `20260908090000_add_session_actual_distance` — `TrainingSession.
  actualDistance Int?`. **Nicht gegen eine echte Postgres-Instanz
  geprüft** (kein Docker-Zugriff in dieser Sandbox, analog zum bereits
  bekannten Vorbehalt bei der Qualifikationen-Migration, siehe
  `docs/todo.md`) — vor dem ersten Produktiv-Deployment `npx prisma
  migrate deploy` gegen eine echte Datenbank verifizieren.
- `packages/shared-types/src/entities.ts` — `TrainingSessionSchema`
  bekommt `actualDistance` (nonnegative Int, nullable, Default `null`);
  da kein Pflichtfeld, bleiben alle Alt-Datensätze ohne dieses Feld
  gültig. Kein neuer REST-Endpunkt, keine neue Konfliktlogik nötig — der
  Wert fließt automatisch über den bestehenden generischen Sync-Pfad
  (`delegate.create({ data: payload })` in `sync.gateway.ts`), wie im
  Plan vorgesehen.
- `apps/api/src/modules/sync/sync.athleteScope.ts` — **keine Änderung
  nötig**: die athletenseitige Redaktion von `sessions`-Payloads spread
  bereits das gesamte Payload durch (nur `trainerNote`/`attendance`
  werden gezielt überschrieben), `actualDistance` bleibt also automatisch
  sichtbar — mit einem Regressionstest abgesichert
  (`apps/api/test/sync/sync.service.test.ts`).
- `apps/web/js/modules/trainingLoad.js` — die reinen Funktionen
  `computeWeeklyVolume()`, `athleteWeeklyVolume()` (zusätzlich zur
  ursprünglichen Planung, für die kombinierte Ansicht benötigt) und
  `athleteRpeTrend()`.
- `apps/web/js/modules/stats.js` — drei neue/erweiterte Karten:
  „Trainingsumfang je Gruppe" (Gruppenauswahl + Balkendiagramm, m pro
  Kopf), die bestehende RPE-Karte um eine optionale Athlet:innen-Auswahl
  erweitert (leer = Team-Durchschnitt wie bisher), sowie „Umfang vs.
  RPE" pro Athlet:in.
  - **Abweichung von der ursprünglichen Planung:** die „Kombinierte
    Ansicht" (Abschnitt 2.3, Punkt 3) ist als zwei untereinander
    angeordnete Liniendiagramme umgesetzt (Umfang, RPE), nicht als ein
    einzelnes Diagramm mit zwei Linien/Achsen — `charts.js: svgLineChart()`
    unterstützt nur eine Datenreihe pro Aufruf; eine Mehrserien-/
    Dual-Achsen-Erweiterung der gemeinsam genutzten Chart-Grundfunktion
    wäre ein Eingriff mit Tragweite für alle bestehenden Aufrufer, für
    diese eine Ansicht nicht gerechtfertigt.
  - Die alte „Training volume"-Karte (Wettkampfzeiten pro Monat) bleibt
    unverändert bestehen — ihr Name im Code-Kommentar war irreführend
    (klang nach Trainingsumfang, zeigt aber Wettkampfaktivität); der
    Kommentar wurde präzisiert, die Karte selbst ist unverändert
    weiterhin nützlich und unabhängig von 3.2.
- `apps/web/js/modules/sessions.js` — neues Formularfeld „Umfang (m)" im
  Einheit-Erfassen-Modal, **nur sichtbar ohne verknüpften Plan**.
  **Wichtiger Befund beim Umsetzen:** `planId` ist im gesamten Frontend
  aktuell an KEINER Stelle über die UI setzbar (weder im Session-Modal
  noch anderswo) — jede über die App angelegte Einheit hat `planId:
  null`. `actualDistance` ist damit praktisch der einzige heute
  erreichbare Pfad zu einem Trainingsumfangswert, nicht nur ein
  Fallback für einen Randfall. Eine Plan-Verknüpfung im Session-Modal
  nachzurüsten war nicht Teil dieses Plans und wurde bewusst nicht mit
  erledigt — separate Entscheidung, falls gewünscht.
- `apps/api/prisma/seed.ts` — `session2` (die bereits vorhandene
  Ad-hoc-Einheit ohne Plan) bekommt `actualDistance: 1800`, damit die
  Demo-Datenbank den neuen Fallback direkt zeigt.
- Übersetzungsschlüssel in `de-DE.js`/`en-US.js` (Namespaces
  `stats`/`sessions`); `sw.js`: `trainingLoad.js` precacht,
  Cache-Version auf `lane1-v43`.
- Tests: `apps/web/test/trainingLoad.test.js` (6 Fälle), drei neue
  `TrainingSessionSchema`-Tests in `packages/shared-types`, ein neuer
  Sync-Redaktionstest in `apps/api`. Gesamte Testsuite bleibt grün: 1001
  Tests, 0 Fehlschläge.

## 3. Abschnitt 3.3 — Anwesenheitsstatistik & -prognose

### 3.1 Datenmodell

**Kein neues Modell, keine Modelländerung.** Alle nötigen Daten liegen
bereits in `TrainingSession.attendance` (`present: boolean` je
Athlet:in/Einheit) und `TrainingSession.date`/`groupId`. Reine
Client-seitige Auswertung, exakt wie die bestehenden `stats.js`-Karten.

### 3.2 Workflow / UI

Neuer Abschnitt „Anwesenheit" in `stats.js`:

1. **Anwesenheitsquote über Zeit je Gruppe** (`svgLineChart`): pro Woche
   `anwesend / gesamt` in Prozent, geglättet über einen gleitenden
   4-Wochen-Durchschnitt (reduziert Rauschen durch einzelne
   Ausfalltermine).
2. **Frühindikator-Liste** — Athlet:innen mit auffällig gesunkener
   Anwesenheit. **Entscheidung (siehe Abschnitt 7): fest im Code
   hinterlegter Schwellenwert, kein Vereins-Setting in Phase 1.** Eine
   Athlet:in wird markiert, wenn (a) sie insgesamt mindestens 12
   Einheiten seit ihrem `Athlete.joinDate` absolviert hat (8 Baseline- +
   4 aktuelle Einheiten) UND ihre Anwesenheitsquote der letzten 4
   Einheiten mindestens 30 Prozentpunkte unter ihrer eigenen Quote der 8
   Einheiten davor liegt (relativer Abfall — der eigene historische
   Schnitt ist die Vergleichsbasis, nicht ein Gruppendurchschnitt, damit
   unterschiedlich verlässliche Athlet:innen nicht gegeneinander
   verglichen werden), ODER (b) ihre Quote der letzten 4 Einheiten
   absolut unter 50 % liegt — **Kriterium (b) gilt unabhängig von der
   12-Einheiten-Mindesthistorie** (ab 4 Einheiten anwendbar), damit auch
   neu beigetretene Athlet:innen mit durchgehend schlechter Anwesenheit
   erfasst werden, statt erst nach Monaten. Sortiert nach niedrigster
   aktueller Quote zuerst, mit Link zum Athlet:innen-Profil. Beide
   Schwellenwerte (30 Prozentpunkte, 50 %, 4/8 Einheiten Fenstergröße)
   stehen als benannte Konstanten im Code (analog `MAX_SYNC_ATTEMPTS` in
   `syncClient.js`), nicht hart inline verstreut — erleichtert eine
   spätere Konfigurierbarkeit, ohne sie in Phase 1 bereits zu bauen.
3. **Dashboard-Hinweis** (`dashboard.js`, das bereits `rpeAvg` je Einheit
   anzeigt): ein kompakter Hinweis „X Athlet:in(nen) mit gesunkener
   Anwesenheit" für `trainer`/`admin`, verlinkt in die Detailansicht
   unter 2.

### 3.3 Tests

`attendanceTrend(sessions, groupId)` und `flagLowAttendance(sessions,
athletes)` als reine, DOM-unabhängige Funktionen — Testfälle u. a.: leere
Datenlage (keine Einheiten), Athlet:in erst kürzlich der Gruppe
beigetreten (keine künstlich niedrige Quote durch Einheiten vor
Beitritt — Filterung anhand `Athlete.joinDate`), stabile vs. auffällige
Anwesenheit, Sortierreihenfolge bei mehreren markierten Athlet:innen.

### 3.4 Umsetzungsstand: **umgesetzt**

- `apps/web/js/modules/attendanceStats.js` — die reinen Funktionen
  `attendanceTrend()`/`flagLowAttendance()`, wie oben spezifiziert.
- `apps/web/js/modules/stats.js` — zwei neue Karten: „Anwesenheitstrend
  über Zeit" (Gruppenauswahl + Liniendiagramm, gleitender
  4-Wochen-Durchschnitt) und „Anwesenheits-Frühindikator" (Liste,
  verlinkt zum Athlet:innen-Profil).
- `apps/web/js/modules/dashboard.js` — kompakte Hinweiskarte für
  `trainer`/`admin`, nur sichtbar bei mindestens einer Markierung,
  verlinkt in die Statistik-Ansicht.
- Übersetzungsschlüssel in `apps/web/js/i18n/de-DE.js` und `en-US.js`
  (Namespaces `stats`/`dashboard`).
- `apps/web/sw.js`: `attendanceStats.js` zur Precache-Liste ergänzt,
  Cache-Version auf `lane1-v42` erhöht (jede neue/geänderte
  Modul-Datei erfordert das, siehe Kommentar dort).
- Tests: `apps/web/test/attendanceStats.test.js` (7 Fälle, DOM-frei).
- Keine Datenmodell-/Migrations-/Sync-Änderung — wie geplant (Abschnitt
  3.1 oben) reine Client-Auswertung auf bereits synchronisierten Daten.
- Gesamte Testsuite des Monorepos (`npm test`, alle vier Workspaces)
  bleibt grün: 991 Tests, 0 Fehlschläge.

## 4. Rollen & Berechtigungen (zusammenfassend)

| Feature | `admin`/`trainer` | `athlete` |
|---|---|---|
| 3.1 Zyklus anlegen/bearbeiten/anwenden | ja | nein (nur Lesezugriff auf resultierende Pläne, wie heute) |
| 3.2 Umfangs-/RPE-Auswertung (Team/Gruppe) | ja | nein (analog `stats`-Modul heute) |
| 3.3 Anwesenheits-Frühindikator | ja | nein |

Keine Rollenänderungen an bestehenden Modulen nötig — alle drei Features
fügen sich in die bereits bestehenden Rollen der Module `plans`/`stats`
ein.

## 5. Sync-Zusammenfassung

| Store | Neu? | Konfliktregel |
|---|---|---|
| `planCycles` | ja (neuer 11. Store) | last-write-wins (analog `templates`/`plans`, keine Zeitmessung-Semantik wie bei `results`) |
| `plans` | unverändert, nur mehr Schreibvorgänge (durch „Zyklus anwenden") | unverändert |
| `sessions` | Feld `actualDistance` optional ergänzt | unverändert |

Kein neuer REST-Endpunkt, keine neue Konfliktlogik in
`packages/sync-protocol` — beides bleibt vollständig innerhalb des
bestehenden generischen Sync-Musters (Phase 3 des Backend-Plans).

## 6. Umsetzungsreihenfolge innerhalb Phase 1

Empfohlene Abfolge, unabhängig von der Nummerierung 3.1/3.2/3.3 im
Brainstorm-Dokument:

1. **3.3 Anwesenheitsstatistik zuerst** — kein neues Datenmodell, keine
   Migration, geringstes Risiko, schnell sichtbarer Nutzen; guter
   Einstieg, um das Auswertungs-/Chart-Muster in `stats.js` zu etablieren,
   das 3.2 danach wiederverwendet.
2. **3.2 Trainingsumfang-/RPE-Auswertung** — baut auf demselben
   Aggregationsmuster wie 3.3 auf (`stats.js`-Erweiterung), zusätzlich
   die kleine, additive `TrainingSession.actualDistance`-Migration.
3. **3.1 Zyklen zuletzt** — der einzige Teil mit neuem Datenmodell
   (`PlanCycle`, neuer Sync-Store, Backend-Registry-Eintrag) und
   eigenständigem UI-Workflow; eigenständig genug, um unabhängig von 3.2/
   3.3 test- und auslieferbar zu sein, aber am aufwendigsten, deshalb
   zuletzt.

## 7. Entscheidungen

Die drei zuvor offenen Punkte sind wie folgt entschieden — die
Datenmodelle/Workflows oben in Abschnitt 1–3 spiegeln bereits diese
Entscheidungen wider.

### 7.1 Schwellenwerte für den Anwesenheits-Frühindikator (3.3): fest im Code

**Entscheidung:** fest im Code, kein Vereins-Setting in Phase 1.

**Begründung:** Die konfigurierbaren Erinnerungs-Schwellen bei
Qualifikationen (`docs/nutzer-qualifikationen-plan.md`, Abschnitt 2.4)
sind dort gerechtfertigt, weil unterschiedliche Qualifikationsarten
fachlich unterschiedliche, vom Verband/Verein vorgegebene Fristen haben
(harte Anforderung, kein Ermessensspielraum). Der Anwesenheits-
Frühindikator ist dagegen ein weiches, heuristisches Signal ohne
externe Vorgabe — ein Konfigurationsdialog dafür wäre in Phase 1
Overengineering, bevor überhaupt Erfahrungswerte vorliegen, ob 30
Prozentpunkte/50 % die richtigen Werte sind. Die konkreten Werte (siehe
Abschnitt 3.2 oben: 30 Prozentpunkte relativer Abfall bei ≥ 8 Einheiten
Historie, 50 % absolute Untergrenze unabhängig von der Historie) stehen
als benannte Konstanten im Code, damit eine spätere Konfigurierbarkeit
(pro Verein) ohne Umbau der Berechnungslogik nachrüstbar bleibt.

### 7.2 `TrainingSession.actualDistance` (3.2): wird in Phase 1 aufgenommen

**Entscheidung:** ja, aufnehmen.

**Begründung:** `sessions.js: openSessionModal()` erlaubt schon heute
`planId: null` als Standardfall — Ad-hoc-Einheiten ohne Vorlage sind
also kein hypothetischer Randfall, sondern bereits regulär unterstützt.
Ohne `actualDistance` würden solche Einheiten in der neuen
Umfangs-Auswertung (3.2) stillschweigend mit 0 Metern gezählt — das wäre
kein neutrales „Feature fehlt noch", sondern eine **irreführende
Auswertung** für genau die Zielgruppe (Trainer:innen), die sich auf die
Zahl verlassen soll. Die Migration ist minimal-invasiv (ein nullable
`INTEGER`, kein Backfill, kein Pflichtfeld), das Aufwand-/Risiko-
Verhältnis rechtfertigt die Aufnahme in Phase 1.

### 7.3 Zyklen gruppen-übergreifend: `PlanCycle` bekommt keine `groupId`

**Entscheidung:** `PlanCycle` ist NICHT an eine Gruppe gebunden; die
Zielgruppe wird bei jedem „Anwenden" verpflichtend abgefragt.

**Begründung:** Konsistenz mit dem bestehenden Modell — `Template` (die
nächstverwandte, bereits existierende Vorlagen-Ressource) hat ebenfalls
keine `groupId` und ist frei über Gruppen hinweg wiederverwendbar. Ein
Zyklus ist inhaltlich dieselbe Art Vorlage, nur auf Wochenebene statt auf
Einzeltag-Ebene — er sollte sich also genauso verhalten. Das trifft
zudem den naheliegenden Anwendungsfall besser: ein
„Wettkampfvorbereitungs-Zyklus" ist z. B. für mehrere Leistungsgruppen
gleichermaßen sinnvoll, oder wird über mehrere Saisons hinweg auf
wechselnde Gruppen angewendet (Athlet:innen rücken zwischen Gruppen auf).
Eine feste `groupId` hätte diese Wiederverwendung künstlich
eingeschränkt, ohne einen Vorteil zu bieten — das verpflichtende
Abfragen der Zielgruppe beim Anwenden kostet nur einen zusätzlichen
Klick, den das manuelle Anlegen eines einzelnen `Plan` (`Plan.groupId`
ist dort schon Pflichtfeld) ohnehin bereits verlangt.
