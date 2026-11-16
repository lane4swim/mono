# Plan: Pflichtzeiten von Hand erfassen und als Normtabellen wiederverwenden

> **✅ Abgeschlossen** (November 2026). Schritt 1 (Pflichtzeiten je Wettkampf von Hand) und Schritt 2 (Normtabellen) sind umgesetzt.
> Die umgesetzten Funktionen beschreibt das [Funktionshandbuch](../handbuch.md).

Ziel: Pflichtzeiten, die nicht aus einer DSV7-/DSV8-Wettkampfdefinition
kommen (Ausschreibung nur als PDF, Bezirks-/Landesnormen, Korrekturen), von
Hand erfassen — abhängig vom Alter der Athlet:in — und die Startliste damit
**nach genau derselben Logik** prüfen wie importierte Pflichtzeiten
(Ampel grün/gelb/rot/grau, `apps/web/js/modules/requiredTimes.js`).

Stand vor der Umsetzung: Pflichtzeiten gibt es nur aus der
Wettkampfdefinitionsliste (Elemente `PFLICHTZEIT`, `NACHWEIS`), gespeichert
je Disziplin in `Competition.disciplines[].requiredTimes`. Ergänzt
Brainstorm-Punkt 2.4 (Pflicht-/Normzeiten-Tracker).

## 1. Ausgangslage und Hindernisse

`evaluateRequiredTime()` sucht die Disziplin des Startlisten-Eintrags über
die Wettkampfnummer (`findDisciplineIndex()`), nimmt die erste Regel, deren
Geschlecht und Altersklasse passen (`requiredTimeApplies()`), und vergleicht
sie mit der besten Wettkampf- bzw. Trainingszeit vor dem Wettkampftag
(`bestQualifyingTimes()`, Nachweiszeitraum und Bahnlänge beachtet).

Drei Gründe, manuelle Regeln nicht einfach in `disciplines` zu schreiben:

1. **„Wettkampfdefinition ersetzen“** baut `disciplines` aus der Datei neu
   auf — manuelle Einträge gingen verloren.
2. **Zuordnung braucht eine Wettkampfnummer.** Ohne geladene Definition
   haben Einträge oft keine; dann greift keine Regel.
3. **`AK` ist DSV-Semantik:** Obergrenzen ab 20 gelten als
   Masters-Fünfjahresklasse (`inAgeClass()`), eine von Hand gemeinte
   Spanne „18–25“ würde als 18–29 ausgewertet.

## 2. Schritt 1 — Pflichtzeiten je Wettkampf von Hand

### 2.1 Datenmodell

Neues, optionales Feld am Wettkampf (eine JSON-Spalte, wie `disciplines`
bewusst ohne `.default()` im Zod-Schema, damit ein älterer Client es beim
Sync-Push nicht leert):

```ts
RequiredTimeRuleSchema = {
  event: string,                 // Disziplin-Label aus refdata EVENTS, z. B. "100 Freistil"
  gender: '' | 'M' | 'W',        // '' = alle
  classType: '' | 'JG' | 'AL',   // offen · Jahrgänge · Alter im Wettkampfjahr
  min: string, max: string,      // Ziffern oder leer (= offen)
  time: number,                  // Sekunden
}
ManualQualifyingWindowSchema = {
  from: 'JJJJ-MM-TT' | null, to: 'JJJJ-MM-TT' | null,
  course: 'LCM' | 'SCM' | 'any' | null,   // null = Bahn des Wettkampfs
}
Competition.manualRequirements = {
  rules: RequiredTimeRule[],              // max. 500
  qualifyingWindow: ManualQualifyingWindow,
  sourceSetId: uuid | null,               // übernommen aus Normtabelle (Schritt 2)
  sourceSetName: string,
}
```

Prisma: `Competition.manualRequirements Json @default("{}")`; alle
Unterfelder haben Zod-Defaults, `{}` ist damit gültig. Sync unverändert
(Store `competitions`, last-write-wins); kein neuer Fremdschlüssel —
`sourceSetId` ist nur ein Hinweis, die Regeln sind kopiert.

### 2.2 Altersangabe

- **`JG` (Jahrgang von–bis):** bestehende Logik, Geburtsjahre in beliebiger
  Reihenfolge.
- **`AL` (Alter von–bis), neu:** Alter im Wettkampfjahr (Wettkampfjahr minus
  Geburtsjahr, wie bisher `competitionAge()`), beide Grenzen inklusive,
  **ohne** Masters-Aufweitung.
- **leer:** gilt für alle Altersstufen.

Geschlecht wie bisher: Athlet:innen mit „divers“ werden gegen M- und
W-Regeln geprüft.

### 2.3 Auswertung — eine Funktion, zwei Quellen

`evaluateRequiredTime()` bestimmt die Kandidaten-Regeln:

1. Gibt es manuelle Regeln mit `event === entry.event`, gelten **nur
   diese** (manuell ersetzt importiert, je Disziplin). Zuordnung über den
   Disziplinnamen — mit oder ohne Wettkampfnummer.
2. Sonst wie bisher die Regeln der importierten Disziplin.

Regelauswahl, Bestzeitensuche und Ampel bleiben unverändert. Der
Nachweiszeitraum kommt aus der Quelle der Regel: bei manuellen Regeln aus
`manualRequirements.qualifyingWindow` (Bahn `null` = Bahn des Wettkampfs,
`any` = jede Bahn), bei importierten aus `NACHWEIS`. Staffeln werden nicht
geprüft. `hasRequiredTimes()` zählt manuelle Regeln mit; der Tooltip nennt
die Quelle (Wettkampfdefinition, von Hand, Normtabelle „…“).

### 2.4 Oberfläche

Neue Karte **„Pflichtzeiten“** in der Wettkampf-Detailseite mit Anzahl und
Quelle der Regeln und den Schaltflächen **„Pflichtzeiten erfassen“** sowie
(Schritt 2) **„Normtabelle übernehmen“**.

Der Erfassungsdialog (gemeinsamer Editor `requiredTimesEditor.js`, auch für
Normtabellen genutzt):

- Tabelle mit einer Zeile je Regel: Disziplin (Liste aus `EVENTS` ohne
  Staffeln), Geschlecht, Altersangabe, von, bis, Pflichtzeit; Zeilen
  hinzufügen, duplizieren, entfernen.
- Nachweis: von, bis, Bahn (des Wettkampfs / 25 m / 50 m / beliebig).
- **Aus Tabelle einfügen:** Textfeld für kopierte Zeilen (Tab, Semikolon
  oder mehrere Leerzeichen getrennt) im Format
  `Disziplin; Geschlecht; von; bis; Zeit`, Altersangabe für alle Zeilen
  wählbar; erkennt deutsche/englische Disziplin- und Geschlechtsangaben;
  fehlerhafte Zeilen werden mit Zeilennummer gemeldet.
- Prüfung beim Speichern: Pflichtfelder, gültige Zeit, Ziffern in von/bis,
  von ≤ bis bei `AL` (bei `JG` wird sortiert). Warnung (mit Rückfrage) bei
  überlappenden Regeln derselben Disziplin und desselben Geschlechts — nur
  die erste passende Regel zählt, eine Überlappung ist fast immer ein
  Tippfehler.

Rechte: wie der Wettkampf selbst (trainer/admin, Paket `competitions`).

## 3. Schritt 2 — Normtabellen

Wiederkehrende Vorgaben (Bezirks-, Landes-, Deutsche Meisterschaften)
einmal pflegen und je Wettkampf übernehmen.

### 3.1 Datenmodell

Neuer Sync-Store `requiredTimeSets` (Paket `competitions`, lesen alle
Team-Rollen, pflegen trainer/admin, last-write-wins):

```ts
RequiredTimeSetSchema = {
  id, clubId,
  name: string (1–200), description: string (≤ 2000),
  rules: RequiredTimeRule[] (≤ 500),
  qualifyingWindow: ManualQualifyingWindow,
  createdAt, updatedAt,
}
```

Prisma-Modell `RequiredTimeSet` (Tabelle `required_time_sets`) mit
`rules`/`qualifyingWindow` als JSON-Spalten, Index `[clubId, updatedAt]`,
Soft-Delete. IndexedDB v8. Keine personenbezogenen Daten — nicht Teil von
DSGVO-Export/-Löschung.

### 3.2 Übernehmen statt verknüpfen

**„Normtabelle übernehmen“** kopiert Regeln und Nachweiszeitraum in
`Competition.manualRequirements` und merkt sich `sourceSetId`/
`sourceSetName`. Eine spätere Änderung der Normtabelle (z. B. für die
nächste Saison) verändert damit nicht rückwirkend die Prüfung eines
bereits geplanten Wettkampfs — gleiches Muster wie „Zyklus anwenden“.
Vorhandene manuelle Regeln werden nach Rückfrage ersetzt.

Für Tabellen, die über mehrere Saisons gelten, empfiehlt sich `AL`
(Alter) statt `JG` (Jahrgang): „AL 11–12“ bleibt jedes Jahr richtig.

### 3.3 Oberfläche

Unter *Wettkämpfe* → **„Normtabellen“** (Unterseite der Route
`competitions`, wie die Zyklen bei den Trainingsplänen): Liste mit Name und
Anzahl der Regeln; anlegen, bearbeiten (gleicher Editor), duplizieren,
löschen.

## 4. Tests

- `requiredTimes.test.js`: `AL`-Grenzen inkl. Alter 25 (keine
  Masters-Aufweitung); manuelle Regeln ersetzen importierte je Disziplin;
  Zuordnung ohne Wettkampfnummer; manueller Nachweiszeitraum und Bahn
  (`null`/`any`); rein importierte Fälle unverändert.
- Editor-Logik (DOM-frei): Einfügen-Parser, Validierung, Überlappung.
- `shared-types`: Schemas (ungültiges Geschlecht/Altersangabe, Zeit ≤ 0,
  `{}` als gültige Vorgabe), neuer Store in der Registry.
- API: Entity-Registry (15 Stores), Rechte und Paket-Zuordnung des neuen
  Stores.

## 5. Umsetzungsstand

Umgesetzt wie oben beschrieben:

- `packages/shared-types/src/entities.ts`: `RequiredTimeRuleSchema`,
  `ManualQualifyingWindowSchema`, `ManualRequirementsSchema`,
  `Competition.manualRequirements`, `RequiredTimeSetSchema` und Store
  `requiredTimeSets` (Paket `competitions`, `modules.ts`).
- `apps/api`: Spalte `competitions.manualRequirements`, Tabelle
  `required_time_sets` (Migration `20261116120000_add_required_times`,
  per `prisma migrate diff` erzeugt, nicht gegen eine echte Postgres-Instanz
  ausgeführt), Entity-Registry, Rechte (`coachManaged`).
- `packages/sync-protocol`: `requiredTimeSets` last-write-wins.
- `apps/web`: Auswertung in `requiredTimes.js` (`AL`, `rulesForEntry()`,
  Quelle im Tooltip), DOM-freie Logik `requiredTimeRules.js`, Editor
  `requiredTimesEditor.js`, Karte und Übernehmen
  `competitionRequiredTimes.js`, Normtabellen `requiredTimeSets.js`
  (Route `#/competitions/normtables`), IndexedDB v8, `sw.js` v101, i18n
  de/en, Hilfeseite `help/wettkampf.html`.
- Abweichung vom Plan: Die Rückfrage bei überlappenden Regeln ist kein
  eigener Dialog, sondern ein Hinweis im Editor; erneutes Speichern
  bestätigt. Ein zweiter Dialog würde das offene Modal schließen
  (`modal.js: openModal()` leert den Modal-Container).
