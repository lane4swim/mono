# Plan: Wettkampfergebnis-Import via DSV7 / Lenex

Ziel: In der Wettkampfansicht (`apps/web/js/modules/competitions.js`) eine DSV7- oder
Lenex-Ergebnisdatei importieren können. Bestehende `Result`-Einträge (Zeit, Platz,
Zwischenzeiten) werden dabei überschrieben, Kommentare und sonstige manuell gepflegte
Metadaten bleiben erhalten.

Stand: Greenfield-Feature, kein bestehender Code (`docs/todo.md:23` ist nur eine leere
Überschrift). Alle Angaben zu Architektur/Datenmodell beruhen auf einer Code-Recherche
in `apps/api` und `apps/web` (Fastify/Prisma-Backend, Vanilla-JS-Frontend ohne Build-Schritt,
Sync-API als einziger Schreibpfad).

## 1. DSV7-Formatanalyse

Quelle: „DSV Standard" – Standardisierung des Datenaustausches für Meldungen zu und
Protokollen von Schwimmwettkämpfen, Format 7, DSV, Stand 31.08.2022 (gültig ab
01.01.2023), sowie eine reale Beispieldatei (EasyWk-Export, `2024-02-18-Berlin-Pr.dsv7`).

### 1.1 Grundaufbau

- **Reine Textdatei, UTF-8 ohne BOM** – **kein XML**, kein ZIP. Zeilenbasiert.
- Dateiname-Konvention: `JJJJ-MM-TT-Ort-Zusatz.DSV7`, z. B. `2024-02-18-Berlin-Pr.DSV7`
  (`-Pr` = Wettkampfergebnisliste, `-Me` = Vereinsmeldeliste, `-Wk` = Wettkampfdefinitionsliste).
  Für den Import ist nur die Endung/der Inhalt relevant, der Dateiname selbst muss nicht
  geparst werden.
- Jede Datenzeile hat die Form `ELEMENTNAME:Attribut1;Attribut2;Attribut3;...;`
  (Element-Konstante am Zeilenanfang, gefolgt von `:`, danach mit `;` getrennte Attribute
  in fester Reihenfolge). Optionale Attribute ohne Wert bleiben leer, das Semikolon muss
  aber immer gesetzt sein (`;;` für ein leeres Pflicht-Trennfeld).
- Kommentarzeilen: `(* Kommentartext *)`. In der Praxis (EasyWk-Export) treten
  **inline-Kommentare am Zeilenende von Datenzeilen** auf, z. B.
  `WETTKAMPF: 1;E;1;1;100;F;GL;M;SW;;; (* 100m Freistil männlich *)` – der Parser muss
  also nicht nur reine Kommentarzeilen überspringen, sondern auch einen optionalen
  `(* ... *)`-Suffix nach der letzten Nutz-Angabe abschneiden.
- **Reale Exporte weichen minimal von den Beispielen im PDF ab**: EasyWk schreibt ein
  Leerzeichen nach dem Doppelpunkt (`FORMAT: Wettkampfergebnisliste;7;` statt
  `FORMAT:Wettkampfergebnisliste;7;`). Der Parser darf sich nicht auf exakte
  Zeichenpositionen verlassen, sondern muss beim ersten `:` splitten und trimmen.
- Datentypen: `Zeit` = `HH:MM:SS,hh` (z. B. `00:01:04,30`), `Datum` = `TT.MM.JJJJ`,
  `Uhrzeit` = `HH:MM` (24h), `JGAK` = Jahrgang (4-stellig) oder Altersklassen-Kürzel.
  Reale Kurzsprint-Zeiten können ohne führende Stunden/Minuten-Nullen als `M:SS,hh`
  auftreten (im Sample: `1:01,44` bzw. `0:30,00`) – der Zeit-Parser muss also tolerant
  gegenüber fehlenden führenden Segmenten sein, nicht nur strikt `HH:MM:SS,hh` erwarten.

### 1.2 Für den Import relevante Listenart: „Wettkampfergebnisliste"

Von den vier Listenarten (Wettkampfdefinitionsliste, Vereinsmeldeliste,
Vereinsergebnisliste, **Wettkampfergebnisliste**) ist für "Ergebnisse in die
Wettkampfansicht übernehmen" ausschließlich die **Wettkampfergebnisliste** relevant
(`Zusatz: -Pr` im Dateinamen, `FORMAT:Wettkampfergebnisliste;7;` als erstes Element).
Sie enthält bereits alle Vereine der Veranstaltung, nicht nur den eigenen. Vereinsmelde-/
Vereinsergebnislisten sind vor dem Wettkampf bzw. nur für einen Verein relevant und werden
hier nicht unterstützt (können aber strukturell fast identisch geparst werden, falls
später gewünscht).

Relevante Elemente der Wettkampfergebnisliste, in Vorkommensreihenfolge:

| Element | Vorkommen | Zweck für den Import |
|---|---|---|
| `FORMAT` | 1 | Erkennung: `Listart` muss `Wettkampfergebnisliste`, `Version` sollte `7` sein |
| `VERANSTALTUNG` | 1 | Name/Ort/Bahnlänge/Zeitmessung der Veranstaltung (Abgleich mit `Competition`) |
| `ABSCHNITT` | 1-N | Datum je Wettkampfabschnitt |
| `WETTKAMPF` | 1-N | Definiert eine Strecke: Nr., Art (V/Z/F/E/A/N), Distanz, Technik, Geschlecht, Staffel-Flag (`Anzahl Starter`) → Basis für Event-Mapping |
| `WERTUNG` | 1-N | Alterklassen-/Jahrgangs-Wertungsgruppen je Wettkampf (für den reinen Ergebnis-Import nicht zwingend nötig) |
| `VEREIN` | 1-N | Vereine der Veranstaltung inkl. DSV-Vereinskennzahl → zur Filterung auf den eigenen Verein |
| `PNERGEBNIS` | 0-N | **Einzelergebnis** einer Person in einem Wettkampf/einer Wertung |
| `PNZWISCHENZEIT` | 0-N | **Zwischenzeit** (Split) einer Einzelperson – im Sample nicht befüllt, aber Teil des Standards |
| `PNREAKTION` | 0-N | Reaktionszeit (optional, nicht Teil des MVP) |
| `STERGEBNIS` | 0-N | **Staffelergebnis** |
| `STAFFELPERSON` | 0-N | Besetzung einer Staffel (Startnummer je Schwimmer\*in innerhalb der Staffel) |
| `STZWISCHENZEIT` | 0-N | **Zwischenzeit** einer Staffel je Ablösung/Distanz |
| `STABLOESE` | 0-N | Reaktionszeit der Ablösung (optional) |
| `DATEIENDE` | 1 | Ende der Datei |

### 1.3 Feldlayout der import-relevanten Elemente

**`WETTKAMPF`** (definiert eine Strecke/einen Lauf):
`Wettkampfnr;Wettkampfart;Abschnittsnr;AnzahlStarter;Einzelstrecke;Technik;Ausübung;Geschlecht;ZuordnungBestenliste;QualifikationsWettkampfnr;QualifikationsWettkampfart;`

- `Wettkampfart`: `V`=Vorlauf, `Z`=Zwischenlauf, `F`=Finale, `E`=Entscheidung,
  `A`=Ausschwimmen, `N`=Nachschwimmen.
- `AnzahlStarter`: leer/1 = Einzelstrecke, >1 = Staffel (Anzahl der Staffelteilnehmer).
- `Einzelstrecke`: Meter (Integer).
- `Technik`: `F`=Freistil, `R`=Rücken, `B`=Brust, `S`=Schmetterling, `L`=Lagen, `X`=Sonderform.
- `Geschlecht`: `M`/`W`/`D`/`X` (gemischt).

Beispiel (real): `WETTKAMPF: 1;E;1;1;100;F;GL;M;SW;;; (* 100m Freistil männlich *)`

**`PNERGEBNIS`** (Einzelergebnis):
`Wettkampfnr;Wettkampfart;WertungsID;Platz;GrundNichtwertung;Name;DSV-ID;Veranstaltungs-ID;Geschlecht;Jahrgang;Altersklasse;Verein;Vereinskennzahl;Endzeit;DisqualifikationsBemerkung;ErhöhtesNachträglichesMeldegeld;Nationalität1;Nationalität2;Nationalität3;`

- `Platz` = `0`, wenn `GrundNichtwertung` gefüllt ist (`DS`=Disqualifikation, `NA`=nicht
  angetreten, `AB`=abgemeldet, `AU`=aufgegeben, `ZU`=Zeitüberschreitung).
- `Endzeit` ist dann `00:00:00,00` (Platzhalter, keine echte Zeit).
- `Name` = `Nachname, Vorname` (ein Feld, mit Komma getrennt).
- `DSV-ID` = 6-stellige bundesweit eindeutige Schwimmer-ID (`0`, falls unbekannt) – **der
  zuverlässigste Match-Schlüssel gegen einen lokalen Athleten**, falls dieser gepflegt wird.

Beispiel (real):
`PNERGEBNIS: 1;E;1001;1;;Katzschke, Jan;404306;149;M;2009;;BSV "Friesen 1895" e.V.;5611;00:01:04,30;;;;;; (* 2009/2010 *)`

**`PNZWISCHENZEIT`** (Zwischenzeit Einzelperson):
`Veranstaltungs-ID;Wettkampfnr;Wettkampfart;Distanz;Zwischenzeit;`

**`STERGEBNIS`** (Staffelergebnis):
`Wettkampfnr;Wettkampfart;WertungsID;Platz;GrundNichtwertung;NummerMannschaft;Veranstaltungs-ID Staffel;Verein;Vereinskennzahl;Endzeit;StartnummerDisqualifiziert;DisqualifikationsBemerkung;ErhöhtesNachträglichesMeldegeld;`

Beispiel (real, disqualifiziert):
`STERGEBNIS: 26;E;26001;0;NA;1;154;SG Schöneberg, Berlin e. V.;5623;00:00:00,00;;;; (* 2009 - 2012 *)`

**`STAFFELPERSON`** (Besetzung einer Staffel):
`Veranstaltungs-ID Staffel;Wettkampfnr;Wettkampfart;Name;DSV-ID;Startnummer;Geschlecht;Jahrgang;Altersklasse;Nationalität1;Nationalität2;Nationalität3;`

**`STZWISCHENZEIT`** (Zwischenzeit Staffel je Ablöser\*in):
`Veranstaltungs-ID Staffel;Wettkampfnr;Wettkampfart;Startnummer;Distanz;Zwischenzeit;`

### 1.4 Konsequenzen für den Parser

1. Zeilenweiser Parser, kein XML/DOM nötig. Schritte: Zeile trimmen → Kommentarzeilen
   (beginnt mit `(*`) verwerfen → inline-`(* ... *)`-Suffix abschneiden → am ersten `:`
   splitten → Rest an `;` splitten (Achtung: `Name` kann ein Komma, aber laut Spec kein
   `;` enthalten – Split an `;` ist also sicher) → Attribute trimmen.
2. Encoding: strikt UTF-8 einlesen; die Beispieldatei zeigte, dass falsches Encoding
   (Latin-1-Fehlinterpretation) zu kaputten Umlauten führt – im Browser über
   `file.text()` mit explizitem UTF-8 sollte das kein Problem sein, aber sollte im
   Import-Preview stichprobenartig sichtbar/prüfbar sein.
3. Zeit-Parser muss `HH:MM:SS,hh`, `MM:SS,hh` und `SS,hh` akzeptieren (führende
   Nullen/Segmente können in der Praxis fehlen), Komma als Dezimaltrennzeichen für
   Hundertstel.
4. Ein Import-Lauf muss **zwei Pässe** über die Datei machen (oder Referenzen
   zwischenspeichern): `WETTKAMPF`- und `VEREIN`-Elemente stehen vor den zugehörigen
   `PNERGEBNIS`/`STERGEBNIS`-Zeilen, aber Zwischenzeiten (`PNZWISCHENZEIT`/
   `STZWISCHENZEIT`) referenzieren nur die `Veranstaltungs-ID`, die erst im `PNERGEBNIS`
   mit dem Namen verknüpft wird – ein Streaming-Parser mit Lookup-Maps
   (`veranstaltungsId → {name, dsvId, ...}`, `wettkampfnr → {distanz, technik, ...}`)
   reicht aus, ein echtes 2-Pass-Verfahren ist nicht zwingend nötig, macht die
   Zuordnung aber robuster gegen Abweichungen von der Elementreihenfolge (die der
   Standard als "in Ausnahmefällen zulässig" beschreibt).
5. Nur Ergebnisse des **eigenen Vereins** interessieren uns: Filterung über den
   `VEREIN`/`Vereinskennzahl`-Bezug in `PNERGEBNIS`/`STERGEBNIS`. **Entschieden**: `Club`
   erhält ein generisches `nationalID`/`nationalIDType`-Feldpaar (Abschnitt 3.1). Ist
   `nationalIDType` auf `DSV` gesetzt, wird `Vereinskennzahl` automatisch dagegen
   gematcht; ohne Treffer (kein `nationalID` hinterlegt, abweichender Typ, oder keine
   Übereinstimmung in der Datei) fällt der Import auf eine manuelle Vereinsauswahl im
   Vorschau-Dialog zurück (Liste aller `VEREIN`-Einträge der Datei, robuster gegen
   Schreibweisen-Unterschiede).

### 1.5 Lenex (zurückgestellt auf spätere Erweiterung)

Lenex ist im Gegensatz zu DSV7 eine **ZIP-Datei mit einer XML-Datei** (`.lef`), mit
international standardisiertem Schema (MEET → SESSIONS → EVENTS → HEATS,
CLUBS → ATHLETES → RESULTS, RESULT trägt `swimtime`, `place`, `SPLIT`-Kindelemente für
Zwischenzeiten). Da kein XML/ZIP-Parsing-Package im Projekt vorhanden ist, könnte ein
künftiger Lenex-Import im Browser mit `DecompressionStream('deflate-raw')` (nativ,
keine Bibliothek nötig) + einem kleinen selbstgeschriebenen ZIP-Local-File-Header-Reader
+ `DOMParser` umgesetzt werden.

**Entschieden**: Für den Lenex-Import liegt aktuell keine Testdatei vor. Er wird daher
**nicht** in der ersten Umsetzung implementiert, sondern als zukünftige Erweiterung
zurückgestellt. Damit der spätere Anschluss ohne Umbau möglich ist, wird die
Parser-Schnittstelle von Anfang an formatunabhängig gehalten: Ein Parser ist eine
Funktion `parseResultFile(fileBytes, format) → ImportedResult[]` (Abschnitt 4), DSV7 ist
die erste (und vorerst einzige) konkrete Implementierung dieser Signatur. Matching,
Overwrite-Logik und UI hängen nur vom gemeinsamen `ImportedResult[]`-Zwischenformat ab,
nicht vom Quellformat – ein Lenex-Parser mit gleicher Signatur kann später ergänzt
werden, ohne dass Matching/UI angefasst werden müssen.

## 2. Architektur-Ausgangslage im Repo

- **Fastify + Prisma** Backend (`apps/api`), **Vanilla-JS ohne Build-Schritt** Frontend
  (`apps/web`). Kein Bundler → npm-Pakete lassen sich im Browser nicht ohne Weiteres
  einbinden; für DSV7 auch nicht nötig (reiner Text-Parser), für Lenex per nativer
  Browser-API statt npm-Paket (siehe 1.5).
- **Sync-API ist der einzige Schreibpfad** (`docs/backend-plan.md:306`): Es gibt keine
  granularen REST-Endpunkte pro Ressource. `POST /api/sync/push` /
  `GET /api/sync/pull`, validiert gegen `ENTITY_SCHEMAS` (Zod, `.strict()`) in
  `packages/shared-types/src/entities.ts`. Der Import sollte **client-seitig parsen**
  und über die bestehende IndexedDB (`apps/web/js/db.js`) + Sync-Queue schreiben,
  keinen serverseitigen Upload-Endpunkt einführen.
- **Konfliktauflösung**: `packages/sync-protocol/src/conflictResolution.ts` definiert für
  den Store `results` explizit `never-overwrite` – bei einem serverseitigen Konflikt
  (Server-Version neuer als der Stand, den der Client kennt) wird ein neuer Datensatz
  angelegt statt zu überschreiben. Das steht der gewünschten "Ergebnisse werden
  überschrieben"-Semantik entgegen und muss behandelt werden (siehe Abschnitt 5).
- **Kein Kommentarfeld auf `Result`**: `CommentSchema` existiert bereits (verwendet bei
  `Exercise`, `Plan`, Trainings-Sets), aber nicht bei `Result`. „Kommentare bleiben
  erhalten" setzt voraus, dass ein solches Feld zuerst eingeführt wird.
- **Kein Zwischenzeiten-Modell**: `Result.laps` ist aktuell die Stoppuhr-Funktion
  (kumulierte Sekunden je Bahn), semantisch nicht dasselbe wie DSV7/Lenex-Splits
  (Distanz + Zeit, ggf. mit Staffel-Ablöser-Bezug).
- **Event-Referenzliste ist unvollständig**: `apps/web/js/refdata.js` (`EVENTS`, 17
  Einträge) kennt nur Einzelstrecken, keine Staffeln – DSV7-Wettkämpfe mit
  `AnzahlStarter > 1` (Staffeln) treffen aktuell auf keinen passenden `event`-String.
- **Kein Personen-/Vereins-Identifier für externen Abgleich**: Weder `Club` noch
  `Athlete` haben aktuell ein Feld für eine externe Kennung (DSV-Vereinskennzahl,
  DSV-ID Schwimmer\*in, o. ä.) – nötig, um Import-Zeilen zuverlässiger als nur über
  Namensgleichheit zuzuordnen.

## 3. Datenmodell-Erweiterungen (Voraussetzung)

### 3.1 Externe Kennungen für Verein und Athlet\*in (**entschieden**)

Statt eines DSV-spezifischen Feldes wird ein generisches, wiederverwendbares Paar
eingeführt, das auch andere nationale/internationale Verbands-IDs abdeckt
(z. B. FINA, SwimRankings, künftige Lenex-Lizenznummern):

- **`Club.nationalID: string?`**, **`Club.nationalIDType: string?`** (z. B.
  `nationalIDType = "DSV"`, `nationalID = "1234"` für die 4-stellige
  DSV-Vereinskennzahl). Beide optional, im Vereins-Stammdatenformular pflegbar.
- **`Athlete.nationalID: string?`**, **`Athlete.nationalIDType: string?`** (z. B.
  `nationalIDType = "DSV"`, `nationalID = "404306"` für die 6-stellige DSV-ID
  Schwimmer\*in). Beide optional, im Athlet\*innen-Stammdatenformular pflegbar.

Prisma-Migration (zwei nullable String-Spalten je Modell) + Zod-Felder in
`ClubSchema`/`AthleteSchema` (`entities.ts`).

Verwendung beim Import: Ist `nationalIDType === 'DSV'` und `nationalID` gesetzt, wird
zuerst darüber gematcht (`PNERGEBNIS.DSV-ID` bzw. `VEREIN.Vereinskennzahl`) – das ist
robuster als Namensabgleich, insbesondere bei Namensgleichheit. Ohne Treffer wird auf
Name(+Geburtsjahr) zurückgefallen bzw. beim Verein auf manuelle Auswahl (siehe 1.4.5).

### 3.2 `Result.comments`

JSON-Array, `CommentSchema`, analog `Exercise.comments`: Prisma-Migration + Zod-Feld in
`entities.ts` + Erweiterung von `COMMENT_BEARING_STORES` in
`sync.commentAuthorship.ts` um `'results'` + Case in `collectCommentGroups`.

### 3.3 `Result.splits`

Neues, eigenständiges JSON-Feld für importierte Zwischenzeiten, getrennt von `laps`:
`{ distanceM: number, time: number, legIndex?: number }[]`. `legIndex` wird für
Staffel-Zwischenzeiten aus `STZWISCHENZEIT.Startnummer` übernommen, bei Einzelstrecken
weggelassen.

### 3.4 `Result.status` / `Result.statusNote` (**entschieden**)

Neues Statusfeld statt Kommentar/Notiz für Disqualifikation & Co.:

- **`Result.status: 'OK' | 'DS' | 'NA' | 'AB' | 'AU' | 'ZU'`**, Default `'OK'` – direkte
  Übernahme der DSV7-Codes für „Grund der Nichtwertung" (`DS`=Disqualifikation,
  `NA`=nicht angetreten, `AB`=abgemeldet, `AU`=aufgegeben, `ZU`=Zeitüberschreitung),
  damit sowohl DSV7 als auch ein künftiger Lenex-Import (dort inhaltlich äquivalente
  Codes) ohne Übersetzungstabelle abbildbar sind.
- **`Result.statusNote: string?`** – für `DisqualifikationsBemerkung`.
- Ist `status !== 'OK'`, wird `time` beim Import auf `null` gesetzt (nicht die
  Platzhalterzeit `00:00:00,00` aus der Datei übernehmen); die UI zeigt entsprechend
  ein Status-Badge statt einer Zeit.
- Prisma-Migration + Zod-Feld in `entities.ts`.

### 3.5 Event-Referenzliste erweitern + interaktive Zuordnung (**entschieden**)

- `EVENTS` in `refdata.js` um Staffeln ergänzen (Format z. B. `"4x100 Freistil"`) und
  eine Mapping-Tabelle `{ technik: 'F'|'R'|'B'|'S'|'L', distanz: number, isRelay: boolean }
  → event-String` aufbauen, die von DSV7-`WETTKAMPF`-Daten gespeist wird.
- Für Wettkämpfe aus der Importdatei, die auf **kein** bestehendes Event gemappt werden
  können, entscheidet die Nutzerin/der Nutzer pro Wettkampf im Vorschau-Dialog
  zwischen drei Optionen: **(a)** einem bestehenden Event manuell zuordnen (Dropdown
  über `EVENTS`), **(b)** ein neues Event anlegen (wird der `EVENTS`-Liste
  hinzugefügt), oder **(c)** den Wettkampf/die zugehörigen Ergebniszeilen beim Import
  ignorieren. Diese Zuordnung wird für die Dauer des Imports zwischengespeichert, damit
  sie nicht pro Ergebniszeile wiederholt werden muss (Gruppierung nach
  `WETTKAMPF`-Nummer).

### 3.6 Konfliktstrategie für `results` anpassen

`packages/sync-protocol/src/conflictResolution.ts`: Entweder (a) der Import holt sich
vor dem Schreiben per `pull` den aktuellsten Stand, sodass kein echter Konflikt
entsteht, oder (b) eine feinere Strategie „Zeit/Platz/Splits/Status überschreiben,
`comments` feldweise mergen" wird ergänzt. Empfehlung: (a) als Basisverhalten, (b) als
Absicherung für den Fall, dass zwischen Pull und Push noch jemand ein Ergebnis ändert.

## 4. Gemeinsames Zwischenformat (Parser-Output)

Beide Parser (DSV7, Lenex) erzeugen dieselbe Zwischenstruktur, damit Matching/Overwrite/
UI formatunabhängig bleiben:

```ts
interface ImportedResult {
  athleteMatchHint: {
    name: string;               // "Nachname, Vorname"
    nationalIDType?: string;     // z. B. "DSV" — DSV7: konstant "DSV"
    nationalID?: string;         // DSV7: PNERGEBNIS.DSV-ID (0 → undefined)
    birthYear?: number;
    gender?: 'M' | 'W' | 'D';
  };
  eventCode: { distanceM: number; stroke: 'F'|'R'|'B'|'S'|'L'|'X'; isRelay: boolean; relaySize?: number };
  round: 'V'|'Z'|'F'|'E'|'A'|'N';  // Wettkampfart / heat-round
  time: number | null;              // Sekunden, null wenn status !== 'OK'
  place: number | null;
  status: 'OK' | 'DS' | 'NA' | 'AB' | 'AU' | 'ZU';   // Result.status, s. Abschnitt 3.4
  statusNote?: string;                                // Result.statusNote
  splits: { distanceM: number; time: number; legIndex?: number }[];
  clubName: string;
  clubNationalIDType?: string;  // z. B. "DSV"
  clubNationalID?: string;      // DSV7: VEREIN.Vereinskennzahl (0 → undefined)
}

// Format-agnostischer Parser-Vertrag, s. Abschnitt 1.5:
type ResultFileFormat = 'dsv7' | 'lenex';
declare function parseResultFile(fileBytes: ArrayBuffer, format: ResultFileFormat): ImportedResult[];
// Erste Implementierung: nur 'dsv7'. 'lenex' wirft vorerst "not implemented".
```

## 5. Matching- und Overwrite-Logik

1. **Verein filtern**: Automatisch über `Club.nationalID`/`nationalIDType` gegen
   `clubNationalID`/`clubNationalIDType` (Abschnitt 3.1); ohne Treffer manuelle Auswahl
   im Vorschau-Dialog (Abschnitt 1.4.5). Nur `ImportedResult`s des so bestimmten
   Vereins werden weiterverarbeitet.
2. **Athlet matchen**: zuerst über `Athlete.nationalID`/`nationalIDType` gegen
   `athleteMatchHint.nationalID`/`nationalIDType`, falls beide gepflegt sind. Kein
   Treffer darüber → Fallback auf Name (+ Geburtsjahr zur Disambiguierung bei
   Namensgleichheit). Weiterhin kein Treffer → Zeile als „nicht zuordenbar" markieren,
   kein automatisches Anlegen neuer Athlet\*innen.
3. **Event matchen**: über die Mapping-Tabelle aus Abschnitt 3.5. Kein automatischer
   Treffer → interaktive Auflösung durch die Nutzerin/den Nutzer im Vorschau-Dialog:
   bestehendem Event zuordnen, neues Event anlegen, oder Wettkampf ignorieren
   (Abschnitt 3.5).
4. **Bestehendes `Result` finden**: Match über `(clubId, athleteId, competitionId, event)`.
   Treffer → Update-Kandidat. Kein Treffer → Neuanlage.
5. **Felder überschreiben**: `time`, `place` (**immer** aus der Datei übernehmen, auch
   bei Abweichung von einer lokal berechneten Platzierung), `status`, `statusNote`,
   `splits`, `date`/`course` (falls von der Veranstaltung abweichend). Bei
   `status !== 'OK'` wird `time` auf `null` gesetzt statt der Platzhalterzeit
   `00:00:00,00` aus der Datei.
6. **Felder erhalten**: `comments`, `id`, `createdAt`.
7. **`isPB`**: wird lokal aus der Ergebnis-Historie berechnet – nach Import neu
   berechnen statt aus der Datei zu übernehmen (die Datei kennt kein „PB"-Konzept); bei
   `status !== 'OK'` ist `isPB` immer `false`.

Technisch: kein `bulkPut` (sync-still, siehe `db.js`), sondern gezielte `put()`-Aufrufe
bzw. Sync-Events mit `action: 'update'` für Treffer und `action: 'create'` für neue
Ergebnisse, damit Konfliktauflösung/History korrekt greifen.

## 6. UI/UX in der Wettkampfansicht

Einstiegspunkt: `apps/web/js/modules/competitions.js`, `renderDetail()`
(Ergebnisse-Card, neben „Ergebnis hinzufügen").

1. Button „Ergebnisse importieren (DSV7)" → verstecktes `<input type="file"
   accept=".dsv7">` (Lenex ist zurückgestellt, siehe 1.5 – Button/Dateiauswahl daher
   vorerst nur für `.dsv7`, aber Wortlaut/UI so gestaltet, dass ein zweiter Dateityp
   später ergänzbar ist, ohne den Flow umzubauen).
2. Datei einlesen (`file.text()`, UTF-8) und mit `parseResultFile(bytes, 'dsv7')`
   parsen (Abschnitt 4).
3. **Vereinserkennung**: automatisch über `Club.nationalID`/`nationalIDType` (Abschnitt
   3.1/5.1); bei Treffer direkt übernehmen und im Dialog nur zur Bestätigung anzeigen,
   sonst Dropdown mit allen `VEREIN`-Einträgen aus der Datei zur manuellen Auswahl.
4. **Event-Auflösung**: für jeden Wettkampf aus der Datei, der nicht automatisch auf
   ein bestehendes Event gemappt werden kann, eine Zeile mit den drei Optionen aus
   Abschnitt 3.5 (bestehendem Event zuordnen / neues Event anlegen / ignorieren)
   anzeigen, bevor die Ergebnis-Vorschau gerendert wird.
5. **Vorschau-Modal**: Liste aller erkannten Ergebnisse mit Status
   („neu" / „wird überschrieben: alte Zeit X → neue Zeit Y" / „disqualifiziert/nicht
   angetreten (Status-Badge)" / „nicht zuordenbar – wird übersprungen"), Anzahl
   betroffener Kommentare, die erhalten bleiben.
6. Bestätigung → Import ausführen, Fehler-/Konfliktzeilen am Ende zusammengefasst
   anzeigen.
7. Kein automatisches Löschen von Ergebnissen, die in der Datei fehlen (nur
   Update/Insert, kein Sync-Delete).

## 7. Implementierungsreihenfolge

1. Datenmodell (Abschnitt 3): Migration + Zod für `Club.nationalID`/`nationalIDType`,
   `Athlete.nationalID`/`nationalIDType`, `Result.comments`, `Result.splits`,
   `Result.status`/`statusNote`; Comment-Authorship-Erweiterung um `'results'`;
   Event-Mapping-Tabelle inkl. Staffeln in `refdata.js`.
2. Konfliktstrategie-Anpassung in `sync-protocol` für `results`.
3. Stammdaten-UI: Felder für `nationalID`/`nationalIDType` in Vereins- und
   Athlet\*innen-Formularen ergänzen (Voraussetzung, damit die automatische
   Zuordnung beim Import überhaupt greifen kann).
4. DSV7-Parser (Zeilenparser wie in Abschnitt 1 beschrieben, Signatur
   `parseResultFile(bytes, 'dsv7')` aus Abschnitt 4) + Unit-Tests gegen die reale
   Beispieldatei.
5. Matching- und Overwrite-Logik als eigenständiges, testbares Modul (unabhängig von
   der UI): Vereins-/Athlet-Matching über `nationalID` mit Fallback, Event-Auflösung,
   Overwrite-Regeln aus Abschnitt 5.
6. UI: Button, Datei-Handling, Vereinserkennung/-auswahl, Event-Auflösungsschritt,
   Vorschau-Modal, Bestätigung, Fehleranzeige (Abschnitt 6).
7. Manuelle Tests mit der echten DSV7-Beispieldatei.
8. **Zurückgestellt**: Lenex-Parser (`parseResultFile(bytes, 'lenex')`) als spätere
   Erweiterung, sobald Testdateien vorliegen (Abschnitt 1.5) – Matching/Overwrite/UI
   sind bereits jetzt formatunabhängig gehalten und müssen dafür nicht geändert werden.

## 8. Entscheidungen

Alle ursprünglich offenen Fragen wurden geklärt und sind oben in den jeweiligen
Abschnitten eingearbeitet; hier zur Übersicht:

| # | Frage | Entscheidung | Umgesetzt in |
|---|---|---|---|
| 1 | Automatische Vereinsfilterung? | `Club.nationalID`/`nationalIDType` ergänzen | 3.1, 1.4.5, 5.1 |
| 2 | Umgang mit unbekannten Events? | Interaktiv: zuordnen, neu anlegen, oder ignorieren | 3.5, 5.3, 6.4 |
| 3 | Athlet-Matching über DSV-ID? | `Athlete.nationalID`/`nationalIDType` ergänzen | 3.1, 5.2 |
| 4 | Abbildung von DQ/NA/AB/AU/ZU? | Neues Statusfeld `Result.status`/`statusNote` | 3.4, 4, 5.5 |
| 5 | `place` immer aus Datei übernehmen? | Ja, immer | 5.5 |
| 6 | Lenex-Testdaten? | Lenex als spätere Erweiterung zurückgestellt, Parser-Schnittstelle bereits formatunabhängig | 1.5, 4, 7 |
