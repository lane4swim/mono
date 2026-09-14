# Plan: Beckenlänge im Trainingsplan (#72) & Belastungsstufe „Regeneration" (#73)

Umsetzungsplan für zwei kleine, unabhängige Issues aus dem Trainingsplanungs-
Bereich — als Diskussionsgrundlage gedacht, analog zu den übrigen Plänen in
`docs/Plans/` (z. B. `trainingsplanung-phase1-plan.md`), aber deutlich kleiner
im Umfang: beide Änderungen sind additiv, ohne neue Prisma-Migration, ohne
neuen Sync-Store.

## Umsetzungsstand

**Beide Issues sind umgesetzt UND per Code-Review geprüft.** Das Review
deckte einen Befund mit Praxisrelevanz für den gesamten Vorlagen-Sync auf
(fehlende Prisma-Spalte für `Template.poolLength`, siehe „Nachträglich
behoben" am Ende von Abschnitt 2) — behoben, nicht nur dokumentiert.

| Issue | Status |
|---|---|
| #73 Belastungsstufe „Regeneration" | **umgesetzt** — siehe Abschnitt 1.6 |
| #72 Beckenlänge im Trainingsplan | **umgesetzt** — siehe Abschnitt 2.9 (inkl. Code-Review-Korrektur) |

## 0. Ausgangslage

- **Issue #72** (`Auswahl für die Beckenlänge im Trainingsplan`): Trainingspläne
  sollen eine Beckenlänge tragen, die von Trainingstag zu Trainingstag
  variieren kann, und auch in Vorlagen (`Template`) verfügbar sein.
- **Issue #73** (`Belastungsstufen ergänzen`): Der Belastungsstufe „Regeneration"
  fehlt in der Auswahlliste der Satz-Intensitäten.
- Beide betreffen dieselbe Datenschicht (`Plan.days` / `Template.sets`, Json-
  Felder ohne eigene Prisma-Spalten je Eintrag) und dieselben UI-Module
  (`plans.js`, `templates.js`, `setEditor.js`), werden hier deshalb in einem
  gemeinsamen Plan behandelt statt in zwei getrennten Dokumenten.

## 1. Issue #73 — Belastungsstufe „Regeneration"

### 1.1 Ist-Zustand

`intensity` ist kein Enum, sondern ein freies String-Feld
(`PlainSetSchema.intensity: z.string().max(200)`,
`packages/shared-types/src/entities.ts:235`) — nur die UI schränkt die
Auswahl über eine feste Referenzliste ein:

```js
// apps/web/js/refdata.js:97-103
export const SET_INTENSITIES = [
  { value: 'locker', label: 'Locker (GA2)' },
  { value: 'ga1', label: 'Grundlage (GA1)' },
  { value: 'schwelle', label: 'Schwelle' },
  { value: 'renotempo', label: 'Renn­tempo' },
  { value: 'sprint', label: 'Sprint / Maximal' },
];
```

Die Liste ist aufsteigend nach Belastung sortiert (locker → maximal).
„Regeneration" fehlt als eigenständige, unterhalb von „Locker (GA2)"
liegende Stufe — fachlich relevant, weil Regenerationseinheiten (aktive
Erholung, sehr geringe Belastung) sich von normalem Grundlagentraining
unterscheiden und in der Trainingsumfang-/Belastungsauswertung (siehe
`docs/Plans/trainingsplanung-phase1-plan.md`, Abschnitt 3.2) künftig
getrennt ausgewertet werden könnte.

### 1.2 Änderung

**Kein Schema-/Migrations-Eingriff nötig** — `intensity` bleibt ein freier
String, ein neuer Wert ist sofort gültig. Reine Erweiterung der
Referenzliste plus Übersetzungen:

1. **`apps/web/js/refdata.js`** — neuer Eintrag **am unteren Ende der
   Belastungsskala** (vor `locker`, da „Regeneration" die geringste
   Belastung aller Stufen ist):
   ```js
   export const SET_INTENSITIES = [
     { value: 'regeneration', label: 'Regeneration' },
     { value: 'locker', label: 'Locker (GA2)' },
     { value: 'ga1', label: 'Grundlage (GA1)' },
     { value: 'schwelle', label: 'Schwelle' },
     { value: 'renotempo', label: 'Renn­tempo' },
     { value: 'sprint', label: 'Sprint / Maximal' },
   ];
   ```
   `value: 'regeneration'` (statt eines kryptischeren Kürzels wie bei
   `renotempo`) — der deutsche Fachbegriff ist bereits kurz und eindeutig,
   eine Abkürzung böte hier keinen Vorteil.
2. **`apps/web/js/i18n/de-DE.js:709-711`** (`refdata.setIntensities`) und
   **`apps/web/js/i18n/en-US.js`** (Pendant) — neuer Schlüssel
   `regeneration: 'Regeneration'` (de) bzw. `regeneration: 'Recovery'` (en).
3. **`CATEGORY_DEFAULTS`** (`apps/web/js/modules/setEditor.js:36-45`) —
   **keine Änderung nötig**: die Standard-Intensität je Übungskategorie
   (z. B. `technik: 'locker'`) bleibt sinnvoll; „Regeneration" wird bewusst
   nicht als automatischer Default für eine Kategorie hinterlegt, sondern
   bleibt eine explizite manuelle Auswahl je Satz (eine ganze Kategorie
   pauschal auf „Regeneration" zu setzen ergäbe fachlich keinen Sinn).
4. **`apps/web/js/modules/planPdfExport.js:207`** — keine Code-Änderung,
   `trLabel(SET_INTENSITIES, entrySet.intensity, 'setIntensities')` löst den
   neuen Wert automatisch über die erweiterte Liste/i18n auf.

### 1.3 Auswirkung auf bestehende Daten

Rein additiv: bestehende Sätze mit `intensity: 'locker'`/`'ga1'`/… bleiben
unverändert gültig, kein Backfill, keine Migration. `intensity` als freier
String bedeutet außerdem: **falls einzelne Installationen bereits jetzt
„Regeneration" o. Ä. als Freitext eingetragen haben** (z. B. über ein
manuell befülltes CSV/Import, sofern vorhanden), würde eine solche Zeile mit
dem neuen `value` erst nach manueller Korrektur im UI sauber auf den neuen
Eintrag matchen — unwahrscheinlich, da `intensity` bisher ausschließlich
über das `<select>` in `setEditor.js` gesetzt wird, aber der Vollständigkeit
halber hier vermerkt.

### 1.4 Tests

- `apps/web/test/refdata.test.js` (sofern vorhanden) bzw. ein neuer Test:
  `SET_INTENSITIES` enthält `regeneration`, alle `value`s sind eindeutig.
- i18n-Vollständigkeitstest (sofern die Codebasis einen hat, siehe
  `apps/web/test/i18n*.test.js`): `de-DE`/`en-US` enthalten für jeden
  `SET_INTENSITIES`-Wert einen Übersetzungsschlüssel — deckt den neuen
  Eintrag automatisch mit ab.

### 1.5 Aufwand/Risiko

Minimal — ein Array-Eintrag plus zwei i18n-Zeilen, kein Datenmodell-,
Migrations- oder Sync-Eingriff. Kann unabhängig von #72 sofort umgesetzt
werden.

### 1.6 Umsetzungsstand: **umgesetzt**

Wie geplant, ohne Abweichung:

- `apps/web/js/refdata.js` — `SET_INTENSITIES` bekommt `{ value:
  'regeneration', label: 'Regeneration' }` an erster Stelle (unterhalb von
  `locker`).
- `apps/web/js/i18n/de-DE.js`/`en-US.js` — `refdata.setIntensities.
  regeneration` (`'Regeneration'` bzw. `'Recovery'`).
- Kein Schema-, Migrations- oder Sync-Eingriff, wie geplant.
- Tests: bestehende i18n-Vollständigkeitstests (`apps/web/test/
  i18n.test.js`) decken den neuen Schlüssel bereits automatisch ab (kein
  neuer Testfall nötig, da rein strukturprüfend). Gesamte Testsuite bleibt
  grün.

## 2. Issue #72 — Beckenlänge im Trainingsplan

### 2.1 Ist-Zustand

Es gibt noch kein Beckenlängen-Feld für Trainingspläne/-vorlagen. Ein
strukturell identisches Feld existiert aber bereits für Wettkämpfe/
Ergebnisse:

```ts
// packages/shared-types/src/entities.ts:120
export const CourseSchema = z.enum(['LCM', 'SCM']);
```

```js
// apps/web/js/refdata.js:6-9
export const COURSES = [
  { value: 'LCM', label: 'LCM · 50m Bahn' },
  { value: 'SCM', label: 'SCM · 25m Bahn' },
];
```

`LCM`/`SCM` (Long/Short Course Meters) sind exakt die international
gebräuchlichen Kürzel für 50m- bzw. 25m-Becken — fachlich identisch mit
dem, was Issue #72 für Trainingstage will, nur bisher nur für Wettkämpfe
verwendet.

**Datenmodell, das die Beckenlänge tragen muss:**

```ts
// entities.ts:314-318 — "Trainingstag"
export const PlanDaySchema = z.object({
  date: isoDate,
  sets: z.array(SetEntrySchema).max(200),
}).strict();

// entities.ts:285-295 — "Vorlage"
export const TemplateSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(100)).max(50).default([]),
  sets: z.array(SetEntrySchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
```

Beides sind Json-Spalten in Prisma (`schema.prisma:477-493` bzw. `:514-541`)
ohne eigene Unter-Spalten je Feld — ein neues Feld landet also **innerhalb**
des Json-Blobs über das Zod-Schema, **keine neue Prisma-Spalte, keine
Migration nötig** (identisches Vorgehen wie bei jedem anderen Feld
innerhalb von `days`/`sets`).

### 2.2 Entscheidung: `CourseSchema` wiederverwenden statt neuem Enum

**Entscheidung:** Das Feld heißt `poolLength`, nutzt aber denselben
`CourseSchema`-Enum (`'LCM' | 'SCM'`) wie `Competition`/`Result`, statt
einen eigenen `PoolLengthSchema` mit denselben zwei Werten zu duplizieren.

**Begründung:** Beckenlängen im Schwimmsport kennen international genau
diese zwei Standardgrößen (50 m/25 m) — Training und Wettkampf teilen sich
dasselbe Vokabular, ein zweites Enum mit identischem Wertebereich wäre
reine Duplikation ohne fachlichen Unterschied (anders als z. B. bei
`SET_INTENSITIES`, wo Trainings- und ggf. künftige Wettkampf-Konzepte
inhaltlich verschieden sind). Der Feldname bleibt trotzdem `poolLength`
(nicht `course`), weil „Bahn/Course" im Wettkampfkontext eine andere
Konnotation hat (Wettkampfbahnlänge als Meldevoraussetzung) als „welches
Becken wurde trainiert" — nur der Werte-Enum wird geteilt, nicht die
fachliche Bedeutung des Feldnamens.

Reine 25-Yard-Becken (SCY, in den USA verbreitet) deckt `CourseSchema`
bewusst **nicht** ab — wie bei `Competition`/`Result` bereits heute, kein
neuer Rückschritt gegenüber dem Bestehenden; falls das künftig gebraucht
wird, ist das eine separate, das bestehende `CourseSchema` betreffende
Erweiterung außerhalb dieses Plans.

### 2.3 Schema-Änderungen

```ts
// entities.ts — PlanDaySchema
export const PlanDaySchema = z.object({
  date: isoDate,
  // Beckenlänge dieses Trainingstages — optional, da bestehende Pläne
  // (vor Issue #72) keinen Wert haben; null = "nicht festgelegt", kein
  // erzwungener Default, um kein falsches LCM/SCM für Altdaten vorzutäuschen.
  poolLength: CourseSchema.nullable().default(null),
  sets: z.array(SetEntrySchema).max(200),
}).strict();

// entities.ts — TemplateSchema
export const TemplateSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(100)).max(50).default([]),
  // Standard-Beckenlänge dieser Vorlage — wird beim Anwenden der Vorlage
  // (Plan-Tag anlegen, siehe 2.5) in PlanDay.poolLength übernommen, bleibt
  // dort aber jederzeit pro Tag überschreibbar (Snapshot, kein Verweis).
  poolLength: CourseSchema.nullable().default(null),
  sets: z.array(SetEntrySchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
```

`nullable().default(null)` statt eines Pflichtfelds mit hartem Default
(z. B. immer `'LCM'`): ein untergeschobener Default würde für alle
Alt-Pläne stillschweigend eine falsche Beckenlänge behaupten, statt
ehrlich „unbekannt" abzubilden — konsistent mit der bereits etablierten
Begründung für `TrainingSession.actualDistance` in
`trainingsplanung-phase1-plan.md`, Abschnitt 7.2 (additiv, kein
irreführender Default für alte Daten).

**Keine Änderung an `CycleDaySchema`/`CycleWeekSchema`** nötig — ein Zyklus
referenziert nur `templateId`, die Beckenlänge fließt beim „Zyklus anwenden"
automatisch mit, weil dort bereits `cloneItems(template.sets)` (analog:
`template.poolLength`) in den neu erzeugten `PlanDay` kopiert wird (siehe
2.5).

### 2.4 Backend

- **Keine Prisma-Migration** — `days`/`sets` bleiben `Json`-Spalten, das
  neue Feld lebt innerhalb des bereits vorhandenen Blobs.
- **Kein neuer Sync-Store, keine neue Konfliktregel** — `plans`/`templates`
  sind bereits synchronisierte Stores mit
  `last-write-wins-document`-Strategie (`packages/sync-protocol/src/
  conflictResolution.ts`); ein zusätzliches Feld im Dokument ändert daran
  nichts.
- **`apps/api`**: keine Code-Änderung nötig — der generische Sync-Pfad
  (`delegate.create({ data: payload })`) validiert nur gegen das
  Zod-Schema aus `shared-types`, kein feldspezifischer Code im Backend
  kennt `sets`/`days`-Interna.

### 2.5 Frontend

1. **`apps/web/js/refdata.js`** — `COURSES` bleibt unverändert (wird
   direkt wiederverwendet, siehe 2.2), keine Änderung nötig.
2. **`apps/web/js/modules/plans.js`**:
   - `openPlanModal()` (Zeile 286+): in `drawDays()` (Zeile 312-326) bekommt
     jeder Tages-Block (`.day-block-head`, Zeile 317-320) neben dem
     bestehenden Datums-Feld einen `selectInput(COURSES-Optionen, day.
     poolLength)` — analog zum bereits etablierten `COURSES`-Verwendungs-
     muster in `competitions.js:283`/`times.js:109`
     (`selectInput(trOptions(COURSES, 'courses'), data.course)`), hier mit
     einer zusätzlichen leeren Option „nicht festgelegt" (da `poolLength`
     nullable ist, anders als `Competition.course`, das ein Pflichtfeld
     ist).
   - Beim Anlegen eines neuen Tages über eine Vorlage (Zeile 332-337,
     `templateSel`): `data.days.push({ date: nextDate, poolLength: tpl?.
     poolLength ?? null, sets: tpl ? cloneItems(tpl.sets) : [] })` — Snapshot
     der Vorlagen-Beckenlänge, danach unabhängig editierbar (gleiches
     Snapshot-statt-Referenz-Prinzip wie bei `sets`, siehe
     `trainingsplanung-phase1-plan.md`, Abschnitt 0).
   - Speichern (Zeile 344): `days: data.days.map(d => ({ ...d, date:
     toIsoDateTime(d.date) }))` — `poolLength` ist bereits Teil von `d` durch
     den Spread, keine Änderung an dieser Zeile nötig.
3. **`apps/web/js/modules/templates.js`**: `openTemplateModal()`
   (Zeile 88+) bekommt ein zusätzliches Formularfeld „Beckenlänge"
   (`selectInput`, gleiches `COURSES`-Muster, mit leerer Option) neben Name/
   Beschreibung/Tags (Zeile 92-97); `data.poolLength` wird beim Anlegen
   initialisiert (Zeile 90: `{ name: '', description: '', tags: [], sets:
   [], poolLength: null }`) und beim Speichern (Zeile 110) mit übergeben.
4. **`apps/web/js/modules/planCycles.js`**: keine Code-Änderung nötig —
   `buildPlansFromCycle()` erzeugt Plan-Tage bereits über `cloneItems(
   template.sets)`; die analoge Übernahme von `template.poolLength` gehört
   in dieselbe Stelle, an der der neue `PlanDay` zusammengebaut wird (siehe
   2.3, letzter Absatz) — wird beim Umsetzen zusammen mit der
   `plans.js`-Änderung aus 2.5.2 erledigt, da beide dieselbe
   „Vorlage → Plan-Tag"-Erzeugungslogik betreffen.
5. **`apps/web/js/modules/planPdfExport.js`**: `buildDayColumn()`
   (Zeile 155-170) — Beckenlänge in der Tageskopfzeile ergänzen, neben
   Datum/Gesamtstrecke (Zeile 158-163:
   `el('span', { class: 'print-day-date' }, fmtDateLong(day.date))`), z. B.
   als zusätzliches `<span>` mit `trLabel(COURSES, day.poolLength,
   'courses')`, nur gerendert wenn `day.poolLength` gesetzt ist (kein
   „—"-Rauschen bei unbekannter Beckenlänge, analog zum bestehenden
   Muster für `restSec`/Material in `buildSetRow()`, Zeile 213/216-219).
6. **i18n**: `de-DE.js`/`en-US.js` — kein neuer Namespace nötig,
   `refdata.courses` existiert bereits (Zeile 704); ggf. ein neues
   Formularlabel `plans.formPoolLength`/`templates.formPoolLength` bzw.
   „nicht festgelegt"-Optionstext in beiden Locales ergänzen.
7. **`apps/web/sw.js`**: Cache-Version erhöhen (jede geänderte
   Modul-Datei erfordert das laut Kommentar dort) — hier betrifft es
   bereits precachte Dateien (`plans.js`, `templates.js`,
   `planPdfExport.js`), also nur der Versions-Bump, keine neue
   Precache-Zeile.

### 2.6 Auswirkung auf bestehende Daten

Rein additiv, `poolLength` ist `nullable().default(null)` — bestehende
`Plan`/`Template`-Datensätze ohne dieses Feld bleiben gültig, erscheinen im
UI als „nicht festgelegt", kein Backfill nötig.

### 2.7 Tests

- `packages/shared-types`: `PlanDaySchema`/`TemplateSchema`-Tests —
  `poolLength` akzeptiert `'LCM'`/`'SCM'`/`null`, lehnt ungültige Werte
  (z. B. `'25yd'`) ab; bestehende Payloads ohne `poolLength` bleiben gültig
  (Default greift).
- `apps/web/test/planCycles.test.js` (bestehende Suite, siehe
  `trainingsplanung-phase1-plan.md`, Abschnitt 1.7): neuer Testfall —
  `buildPlansFromCycle()` übernimmt `template.poolLength` in die erzeugten
  `PlanDay`-Einträge.
- Kein neuer Backend-Test nötig, da keine Backend-Logik geändert wird
  (siehe 2.4) — die bestehende `entityRegistry`-/Sync-Testsuite deckt
  `plans`/`templates` bereits generisch ab.

### 2.8 Aufwand/Risiko

Klein bis mittel: kein neues Datenmodell/Store, keine Migration, aber
mehrere UI-Stellen (Plan-Modal, Vorlage-Modal, PDF-Export, Zyklus-Anwenden-
Logik) müssen konsistent das neue Feld durchreichen. Größtes Risiko ist,
eine dieser Stellen zu vergessen (v. a. `planCycles.js`, da dort die
Vorlage→Plan-Tag-Erzeugung an einer zweiten Stelle dupliziert existiert,
siehe 2.5.4) — beim Umsetzen mit einem gemeinsamen Grep nach
`cloneItems(` in `plans.js`/`planCycles.js` gegenprüfen, um beide
Erzeugungsstellen zu erfassen.

### 2.9 Umsetzungsstand: **umgesetzt**

Wie geplant, ohne Abweichung — `CourseSchema` wiederverwendet, keine
Migration:

- `packages/shared-types/src/entities.ts` — `poolLength:
  CourseSchema.nullable().default(null)` auf `PlanDaySchema` und
  `TemplateSchema`. Keine neue Prisma-Spalte/Migration (Json-Felder).
- `apps/web/js/modules/plans.js` — `poolLengthOptions()`-Helfer (leere
  Option „nicht festgelegt" + `trOptions(COURSES, 'courses')`); Select je
  Trainingstag in `drawDays()`; Snapshot der Vorlagen-`poolLength` beim
  Anlegen eines Tages aus einer Vorlage; zusätzlich — **über den
  ursprünglichen Plan hinaus** — ein Badge mit der Beckenlänge in der
  Plan-Detailansicht (`renderDetail()`), da das Feld sonst nur im
  Bearbeiten-Modal sichtbar gewesen wäre, nicht beim bloßen Ansehen eines
  bereits gespeicherten Plans.
- `apps/web/js/modules/templates.js` — analoges Select im
  Vorlagen-Modal sowie, ebenfalls über den ursprünglichen Plan hinaus, ein
  Beckenlängen-Badge auf der Vorlagen-Karte in der Listenansicht (gleiche
  Begründung: Sichtbarkeit außerhalb des Bearbeiten-Modals).
- `apps/web/js/modules/planCycles.js` — `buildPlansFromCycle()` übernimmt
  `template.poolLength` in jeden erzeugten `PlanDay`, exakt wie `sets`.
- `apps/web/js/modules/planPdfExport.js` — `buildDayColumn()` (von
  Wochen- und Einzeltag-Export gemeinsam genutzt) zeigt die Beckenlänge in
  der Tageskopfzeile neben dem Datum, nur wenn gesetzt.
- `apps/web/js/i18n/de-DE.js`/`en-US.js` — `plans.formPoolLength`/
  `plans.poolLengthNotSet` (von `templates.js` mitgenutzt, wie auch
  `plans.totalBadge` dort bereits zuvor über Namespace-Grenzen hinweg
  verwendet wurde); `refdata.courses` existierte bereits, keine Änderung
  nötig.
- `apps/web/sw.js` — `CACHE_VERSION` `lane1-v52` → `lane1-v53`; keine neue
  Precache-Zeile nötig, da alle geänderten Dateien bereits precacht waren.
- Kein Backend-Code geändert (generischer Sync-Pfad deckt das neue Feld
  automatisch ab, wie geplant).
- **Tests:** zwei neue `TemplateSchema`-/`PlanDaySchema`-Testfälle
  (`packages/shared-types/test/entities.test.ts`) für gültige/ungültige
  `poolLength`-Werte sowie Default `null`; ein bestehender
  `planCycles.test.js`-Testfall musste um das neue Feld ergänzt werden
  (`toEqual()` mit vollständigem Objekt), ein neuer Testfall prüft die
  `poolLength`-Übernahme von Vorlage zu erzeugtem Plan-Tag. Gesamte
  Monorepo-Suite bleibt grün: 1174 Tests (622 `apps/api`, 297 `apps/web`,
  245 `shared-types`, 10 `sync-protocol`), 0 Fehlschläge; `npm run lint`
  sauber in allen vier Workspaces.

**Nachträglich behoben (unabhängiges Code-Review):**

- **Fehlende Prisma-Spalte für `Template.poolLength` — hätte JEDEN
  Template-Sync-Schreibzugriff zum Absturz gebracht, nicht nur solche mit
  gesetzter Beckenlänge.** Abschnitt 2.1/2.4 dieses Plans nahm an, dass
  `poolLength` wie bei `PlanDay` folgenlos innerhalb eines bestehenden
  Json-Feldes lebt — das stimmt für `Plan.days` (Json-Array), aber
  **nicht** für `Template`: dort sind `name`/`description`/`tags`/`sets`
  jeweils eigene Prisma-Spalten (`apps/api/prisma/schema.prisma:477-493`),
  `poolLength` wurde als *zusätzliches Top-Level-Feld* des Zod-Schemas
  ergänzt, ohne eine passende Spalte anzulegen. Der generische Sync-Pfad
  (`sync.gateway.ts: delegate.create({ data: payload })`/`delegate.update
  (...)`) hätte das vollständige, gegen `TemplateSchema` geparste Payload
  direkt an Prisma weitergereicht — und weil `poolLength:
  CourseSchema.nullable().default(null)` bei jedem `safeParse()` befüllt
  wird (auch wenn der Client das Feld nie sendet), wäre **jeder**
  Template-`create`/`update` über Sync mit einem Prisma-Laufzeitfehler
  („Unknown argument `poolLength`") gescheitert — nicht nur der neue
  Beckenlängen-Workflow, sondern das gesamte Vorlagen-Feature. Von den 622
  `apps/api`-Tests hat das keiner erfasst, weil `entityRegistry.test.ts`
  gegen einen *gefakten* Prisma-Client testet
  (`makeFakePrismaClient()`), nicht gegen ein echtes Schema — dieser
  Sandbox fehlt weiterhin der Docker-Zugriff für einen echten
  Postgres-Integrationstest (siehe bereits bekannter Vorbehalt in
  `trainingsplanung-phase1-plan.md`).
  - **Behoben:** neue Spalte `Template.poolLength String?` (nullable,
    kein Default — konsistent mit dem bereits etablierten Muster für
    optionale String-Spalten wie `Athlete.nationalID`, statt eines
    erzwungenen Defaults wie bei `Competition.course`) in
    `apps/api/prisma/schema.prisma`; neue Migration
    `20260914100000_add_template_pool_length` (`ALTER TABLE "templates"
    ADD COLUMN "poolLength" TEXT`, von Hand angelegt nach demselben Muster
    wie die beiden vorherigen additiven Migrationen dieses Bereichs —
    `20260908090000_add_session_actual_distance`,
    `20260909090000_add_plan_cycle` — da auch hier kein Docker-Zugriff für
    `prisma migrate dev` besteht). `apps/api/prisma/seed.ts:
    prisma.template.createMany()` explizit um `poolLength: t.poolLength ??
    null` ergänzt (die dortige Feld-Whitelist hätte das Feld sonst
    ebenfalls stillschweigend verworfen). **Nicht gegen eine echte
    Postgres-Instanz geprüft** (`npx prisma validate` mit Platzhalter-
    `DATABASE_URL` bestätigt nur die Schema-Syntax) — vor dem ersten
    Produktiv-Deployment `npx prisma migrate deploy` gegen eine echte
    Datenbank verifizieren, exakt wie bei den beiden genannten Vorgänger-
    Migrationen bereits vermerkt. Dafür angelegt:
    [Issue #74](https://github.com/lane4swim/mono/issues/74).
  - `PlanDay.poolLength` war von diesem Befund **nicht** betroffen — `Plan.
    days` ist und bleibt eine einzige `Json`-Spalte, das neue Feld lebt
    dort korrekt bereits innerhalb des Blobs, keine Migration nötig, wie
    ursprünglich geplant.
- **Demo-/Seed-Daten zeigten das neue Feld nirgends** — weder
  `apps/web/js/demoSeed.js` noch `apps/api/prisma/seed.ts` setzten
  `poolLength` auf den beiden Beispiel-Vorlagen oder den drei
  Beispiel-Plantagen, obwohl der Phase-1-Plan genau dafür ein Präzedenzfall
  ist (`TrainingSession.actualDistance` wurde dort gezielt in die
  Demo-Daten aufgenommen, „damit die Demo-Datenbank den neuen Fallback
  direkt zeigt"). Behoben: `template1`/`template2` bekommen `poolLength:
  'LCM'` bzw. `'SCM'`, die drei Tage von `plan1` übernehmen den
  Vorlagenwert — der letzte Tag weicht bewusst davon ab (`'SCM'` trotz
  `template1`-Herkunft), um sichtbar zu machen, dass die Beckenlänge pro
  Tag unabhängig von der Vorlage überschreibbar bleibt (Kernpunkt von
  Issue #72). In beiden Seed-Dateien identisch nachgezogen, damit
  Demo-Modus (`apps/web`) und lokale Postgres-Demo-DB (`apps/api`)
  konsistent bleiben.
- Gesamte Monorepo-Suite nach beiden Korrekturen erneut grün: 1174 Tests,
  0 Fehlschläge; `npm run build`/`npm run typecheck` (`apps/api`, deckt
  `prisma/seed.ts` ab, das nicht Teil von `npm test` ist) sauber; `npm run
  lint` sauber in allen vier Workspaces.

## 3. Umsetzungsreihenfolge

1. **#73 zuerst** — trivial, kein Risiko, unabhängig von #72, schneller
   sichtbarer Nutzen.
2. **#72 danach** — mehr betroffene Dateien, aber ebenfalls additiv/
   risikoarm; von #73 unabhängig, könnte auch parallel erledigt werden.

## 4. Rollen & Berechtigungen

Keine Änderung — beide Felder werden über dieselben Formulare
(Plan-/Vorlagen-Modal) bearbeitet, die bereits heute den Rollen
`trainer`/`admin` vorbehalten sind (`plans`/`templates`-Modul,
unverändert).

## 5. Sync-Zusammenfassung

| Store | Änderung | Migration | Konfliktregel |
|---|---|---|---|
| `plans` | `PlanDay.poolLength` (neu, optional) | keine (Json-Feld) | unverändert |
| `templates` | `Template.poolLength` (neu, optional) | keine (Json-Feld) | unverändert |

Kein neuer REST-Endpunkt, keine neue Konfliktlogik, keine neue Prisma-
Migration für beide Issues zusammen.
