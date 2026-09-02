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
   `VEREIN`/`Vereinskennzahl`-Bezug in `PNERGEBNIS`/`STERGEBNIS`. Voraussetzung: Der
   Club im lokalen System muss (mindestens optional) eine DSV-Vereinskennzahl und/oder
   einen exakten Vereinsnamen zum Abgleich hinterlegt haben – aktuell nicht Teil des
   Datenmodells (`Club`/`clubId`), muss ggf. ergänzt werden. Alternativ: Der Nutzer
   wählt den passenden Verein aus der Datei interaktiv im Vorschau-Dialog aus (robuster
   gegen Schreibweisen-Unterschiede, kein neues Pflichtfeld nötig – empfohlen als MVP).

### 1.5 Lenex (zum Vergleich)

Lenex ist im Gegensatz zu DSV7 eine **ZIP-Datei mit einer XML-Datei** (`.lef`), mit
international standardisiertem Schema (MEET → SESSIONS → EVENTS → HEATS,
CLUBS → ATHLETES → RESULTS, RESULT trägt `swimtime`, `place`, `SPLIT`-Kindelemente für
Zwischenzeiten). Da kein XML/ZIP-Parsing-Package im Projekt vorhanden ist (siehe unten),
kann der Lenex-Import im Browser mit `DecompressionStream('deflate-raw')` (nativ,
keine Bibliothek nötig) + einem kleinen selbstgeschriebenen ZIP-Local-File-Header-Reader
+ `DOMParser` umgesetzt werden. Die Kernlogik (Matching, Overwrite, UI) wird zwischen
DSV7- und Lenex-Import geteilt; nur die Parser unterscheiden sich, beide münden in
dasselbe Zwischenformat (siehe Abschnitt 4).

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

## 3. Datenmodell-Erweiterungen (Voraussetzung)

1. **`Result.comments`** (JSON-Array, `CommentSchema`, analog `Exercise.comments`):
   Prisma-Migration + Zod-Feld in `entities.ts` + Erweiterung von
   `COMMENT_BEARING_STORES` in `sync.commentAuthorship.ts` um `'results'` + Case in
   `collectCommentGroups`.
2. **`Result.splits`** (neues, eigenständiges JSON-Feld für importierte Zwischenzeiten,
   getrennt von `laps`): `{ distanceM: number, time: number, legIndex?: number }[]`.
   `legIndex` wird für Staffel-Zwischenzeiten aus `STZWISCHENZEIT.Startnummer`
   übernommen, bei Einzelstrecken weggelassen.
3. **Event-Referenzliste erweitern**: `EVENTS` in `refdata.js` um Staffeln ergänzen
   (Format z. B. `"4x100 Freistil"`) und eine Mapping-Tabelle
   `{ technik: 'F'|'R'|'B'|'S'|'L', distanz: number, isRelay: boolean } → event-String`
   aufbauen, die von DSV7-`WETTKAMPF`- und (perspektivisch) Lenex-`SWIMSTYLE`-Daten
   gespeist wird.
4. **Konfliktstrategie für `results` anpassen**
   (`packages/sync-protocol/src/conflictResolution.ts`): Entweder (a) der Import holt
   sich vor dem Schreiben per `pull` den aktuellsten Stand, sodass kein echter Konflikt
   entsteht, oder (b) eine feinere Strategie „Zeit/Platz/Splits überschreiben,
   `comments` feldweise mergen" wird ergänzt. Empfehlung: (a) als Basisverhalten, (b)
   als Absicherung für den Fall, dass zwischen Pull und Push noch jemand ein Ergebnis
   ändert.

## 4. Gemeinsames Zwischenformat (Parser-Output)

Beide Parser (DSV7, Lenex) erzeugen dieselbe Zwischenstruktur, damit Matching/Overwrite/
UI formatunabhängig bleiben:

```ts
interface ImportedResult {
  athleteMatchHint: {
    name: string;        // "Nachname, Vorname"
    dsvId?: string;       // DSV7: PNERGEBNIS.DSV-ID / Lenex: ATHLETE license/id
    birthYear?: number;
    gender?: 'M' | 'W' | 'D';
  };
  eventCode: { distanceM: number; stroke: 'F'|'R'|'B'|'S'|'L'|'X'; isRelay: boolean; relaySize?: number };
  round: 'V'|'Z'|'F'|'E'|'A'|'N';  // Wettkampfart / heat-round
  time: number | null;              // Sekunden, null bei DNS/DQ/AB/AU
  place: number | null;
  disqualified: { reason: string; note?: string } | null;
  splits: { distanceM: number; time: number; legIndex?: number }[];
  clubName: string;
  clubDsvId?: string;
}
```

## 5. Matching- und Overwrite-Logik

1. **Verein filtern**: Nur `ImportedResult`s des eigenen Vereins verarbeiten (Auswahl im
   Vorschau-Dialog, siehe 1.4 Punkt 5).
2. **Athlet matchen**: gegen lokale `Athlete`-Liste über Name (+ Geburtsjahr zur
   Disambiguierung bei Namensgleichheit). Kein Treffer → Zeile als „nicht zuordenbar"
   markieren, kein automatisches Anlegen neuer Athlet\*innen.
3. **Event matchen**: über die Mapping-Tabelle aus Abschnitt 3.3. Kein Treffer → Zeile
   markieren, nicht importieren.
4. **Bestehendes `Result` finden**: Match über `(clubId, athleteId, competitionId, event)`.
   Treffer → Update-Kandidat. Kein Treffer → Neuanlage.
5. **Felder überschreiben**: `time`, `place`, `splits`, `date`/`course` (falls von der
   Veranstaltung abweichend).
6. **Felder erhalten**: `comments`, `id`, `createdAt`.
7. **Zu klären**: `isPB` wird lokal aus der Ergebnis-Historie berechnet – nach Import
   neu berechnen statt aus der Datei übernehmen (die Datei kennt kein „PB"-Konzept).
   Bei `disqualified` (Grund `DS`/`NA`/`AB`/`AU`/`ZU`): `time` auf `null`/leer setzen
   statt `00:00:00,00` zu übernehmen, Grund ggf. in einem neuen `Result.dnsReason`-Feld
   oder als System-Kommentar ablegen (Entscheidung siehe offene Fragen).

Technisch: kein `bulkPut` (sync-still, siehe `db.js`), sondern gezielte `put()`-Aufrufe
bzw. Sync-Events mit `action: 'update'` für Treffer und `action: 'create'` für neue
Ergebnisse, damit Konfliktauflösung/History korrekt greifen.

## 6. UI/UX in der Wettkampfansicht

Einstiegspunkt: `apps/web/js/modules/competitions.js`, `renderDetail()`
(Ergebnisse-Card, neben „Ergebnis hinzufügen").

1. Button „Ergebnisse importieren (DSV7/Lenex)" → verstecktes
   `<input type="file" accept=".dsv7,.lef,.lxf,.zip">`.
2. Datei einlesen (`arrayBuffer()`), Format anhand Endung/Inhalt erkennen (DSV7: Text
   beginnt i. d. R. mit `(*` oder `FORMAT:`; Lenex: ZIP-Magic-Bytes `PK`), passenden
   Parser aufrufen.
3. Bei DSV7: Vereinsauswahl anzeigen (Liste aller `VEREIN`-Einträge aus der Datei),
   Nutzer wählt den eigenen Verein.
4. **Vorschau-Modal**: Liste aller erkannten Ergebnisse mit Status
   („neu" / „wird überschrieben: alte Zeit X → neue Zeit Y" / „nicht zuordenbar –
   wird übersprungen"), Anzahl betroffener Kommentare, die erhalten bleiben.
5. Bestätigung → Import ausführen, Fehler-/Konfliktzeilen am Ende zusammengefasst
   anzeigen.
6. Kein automatisches Löschen von Ergebnissen, die in der Datei fehlen (nur
   Update/Insert, kein Sync-Delete).

## 7. Implementierungsreihenfolge

1. Datenmodell (Abschnitt 3): Migration, Zod, Comment-Authorship-Erweiterung,
   Splits-Feld, Event-Mapping-Tabelle.
2. Konfliktstrategie-Anpassung in `sync-protocol`.
3. DSV7-Parser (Zeilenparser wie in Abschnitt 1 beschrieben) + Unit-Tests gegen die
   reale Beispieldatei.
4. Lenex-Parser (ZIP+XML).
5. Matching- und Overwrite-Logik als eigenständiges, testbares Modul (unabhängig von
   der UI).
6. UI: Button, Datei-Handling, Vereinsauswahl, Vorschau-Modal, Bestätigung,
   Fehleranzeige.
7. Manuelle Tests mit echten Beispieldateien beider Formate.

## 8. Offene Fragen

1. Soll die DSV-Vereinskennzahl im lokalen `Club`-Modell hinterlegt werden (für
   automatische Vereinsfilterung), oder reicht die manuelle Auswahl im Vorschau-Dialog
   (empfohlen als MVP, kein Datenmodell-Zusatz nötig)?
   Entscheidung: Füge eine Vereinskennzahl (`nationalID`) ergänzt um einen Formathinweis (`nationalIDType`).
   Damit können auch andere nationale oder internationale IDs erfasst werden.
2. Sollen unbekannte/nicht zuordenbare Events automatisch der `EVENTS`-Liste hinzugefügt
   werden dürfen, oder ausschließlich manuell gepflegt werden?
   Entscheidung: Unbekannte/nicht zuordenbare Events sollen nach Nutzerentscheid entweder einem
   bestehenden Event zugeordnet werden, ein neues Event angelegt werden, oder ignoriert werden.
3. Was passiert mit DSV-ID-Feldern (`PNERGEBNIS.DSV-ID`)? Soll `Athlete` künftig eine
   DSV-ID-Spalte erhalten, um Namens-Mehrdeutigkeiten robuster aufzulösen?
   Entscheidung: Füge eine Athletenkennzahl (`nationalID`) ergänzt um einen Formathinweis (`nationalIDType`).
4. Wie soll ein disqualifiziertes/nicht angetretenes Ergebnis (`Grund der Nichtwertung`)
   im lokalen Modell abgebildet werden – neues Statusfeld auf `Result`, oder Kommentar/
   Notiz?
   Entscheidung: Neues Statusfeld
5. Soll `place` immer aus der Datei übernommen werden, auch wenn er von der lokal
   berechneten Platzierung abweicht?
   Entscheidung: Immer aus der Datei übernehmen.
6. Woher kommen Testdateien für den Lenex-Import (bisher nur eine DSV7-Beispieldatei
   verfügbar)?
   Entscheidung: Lenex-Import als zukünftige Erweiterung (Schnittstelle bzw. Funktion mit gleicher Signatur) betrachten.
