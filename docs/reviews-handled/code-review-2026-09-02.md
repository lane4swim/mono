# Code-Review — Redundanzen, Schwachstellen, Ineffizienzen, Codepraxis (2. September 2026)

**Auftrag.** Durchgehendes Code-Review über das gesamte Repository
(`apps/api`, `apps/web`, `packages/*`, `scripts/`, CI) mit Blick auf
**Redundanzen**, **Schwachstellen**, **Ineffizienzen** und
**unterdurchschnittliche Codepraxis**.

**Abgrenzung zu den Vorreviews.** Die Codebasis trägt bereits vier
Sicherheitsreviews (`security-review-2026-08*.md`), ein Code-Review
(`code-review-2026-08.md`), ein Wartbarkeitsreview
(`code-review-wartbarkeit-2026-08.md`), einen Performance-Durchgang
(Commit `332ee7a`) und das Review vom 30.08.2026
(`review-sicherheit-effizienz-usability-2026-08-30.md`). **Kein Befund
hier ist eine Wiederholung.** Der Schwerpunkt liegt auf dem seither
hinzugekommenen Code — dem DSV7-Ergebnisimport (PR #43,
`apps/web/js/resultsImport/*`, `modules/resultsImportUI.js`, die neuen
Felder in `packages/shared-types/src/entities.ts`) und
`scripts/setup-netcup.sh` (PR #39) — sowie auf den Nahtstellen, an denen
dieser neue Code auf bestehende, bislang für sich genommen korrekte Logik
trifft.

**Ergebnis vorweg.** Die harten serverseitigen Kontrollen halten: kein
Befund erlaubt Kontoübernahme, Rechteausweitung über die API oder einen
Mandantendurchbruch. Die Guard-Kette in `sync.service.ts`, die
Rollen-/Modul-Matrix in `sync.permissions.ts`, die Fremdschlüsselprüfung
und die Athlet:innen-Redaktion beim Pull wurden gegengelesen und sind
schlüssig.

Die schwerwiegendsten Befunde sind **stiller Datenverlust**: **K1** und
**K3** erzeugen Datensätze, die lokal gespeichert und der Person als
„gespeichert" gemeldet werden, die der Server aber **niemals** annehmen
kann — sie laufen durch fünf Push-Versuche und landen dann als `failed` in
einer Warteschlange, die niemand ansieht. **K2** entwertet die
PB-Erkennung dauerhaft, und zwar ausgelöst durch genau das Feature, das
gerade dazugekommen ist.

**Update (2. September 2026, im Anschluss an dieses Review).** **Alle 13
Befunde sind behoben** — siehe die jeweiligen **Fix**-Abschnitte. Jeder
Fix trägt einen eigenen, neuen Regressionstest; **K1**, **K2**, **K4**,
**D1**, **D2** und **P5** wurden zusätzlich vor UND nach dem jeweiligen
Fix per tatsächlichem Ausführen verifiziert (siehe **Prüfstand** unten),
nicht nur über die neuen Tests.

**Prüfstand (nach allen Fixes).** `npm install` sauber, `npm audit
--omit=dev` ohne Befund. Tests: `apps/web` 219 (vormals 195 vor jedem
Fix, +24 neue Regressionstests über beide Fix-Runden), `packages/
shared-types` 148, `packages/sync-protocol` 9, `apps/api` 482 von 482
grün (vormals 475 von 477 — die zuvor roten zwei sind **P5**, jetzt
mitbehoben, siehe dortiger Fix-Abschnitt) — alle vier Workspaces
vollständig grün, keine übrig gebliebenen Umgebungsartefakte. `eslint`
über alle Workspaces sauber (`db.js`s UUID-Ausweichpfad aus dem
K1–K4-Durchgang musste dafür bitweise Operatoren durch arithmetisch
äquivalente Ausdrücke ersetzen — das Projekt verbietet `no-bitwise`
projektweit, siehe `packages/shared-config/eslint-preset.cjs`; die
Äquivalenz ist per erschöpfender Prüfung über alle 256 Bytewerte
verifiziert). `bash -n` für beide Setup-Skripte sauber; **D1**/**D2**
zusätzlich gegen eine echte lokale PostgreSQL-Instanz verifiziert (siehe
dortiger Fix-Abschnitt) — kein reiner Lesetest des Diffs.

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

| Nr. | Kurz | Schwere | Ort | Status |
|-----|------|---------|-----|--------|
| K1 | Importierte Zwischenzeiten ohne Distanz sind dauerhaft nicht synchronisierbar | **Hoch** | `dsv7Parser.js:230,310` | ✅ Behoben |
| K2 | `isPB` bleibt dauerhaft `false`, sobald ein Ergebnis ohne Zeit existiert | **Hoch** | `competitions.js:212`, `competitionLive.js:158`, `importRunner.js:45` | ✅ Behoben |
| K3 | `uid()`-Ausweichpfad erzeugt Nicht-UUIDs, die kein Entity-Schema annimmt | **Hoch** | `db.js:104-107` | ✅ Behoben |
| K4 | `STERGEBNIS` wird nicht je Wertung dedupliziert (anders als `PNERGEBNIS`) | Mittel | `dsv7Parser.js:271` | ✅ Behoben |
| D1 | Beide Setup-Skripte scheitern beim zweiten Lauf | **Hoch** | `setup-netcup.sh:333`, `setup-codespace.sh:288` | ✅ Behoben |
| D2 | DB-Passwörter auf der `psql`-Kommandozeile | Mittel | `setup-netcup.sh:114,121`, `setup-codespace.sh:82,89` | ✅ Behoben |
| R1 | Doppelte, serielle Club-Abfrage in jeder Auth-Antwort (8 Stellen) | Mittel | `auth.service.ts:299,344,398,511,560,646,654,672` | ✅ Behoben |
| R2 | `clubModulesCache` räumt nie auf | Niedrig | `sync.route.ts:63` | ✅ Behoben |
| P1 | Reset-Mail kann vor/ohne den Token-Schreibvorgang hinausgehen | Mittel | `auth.service.ts:452-471` | ✅ Behoben |
| P2 | Unescapte Attributwerte in `charts.js` | Niedrig | `charts.js:62,86` | ✅ Behoben |
| P3 | `EVENTS.push()` mutiert ein exportiertes Referenzdaten-Array | Niedrig | `resultsImportUI.js:153` | ✅ Behoben |
| P4 | Falscher Pfad in einer Begründung | Niedrig | `conflictResolution.ts:67` | ✅ Behoben |
| P5 | `npm test` scheitert im frischen Klon | Niedrig | `test/db/prisma.test.ts` | ✅ Behoben |

---

## K1 — Importierte Zwischenzeiten ohne Distanz sind dauerhaft nicht synchronisierbar

**Schwere: Hoch.** `apps/web/js/resultsImport/dsv7Parser.js:230` (und
identisch `:310` für Staffeln):

```js
target.splits.push({ distanceM: toInt(distanzRaw), time: splitTime });
```

`toInt()` (`:67-71`) liefert `undefined`, sobald das Distanz-Feld leer ist
oder keine Zahl enthält. `ResultSplitSchema`
(`packages/shared-types/src/entities.ts:158-162`) verlangt aber:

```ts
distanceM: z.number().positive(),
```

— ein Pflichtfeld in einem `.strict()`-Objekt. Verifiziert:
`safeParse({ distanceM: undefined, time: 30.5 })` schlägt fehl, ebenso
`distanceM: 0` (wegen `.positive()`).

**Ablauf des Datenverlusts.** Der Import schreibt das Ergebnis über
`db.js: put()` lokal, `executeImportPlan()` meldet Erfolg, die Person sieht
den Toast „Import abgeschlossen". Der daraufhin erzeugte Push scheitert in
`validatePayload()` (`sync.service.ts:203`) mit `invalid_payload`. Weil
das ein **dauerhafter** Fehler ist, wiederholt `syncClient.js` ihn
`MAX_SYNC_ATTEMPTS`-mal (`:31`) und markiert das Event danach als
`failed` — womit es aus `getSendableSyncEvents()` herausfällt und nie
wieder gesendet wird. Das Ergebnis existiert nur noch auf diesem einen
Gerät und ist bei einem Logout (`wipeAll()`) weg.

**Reproduktion.** Eine `PNZWISCHENZEIT`-Zeile mit leerem Distanz-Feld
(`PNZWISCHENZEIT:149;1;E;;00:00:30,10;`) ergibt
`splits: [{ time: 30.1 }]` — ohne `distanceM`.

**Verwandt, dieselbe Stelle.** `ResultSchema.time` ist
`z.number().positive().nullable()`. Der Parser (`:198`) setzt
`time = timeToSec(endzeit)`, sobald `status === 'OK'`. Trägt eine Zeile
`status` „OK" und trotzdem den Platzhalter `00:00:00,00`, ist das
Ergebnis `0` — von `.positive()` ebenfalls abgelehnt, mit demselben
Verlauf.

**Empfehlung.** Im Parser filtern statt im Schema aufweichen: eine
Zwischenzeit ohne positive Distanz gehört nicht in `splits` (sie ist ohne
Distanz fachlich auch nicht darstellbar). Analog `time` auf `null`
abbilden, wenn `timeToSec()` nicht positiv ist. Ein Test je Fall in
`apps/web/test/dsv7Parser.test.js`, plus — als Netz gegen die ganze
Fehlerklasse — ein Test, der einen `buildImportPlan()`-Entwurf gegen
`ResultSchema` parst.

**Fix (2. September 2026).** Umgesetzt wie empfohlen, im Parser statt im
Schema.

* `apps/web/js/resultsImport/dsv7Parser.js`: zwei neue Helfer,
  `positiveTimeOrNull(sec)` und `isValidSplit(distanceM, time)`. Beide
  `PNERGEBNIS`- und `STERGEBNIS`-Zweige bilden `time` jetzt über
  `positiveTimeOrNull(timeToSec(endzeit))` ab statt über das bisherige
  `Number.isFinite(time) ? time : null` (das `0` unverändert durchließ).
  `PNZWISCHENZEIT` und `STZWISCHENZEIT` verwerfen eine Zeile jetzt, wenn
  `isValidSplit()` `false` liefert, statt sie mit fehlendem/nicht-positivem
  `distanceM` an `splits` anzuhängen.
* Neue Regressionstests in `apps/web/test/dsv7Parser.test.js`
  (`describe('… — Befund K1 …')`): leere Distanz, Distanz `0`, Platzhalter-
  Endzeit `00:00:00,00` bei `status: "OK"`, sowie derselbe Fall für
  `STZWISCHENZEIT`. Alle vier reproduzieren vor dem Fix eine
  schema-verletzende Zeile und bestätigen danach deren Ausbleiben.
* Der zweite Halbsatz der Empfehlung (ein Test, der einen
  `buildImportPlan()`-Entwurf gegen `ResultSchema` parst, als Netz gegen
  die ganze Fehlerklasse über den Parser hinaus) bleibt bewusst offen —
  das wäre ein modulübergreifender Vertragstest zwischen `apps/web` und
  `packages/shared-types`, den es in dieser Form noch nirgends gibt, und
  eine eigene kleine Entscheidung wert statt eine Nebenwirkung dieses
  Fixes.

---

## K2 — `isPB` bleibt dauerhaft `false`, sobald ein Ergebnis ohne Zeit existiert

**Schwere: Hoch.** Drei Stellen bestimmen die persönliche Bestzeit:

```js
// modules/competitions.js:212 (Schnellerfassung)
const isPB = others.length === 0 || others.every(r => sec < r.time);
// modules/competitionLive.js:158 (Wettkampfmodus, "Ziel")
const isPB = others.length === 0 || others.every(r => finalTime < r.time);
// resultsImport/importRunner.js:45 (Import)
proposed.isPB = others.length === 0 || others.every((r) => r.time != null && proposed.time < r.time);
```

`Result.time` ist seit dem Import-Feature `nullable`
(`entities.ts:172`) — genau dafür ist es gedacht: DS (Disqualifikation),
NA (nicht angetreten), AB, AU, ZU tragen keine Zeit. Trifft eine solche
Zeile auf die ersten beiden Ausdrücke, wird `sec < null` zu `sec < 0`
ausgewertet, also `false`; `every` bricht ab, `isPB` ist `false`. Die
dritte Stelle kommt über den expliziten `r.time != null`-Zweig zum selben
Ergebnis.

**Wirkung.** Ein einziges disqualifiziertes Ergebnis — importiert oder von
Hand erfasst — sorgt dafür, dass diese Person auf dieser Strecke **nie
wieder** eine Bestzeit angezeigt bekommt, gleich wie schnell sie schwimmt.
Verifiziert: `30.0 < null` → `false`.

Das ist kein neuer Fehler in `importRunner.js`; die Coercion-Fassung in
`competitions.js`/`competitionLive.js` liegt länger vor. Sie war nur
unerreichbar, solange `time` nicht `null` sein konnte — der Import macht
sie jetzt erreichbar, und `importRunner.js` hat die falsche Semantik
mitübernommen statt sie zu korrigieren.

**Empfehlung.** Ergebnisse ohne Zeit nehmen an einem Bestzeit-Vergleich
gar nicht teil. Eine gemeinsame Funktion für alle drei Stellen, etwa in
`swimTime.js`:

```js
export function isPersonalBest(time, others) {
  if (time == null) return false;
  const timed = others.filter((r) => r.time != null);
  return timed.every((r) => time < r.time);
}
```

(Der `others.length === 0`-Sonderfall entfällt dabei — `every` auf einer
leeren Liste ist bereits `true`.)

**Nebenbefund, gleiche Stelle, Niedrig.** Keine der drei Stellen setzt
`isPB` auf dem bisherigen Bestzeit-Datensatz zurück. Nach einer neuen
Bestzeit tragen beide Datensätze `isPB: true`, und `modules/times.js:82`
zeigt entsprechend zwei PB-Abzeichen.

**Fix (2. September 2026).** Umgesetzt wie empfohlen — der Nebenbefund
(altes `isPB` nicht zurückgesetzt) bleibt bewusst offen, siehe unten.

* `apps/web/js/swimTime.js`: neue Funktion `isPersonalBest(time, others)`,
  exakt wie in der Empfehlung skizziert (ergebnislose Datensätze werden
  vor dem Vergleich herausgefiltert, kein Sonderfall für `others.length
  === 0` mehr nötig).
* `modules/competitions.js`, `modules/competitionLive.js`,
  `resultsImport/importRunner.js`: alle drei Inline-Berechnungen durch
  einen Aufruf von `isPersonalBest()` ersetzt.
* Neue Regressionstests: `apps/web/test/swimTime.test.js`
  (`describe('isPersonalBest()')`, fünf Fälle inkl. des vormals falschen
  „ergebnisloses Geschwister-Ergebnis" und eines eigenen ergebnislosen
  Datensatzes) sowie ein neuer Fall in
  `apps/web/test/resultsImport.importRunner.test.js`, der eine echte
  Bestzeit trotz eines bestehenden DS-Ergebnisses derselben Person/desselben
  Events erwartet — schlug vor dem Fix fehl (`isPB: false` statt `true`).
* Der Nebenbefund (das bisherige Bestzeit-Ergebnis behält `isPB: true`
  nach einer neuen Bestzeit) ist NICHT Teil dieses Fixes — er betrifft
  denselben Datenfluss, aber eine eigene, im ursprünglichen Befund nur am
  Rande vermerkte Fragestellung (wer setzt das alte `isPB` zurück, und
  wann: beim Speichern des neuen Ergebnisses, oder per Hintergrundjob?).
  Bleibt offen für eine eigene Betrachtung.

---

## K3 — `uid()`-Ausweichpfad erzeugt Nicht-UUIDs, die kein Entity-Schema annimmt

**Schwere: Hoch.** `apps/web/js/db.js:104-107`:

```js
export function uid(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
```

Jedes Entity-Schema verlangt `id: z.string().uuid()`
(`entities.ts:86,98,120,133,166,194,…`). Der Ausweichwert `id-…` erfüllt
das nicht — jeder so angelegte Datensatz scheitert dauerhaft an
`validatePayload()`, mit exakt dem Verlauf aus **K1** (fünf Versuche,
dann `failed`).

**Wann greift der Ausweichpfad?** `crypto.randomUUID` ist ausschließlich in
einem *secure context* verfügbar. `docs/deployment-raspberry-pi.md:642`
beschreibt einen dokumentierten Zwischenzustand: „Ab jetzt ist die Seite
unter `http://training.mein-verein.de` erreichbar (noch ohne
Schloss-Symbol/HTTPS)". Auf einer echten Domain über `http://` existiert
`crypto`, aber `crypto.randomUUID` ist `undefined` — der Ausweichpfad
greift, und **jeder** in diesem Zustand angelegte Datensatz ist dauerhaft
nicht synchronisierbar. Wird HTTPS später eingerichtet, bleiben die
Altdatensätze kaputt.

**Empfehlung.** Der Ausweichpfad ist ohnehin nur wegen der UUID-Form nötig,
nicht wegen fehlender Entropie — `crypto.getRandomValues` ist auch im
unsicheren Kontext verfügbar. Daraus eine formgerechte v4-UUID bauen
(Version- und Variant-Bits setzen). Zusätzlich einen Test, der
`uid()` gegen dieselbe UUID-Prüfung stellt, die der Server anwendet.

**Fix (2. September 2026) — mit einer Korrektur an der eigenen Empfehlung
oben.** Die Empfehlung ging von Bitoperatoren aus (`& 0x0f`, `| 0x40`
usw.), um die Version-/Varianten-Bits einer v4-UUID zu setzen — das
Projekt verbietet `no-bitwise` aber ausdrücklich projektweit (siehe
`packages/shared-config/eslint-preset.cjs`, Begründung: Verwechslung mit
`&&`/`||`). Umgesetzt daher rein arithmetisch statt bitweise:

* `apps/web/js/db.js: uid()`: **drei** Zweige statt der bisherigen zwei.
  1. `crypto.randomUUID()`, wenn verfügbar (unverändert).
  2. NEU: `crypto.getRandomValues()`, falls `randomUUID` fehlt (kein
     secure context) — baut daraus von Hand eine v4-UUID. Die Version-
     /Varianten-Bits werden über Modulo/Addition gesetzt (`byte % 16 +
     0x40` statt `(byte & 0x0f) | 0x40` usw.) — für die betroffenen,
     disjunkten Bitmuster ist das arithmetisch exakt identisch zur
     ursprünglich skizzierten Bit-Variante, nur ohne verbotenen Operator.
     Per Skript über alle 256 Bytewerte gegen die verbotene Bit-Variante
     verifiziert (siehe **Prüfstand**), nicht nur an Beispielen.
  3. Letzter Ausweichpfad, falls überhaupt kein `crypto`-Objekt existiert
     (schwächere Entropie über `Math.random()`, aber weiterhin eine
     gültige v4-Form) — für einen isolierten Testkontext ohne DOM-Globals,
     der in der ausgelieferten App nicht vorkommt.
* Neue Regressionstests in `apps/web/test/db.test.js`
  (`describe('uid()')`): alle drei Zweige (per `vi.stubGlobal('crypto',
  …)` gezielt erzwungen) gegen dieselbe `z.string().uuid()`-Form geprüft,
  die der Server anwendet, plus ein Eindeutigkeits-Test über 50 ids aus
  dem zweiten Zweig.

---

## K4 — `STERGEBNIS` wird nicht je Wertung dedupliziert

**Schwere: Mittel.** `PNERGEBNIS` wiederholt sich in DSV7 einmal je
Wertungsklasse für denselben Schwimmversuch; der Parser fängt das
ausdrücklich ab (`dsv7Parser.js:189-190`):

```js
const dedupeKey = `${veranstaltungsId}|${wettkampfnr}|${wettkampfart}`;
if (individualResultsByKey.has(dedupeKey)) break;
```

`STERGEBNIS` hat dieselbe Struktur — das Feld `WertungsID` steht an
Position 3 (siehe `docs/dsv7-lenex-import-plan.md:106`) — bekommt aber
keine solche Prüfung. Stattdessen (`:271`):

```js
relayResultsByKey.set(`${veranstaltungsIdStaffel}|${wettkampfnr}|${wettkampfart}`, { template, members: [] });
```

Die zweite Wertungszeile **überschreibt** die Gruppe mit einer frischen
`template`-Instanz samt neuem, leerem `splits`-Array. Die bereits erzeugten
Mitglieds-Results referenzieren weiter das alte Array (der Kommentar bei
`:280-284` erklärt diese Referenzteilung als beabsichtigt — sie bricht hier).

**Reproduktion** (Staffel mit zwei Wertungsklassen, sonst identisch):

```
STERGEBNIS:26;E;26001;1;;1;154;SV Test;5623;00:01:50,00;;;
STAFFELPERSON:154;26;E;Muster, Max;404306;1;M;2009;
STZWISCHENZEIT:154;26;E;1;50;00:00:27,50;
STERGEBNIS:26;E;26002;1;;1;154;SV Test;5623;00:01:50,00;;;
STAFFELPERSON:154;26;E;Muster, Max;404306;1;M;2009;
```

→ zwei `ImportedResult` für dieselbe Person in derselben Staffel; das erste
trägt die Zwischenzeit, das zweite `splits: []`.

**Wirkung.** `buildImportPlan()` reduziert Duplikate erst *nach* den
`unmatched-athlete`/`unmatched-event`-Zweigen (`matching.js:125-141`) —
nicht zuordenbare Personen erscheinen in der Vorschautabelle deshalb
doppelt. Bei zuordenbaren Personen entscheidet `roundRank`; bei
Rangleichheit gewinnt die erste, was hier zufällig die richtige ist. Die
Korrektheit hängt damit an der Zeilenreihenfolge des Exportprogramms.

**Empfehlung.** Dieselbe Dedupe-Prüfung wie bei `PNERGEBNIS`: existiert
der Schlüssel bereits in `relayResultsByKey`, die Zeile überspringen.

**Fix (2. September 2026) — geht über die eigene Empfehlung oben hinaus.**
Die Empfehlung (Dedupe nur auf der `STERGEBNIS`-Zeile selbst) reicht
NICHT aus, um die tatsächliche Duplizierung zu beheben — beim Umsetzen
gegen den Reproduktionsfall aus diesem Befund entstand weiterhin ein
zweites `ImportedResult` pro Teammitglied: `STAFFELPERSON`/
`STZWISCHENZEIT` verweisen über denselben (WertungsID-losen) Schlüssel auf
dieselbe, jetzt nicht mehr überschriebene Gruppe und legen für die WEITERE
Wertungsklasse trotzdem erneut ein Mitglied bzw. eine Zwischenzeit an.
Behoben wurde daher der vollständige Mechanismus, nicht nur der im Befund
beschriebene Ausschnitt:

* `apps/web/js/resultsImport/dsv7Parser.js`: `STERGEBNIS` überspringt eine
  Zeile jetzt wie `PNERGEBNIS`, wenn ihr Schlüssel bereits in
  `relayResultsByKey` existiert. Die Gruppe trägt zusätzlich zwei neue,
  je Staffel einmal angelegte Mengen: `seenLegIndexes` (welche Startnummer
  bereits ein `ImportedResult` bekommen hat) und `seenSplitKeys` (welche
  `(Distanz, Startnummer)`-Zwischenzeit bereits im gemeinsamen
  `splits`-Array steht). `STAFFELPERSON` überspringt eine Zeile, deren
  Startnummer bereits in `seenLegIndexes` steht; `STZWISCHENZEIT`
  überspringt eine Zeile, deren `(distanceM, legIndex)`-Paar bereits in
  `seenSplitKeys` steht. Beide Mengen überleben eine übersprungene
  `STERGEBNIS`-Wiederholung (sie hängen an der Gruppe, nicht an der
  einzelnen Wertungszeile) — genau das verhindert die verbliebene
  Duplizierung.
* Neue Regressionstests in `apps/web/test/dsv7Parser.test.js`
  (`describe('… — Befund K4 …')`) mit der Zwei-Wertungsklassen-Datei aus
  diesem Befund: genau ein `ImportedResult` je Teammitglied, und die
  Zwischenzeit der ersten Wertungsklasse bleibt erhalten statt durch die
  zweite (leere) überschrieben zu werden. Beide Assertions schlugen mit
  der ursprünglichen, im Befund vorgeschlagenen (unvollständigen) Fassung
  des Fixes noch fehl — erst mit `seenLegIndexes`/`seenSplitKeys` grün.

---

## D1 — Beide Setup-Skripte scheitern beim zweiten Lauf

**Schwere: Hoch** (bezogen auf das dokumentierte Versprechen).
`scripts/setup-netcup.sh:47-52` sagt zu: „Wiederholt ausführbar: bereits
installierte Software wird übersprungen, eine bereits vorhandene
apps/api/.env wird NICHT überschrieben …". Genau der wiederholte Lauf ist
der dokumentierte Weg nach einem `git pull`, der eine neue Migration
mitbringt (Abschnitt 13).

Der Ablauf bricht ihn aber:

1. `:86` — `DB_MIGRATOR_PASSWORD="${DB_MIGRATOR_PASSWORD:-$(openssl rand -hex 16)}"`
   würfelt bei **jedem** Lauf neu.
2. `:117-118` — existiert die Rolle bereits, bleibt ihr Passwort in der
   Datenbank bewusst unverändert („Passwort bleibt unverändert").
3. `:333` — `prisma migrate deploy` läuft trotzdem mit dem **frisch
   gewürfelten** Wert:
   ```bash
   (cd apps/api && DATABASE_URL="postgresql://${DB_MIGRATOR_USER}:${DB_MIGRATOR_PASSWORD}@localhost:5432/${DB_NAME}" npx prisma migrate deploy)
   ```

→ Authentifizierungsfehler, und wegen `set -euo pipefail` (`:56`) bricht
das gesamte Skript ab. `scripts/setup-codespace.sh` ist an `:52`, `:85` und
`:288` zeilengleich betroffen.

Das Skript schreibt das gültige Passwort selbst nach
`apps/api/.env.migrate` (`:160-170`) und liest es nur nie zurück.

**Empfehlung.** Im `else`-Zweig (Rolle existiert bereits)
`MIGRATE_DATABASE_URL` aus `$MIGRATOR_ENV_FILE` einlesen und für Schritt
7.3 verwenden; existiert die Datei nicht, mit klarer Meldung abbrechen,
**bevor** die halbe Einrichtung gelaufen ist — statt erst 200 Zeilen
später an einem irreführenden Postgres-Fehler.

**Fix (2. September 2026).** Umgesetzt wie empfohlen, in beiden Skripten.

* `scripts/setup-netcup.sh`, `scripts/setup-codespace.sh`: der
  `MIGRATOR_ENV_FILE`-Zweig setzt jetzt in allen drei Fällen eine
  `MIGRATE_DATABASE_URL`-Variable, die Schritt 7.3/7 danach exklusiv
  verwendet (`DATABASE_URL="${MIGRATE_DATABASE_URL}"` statt der bisherigen
  Neuzusammensetzung aus `${DB_MIGRATOR_USER}:${DB_MIGRATOR_PASSWORD}`):
  1. Rolle neu angelegt → `MIGRATE_DATABASE_URL` aus dem frisch
     gewürfelten `DB_MIGRATOR_PASSWORD` gebaut (unverändert) und in die
     Datei geschrieben.
  2. Rolle bestand bereits UND die Datei existiert → `source
     "$MIGRATOR_ENV_FILE"` liest die dort hinterlegte, tatsächlich
     gültige `MIGRATE_DATABASE_URL` zurück, **statt** weiterhin mit dem
     oben frisch gewürfelten (und nie gespeicherten) `DB_MIGRATOR_PASSWORD`
     zu arbeiten. Fehlt `MIGRATE_DATABASE_URL` in der Datei trotzdem
     (z. B. eine von Hand verstümmelte Datei), bricht das Skript hier ab,
     statt mit einem leeren Wert weiterzulaufen.
  3. Rolle bestand bereits, Datei fehlt → Abbruch **an dieser Stelle**
     (Schritt 6.2/4.2), mit derselben Anleitung wie zuvor (Passwort per
     `ALTER USER` neu setzen), statt eines bloßen Hinweises, der das
     Skript ungebremst bis zu Schritt 7.3/7 weiterlaufen ließ.
* Verifiziert gegen eine echte lokale PostgreSQL-Instanz (nicht nur durch
  Lesen des Diffs): ein Testlauf, der Rolle+Datenbank anlegt, gefolgt von
  einem zweiten Lauf mit einem bewusst NEU gewürfelten
  `DB_MIGRATOR_PASSWORD` (genau der Zustand nach einem `git pull`, der
  eine neue Migration mitbringt — die Umgebungsvariable ist dann nicht
  mehr gesetzt, das Skript würfelt neu), verbindet sich in BEIDEN Läufen
  erfolgreich mit derselben, korrekten `MIGRATE_DATABASE_URL`. Vor diesem
  Fix scheiterte die Verbindung im zweiten Lauf mit einem
  Authentifizierungsfehler.

---

## D2 — DB-Passwörter auf der `psql`-Kommandozeile

**Schwere: Mittel.** `scripts/setup-netcup.sh:114` und `:121`
(`setup-codespace.sh:82`, `:89`):

```bash
sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASSWORD}';"
```

Argumente eines laufenden Prozesses sind unter Linux über
`/proc/<pid>/cmdline` für **jedes** lokale Konto lesbar (`ps aux` zeigt sie
direkt). Auf einem frisch aufgesetzten Server ist das Fenster kurz und die
Zahl der Konten klein — aber genau diese Fehlerklasse hat das Projekt für
das Superadmin-Passwort bereits behoben (Commit `45dc106`, „fix(scripts):
stop passing superadmin password as a CLI argument", Befunde M1/M2). Die
Datenbank-Rollen sind schlicht übersehen worden.

Die `DATABASE_URL`-Übergabe an `prisma migrate deploy` (`:333`) ist davon
**nicht** betroffen — `/proc/<pid>/environ` ist nur für die Eigentümerin
lesbar.

**Empfehlung.** Konsistent zu `45dc106`: Passwort über `stdin` bzw. eine
`psql`-Variable statt über `-c` übergeben, z. B.

```bash
sudo -u postgres psql -v pw="${DB_PASSWORD}" <<'SQL'
CREATE USER lane1_app WITH ENCRYPTED PASSWORD :'pw';
SQL
```

Das löst nebenbei die Quoting-Schwäche mit: ein per Umgebungsvariable
vorgegebenes Passwort mit `'` bricht heute aus dem SQL-String aus.

**Fix (2. September 2026) — die eigene Empfehlung oben ist so NICHT
tragfähig.** `-v pw="${DB_PASSWORD}"` löst das eigentliche Problem nicht:
`-v name=wert` ist selbst ein Kommandozeilenargument von `psql` — genau
der Wert, der über `ps aux`/`/proc/<pid>/cmdline` sichtbar sein soll,
stünde damit weiterhin dort, nur unter einem anderen Flag. Empirisch
gegen eine echte lokale PostgreSQL-Instanz geprüft: `psql -v
pass="$PW" -c "CREATE USER … PASSWORD :'pass';"` scheitert außerdem mit
„syntax error at or near ':'" — `-c` interpoliert psql-Variablen
grundsätzlich NICHT (nur `-f`/interaktive Sitzungen/STDIN tun das),
unabhängig vom `-v`-Flag.

Tatsächlich umgesetzt: das SQL-Statement wandert komplett auf `psql`s
STDIN (Heredoc), das Passwort wird darin per Shell-Interpolation
eingebettet, aber vorher gegen Einzelquotes escapt:

* Neuer Helfer `sql_quote()` in beiden Skripten (verdoppelt eingebettete
  `'`, die Standard-SQL-Escapierung), NUR für Werte gedacht, die per
  Heredoc auf STDIN gereicht werden.
* Beide `CREATE USER`-Aufrufe (`DB_MIGRATOR_USER`, `DB_USER`) in
  `scripts/setup-netcup.sh` und `scripts/setup-codespace.sh`:
  ```bash
  sudo -u postgres psql <<SQL
  CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '$(sql_quote "${DB_PASSWORD}")';
  SQL
  ```
  Ein Heredoc auf STDIN erscheint nicht in der Prozess-Argumentliste —
  `ps aux` während eines laufenden Aufrufs zeigt nur noch `psql` selbst,
  kein Passwort.
* Empirisch verifiziert (echte lokale PostgreSQL-Instanz, nicht nur
  gelesen): ein absichtlich schwieriges Test-Passwort mit eingebettetem
  `'` sowie `;`/`--`/`$` legt über diesen Weg erfolgreich eine Rolle an,
  meldet sich mit exakt diesem (unescapten) Passwort erfolgreich an, UND
  taucht während der Ausführung nicht in `ps aux` auf — anders als zuvor
  mit `-c "..."`, wo derselbe Prozess das Passwort im Klartext als
  Kommandozeilenargument zeigte.

Die im Befund erwähnte Quoting-Schwäche ist damit ebenfalls behoben, aber
über `sql_quote()`, nicht über die (nicht tragfähige) `-v`/`:'var'`-Form
aus der ursprünglichen Empfehlung.

---

## R1 — Doppelte, serielle Club-Abfrage in jeder Auth-Antwort

**Schwere: Mittel** (Effizienz/Redundanz).
`apps/api/src/modules/auth/auth.service.ts:164-181` definiert zwei Helfer,
die **dieselbe Zeile** holen:

```ts
async function resolveEnabledModules(clubs, clubId) {
  const club = await clubs.findById(clubId);
  return club?.enabledModules ?? [];
}
async function resolveClubIdentity(clubs, clubId) {
  const club = await clubs.findById(clubId);
  return { clubNationalID: club?.nationalID ?? null, clubNationalIDType: club?.nationalIDType ?? null };
}
```

`PrismaClubRepository.findById()`
(`invitations.repository.ts:142-144`) ist ein schlichtes
`prisma.club.findUnique({ where: { id } })` — die Zeile trägt alle drei
Felder bereits beim ersten Aufruf.

Aufgerufen werden beide **nacheinander, jeweils awaitet**, an acht Stellen
(`:299/300`, `:344/345`, `:398/399`, `:511/512`, `:560/561`, `:646/647`,
`:654/655`, `:672/673`) — also in `acceptInvitation`, `login`, `refresh`,
`resetPassword`, `changePassword`, `changeEmail`, `getMe` und `updateMe`.
Jede dieser Antworten kostet damit eine überflüssige Datenbankrunde,
seriell zur ersten.

Der Refresh-Pfad ist der relevanteste: `apiClient.js` erneuert proaktiv
(`PROACTIVE_REFRESH_MARGIN_MS`, `:40`), bei einer Access-Token-Laufzeit von
15 Minuten also regelmäßig, für jede aktive Sitzung.

Das ist dieselbe Fehlerklasse, die das Review vom 30.08.2026 unter E1/E2
für `sync.route.ts`/`sync.service.ts` behoben hat — hier nur an einer
Stelle, die damals nicht im Umfang lag.

**Empfehlung.** Ein Helfer, ein Lookup:

```ts
async function resolveClubContext(clubs: ClubModulesLookup, clubId: string | null) {
  const club = clubId ? await clubs.findById(clubId) : null;
  return {
    enabledModules: club?.enabledModules ?? [],
    clubNationalID: club?.nationalID ?? null,
    clubNationalIDType: club?.nationalIDType ?? null,
  };
}
```

Alle acht Stellen rufen ihn einmal auf. Das entfernt zugleich acht
wortgleiche Zeilenpaare.

**Fix (2. September 2026).** Umgesetzt praktisch wortgleich zur
Empfehlung — `resolveClubContext()` ersetzt beide vormaligen Helfer
(`resolveEnabledModules()`/`resolveClubIdentity()`) und wird an allen
acht Stellen (`acceptInvitation`, `login`, `refresh`, `resetPassword`,
`changePassword`, `changeEmail`, `getMe`, `updateMe`) per
`return { …, ...clubContext }` bzw. `return { ...tokens, user: …,
...clubContext }` eingebunden.

* `apps/api/src/modules/auth/auth.service.ts`: zwei stale Kommentar-
  Verweise auf die alten Funktionsnamen (`ClubModulesLookup`-
  Dokumentation, ein Testkommentar) auf `resolveClubContext()`
  aktualisiert.
* Neuer Regressionstest in `apps/api/test/auth/auth.service.test.ts`
  (`'lädt den Club-Datensatz für enabledModules UND die Vereinskennung
  nur EINMAL je Antwort'`): ein Spy auf `clubs.findById()` prüft
  `toHaveBeenCalledTimes(1)` für sowohl `getMe()` als auch `login()`.
  Zurückgegebene Werte allein hätten diesen Befund NICHT erkannt (beide
  Aufrufzahlen liefern identische Werte) — deshalb der Spy statt einer
  reinen Werteprüfung.
* Verifiziert: der neue Test schlägt (`toHaveBeenCalledTimes(2)` statt
  `1`) fehl, wenn man ihn gegen den vorherigen Zwei-Helfer-Stand laufen
  lässt (per `git stash` empirisch geprüft, nicht nur angenommen) —
  echter Regressionstest, keine Tautologie.

---

## R2 — `clubModulesCache` räumt nie auf

**Schwere: Niedrig.** `apps/api/src/modules/sync/sync.route.ts:63-73`:
Einträge bekommen ein `expiresAt` und werden nach Ablauf **neu
geschrieben**, aber nie gelöscht. Die `Map` wächst dauerhaft mit der Zahl
der Vereine, die der Prozess je gesehen hat.

Bei der dokumentierten Größenordnung (ein Verein pro Installation, ein
PM2-Prozess) ist das folgenlos, und der Kommentar begründet die
Closure-Platzierung sauber. Für eine Mehrvereins-Installation ist es eine
kleine, unbegrenzte Halde. Ein `clubModulesCache.delete(clubId)` im
abgelaufenen Zweig oder ein gelegentliches Durchsehen genügt.

**Fix (2. September 2026).** Periodischer Sweep statt Löschen im
Lese-Zweig (letzteres würde einen nie wieder abgefragten Verein weiterhin
für immer in der Map halten — genau der im Befund beschriebene Fall).

* `apps/api/src/modules/sync/sync.route.ts`: die Sweep-Logik ist als
  reine, exportierte Funktion `sweepExpiredClubModules(cache, now)`
  ausgelagert (analog zu `splitAtSafeTimestampBoundary()` in
  `sync.pagination.ts`), statt Inline-Code in einem `setInterval()`-
  Callback — dadurch ohne Timer/Fastify-Instanz testbar. `syncRoutes()`
  ruft sie über `setInterval(() => sweepExpiredClubModules(clubModulesCache,
  Date.now()), CLUB_MODULES_CACHE_TTL_MS)` auf; der Timer ist `.unref()`t
  (hält den Node-Prozess nicht allein am Leben) und zusätzlich an
  `app`s `onClose`-Hook gehängt (räumt sich bei einem tatsächlich
  geschlossenen/neu gebauten Test-App auf, statt über das Testende hinaus
  weiterzulaufen).
* `CachedClubModules` ist jetzt exportiert (vormals modul-intern), damit
  der neue Test unten eigene Cache-Instanzen bauen kann.
* Neue Tests in `apps/api/test/sync/sync.route.test.ts`
  (`describe('sweepExpiredClubModules()')`): entfernt abgelaufene
  Einträge, behält frische, und ein Grenzfall-Test hält fest, dass
  `expiresAt === now` als abgelaufen zählt — konsistent zur Bedingung in
  `resolveEnabledModules()` (`cached.expiresAt > now` gilt noch als
  frisch), sonst könnten Sweep und Lesezugriff für denselben Zeitpunkt
  unterschiedlich entscheiden.

---

## P1 — Reset-Mail kann vor/ohne den Token-Schreibvorgang hinausgehen

**Schwere: Mittel.** `auth.service.ts:452-471` startet zwei
Nebenläufigkeiten **unabhängig voneinander**:

```ts
deps.passwordResetTokens.create(user.id, tokenHash, expiresAt).catch(…);
deps.mailer.sendPasswordResetEmail({ … resetUrl: buildPasswordResetUrl(…, plainToken) … }).catch(…);
```

Das fehlende `await` ist beabsichtigt und richtig begründet (Befund S3,
Timing-Gleichheit zwischen Treffer- und Nicht-Treffer-Pfad). Die fehlende
**Reihenfolge** zwischen den beiden ist es nicht: Schlägt der
Schreibvorgang fehl (DB kurz nicht erreichbar), geht die Mail trotzdem
hinaus. Die Person bekommt einen Link, der beim Klick
`InvalidOrExpiredResetTokenError` liefert — „ungültig, abgelaufen oder
bereits verwendet", obwohl nichts davon zutrifft. Der einzige Hinweis ist
eine `console.error`-Zeile.

**Empfehlung.** Versand an den Schreibvorgang hängen, weiterhin ohne
`await`:

```ts
deps.passwordResetTokens
  .create(user.id, tokenHash, expiresAt)
  .then(() => deps.mailer.sendPasswordResetEmail({ … }))
  .catch((err) => console.error('[auth] Passwort-Zurücksetzen fehlgeschlagen:', err));
```

Die Timing-Eigenschaft aus S3 bleibt unverändert erhalten (der Aufrufer
wartet weiterhin auf keines von beidem), es geht aber keine Mail mehr zu
einem Token hinaus, das nie gespeichert wurde.

**Fix (2. September 2026).** Umgesetzt wie empfohlen, mit einer
gemeinsamen `.catch()`-Zeile für beide Fehlerquellen (Schreiben ODER
Versand) statt zwei getrennter Log-Zeilen — für die aufrufende Person
ist ohnehin nur relevant, dass die generische Antwort unverändert bleibt,
nicht an welcher der beiden Stellen ein Fehlschlag saß.

* `apps/api/src/modules/auth/auth.service.ts: requestPasswordReset()`:
  `deps.passwordResetTokens.create(...).then(() =>
  deps.mailer.sendPasswordResetEmail({...})).catch(...)` — weiterhin ohne
  `await` auf der äußeren Kette (Befund S3 bleibt unverändert erhalten).
* Neuer Regressionstest in `apps/api/test/auth/auth.service.test.ts`
  (`'versendet KEINE E-Mail, wenn das Speichern des Reset-Tokens
  fehlschlägt'`): `passwordResetTokens.create()` per Spy auf eine
  Ablehnung gestellt, danach `mailer.sentPasswordResetEmails` auf Länge 0
  geprüft.
* Verifiziert: derselbe Test schlägt (Länge 1 statt 0) fehl, wenn man ihn
  gegen den vorherigen Zwei-Ketten-Stand laufen lässt (per `git stash`
  empirisch geprüft) — die Mail ging dort tatsächlich unabhängig vom
  Schreibfehler hinaus.

---

## P2 — Unescapte Attributwerte in `charts.js`

**Schwere: Niedrig** (heute nicht ausnutzbar; Verteidigung in der Tiefe).
`apps/web/js/charts.js:28-31` definiert `esc()` mit einem ausdrücklichen
Warnhinweis: „Nur für ELEMENT-INHALTE gedacht … nicht für Attributwerte".
Diese Warnung wird an drei Stellen nicht befolgt:

* `:62` und `:86` — `stroke="${color}"` bzw. `fill="${b.color || color}"`:
  Attributwerte ganz ohne Behandlung.
* `:53` — `${yFormat ? yFormat(val) : val.toFixed(1)}` in den Gitterlinien
  ist der einzige Elementinhalt der Datei, der **nicht** durch `esc()`
  läuft (`:56`, `:60`, `:81`, `:83` tun es).

Aktuell ungefährlich: alle vier Aufrufer (`stats.js:52,62,70,98`,
`times.js:64`) übergeben feste CSS-Variablennamen, kein Aufrufer setzt
`b.color`, und `yFormat` ist immer ein Zahlenformatierer. Es ist aber die
einzige Stelle im Frontend, an der ein datengetriebener Wert direkt
XSS ergäbe — überall sonst baut `dom.js: el()` per `setAttribute()`.

**Empfehlung.** `color`/`b.color` gegen eine Allowlist prüfen (es sind
ohnehin nur CSS-Custom-Properties) oder die beiden `<svg>`-Bäume über
`el()` statt über `innerHTML` bauen. Mindestens `esc()` konsequent auch
auf `:53` anwenden.

**Fix (2. September 2026).** Die Allowlist-Variante umgesetzt (kein
Wechsel auf `el()`-Aufbau — das wäre eine deutlich größere Änderung an
beiden Diagramm-Buildern gewesen, für einen Befund, den eine
Formvalidierung bereits vollständig schließt).

* `apps/web/js/charts.js`: neue Funktion `safeColor(value, fallback)`
  gegen `SAFE_COLOR_RE` (`var(--…)`, Hex-Farbe, oder ein einfacher
  CSS-Farbname) — jeder abweichende Wert fällt auf den übergebenen
  Standardfarbwert zurück. Angewendet auf `color` in BEIDEN Funktionen
  (direkt nach der Parameter-Destrukturierung, greift dadurch auch bei
  einem explizit übergebenen bösartigen Wert, nicht nur beim
  Default-Fall) sowie auf `b.color` je Balken in `svgBarChart()`
  (Rückfall auf die bereits validierte Diagrammfarbe). `:53`
  (Gitterlinien-Beschriftung) läuft jetzt ebenfalls durch `esc()`, wie
  vom zweiten Empfehlungsteil verlangt.
* Neue Testdatei `apps/web/test/charts.test.js` (mit `@vitest-environment
  jsdom`, wie `test/modal.test.js`): prüft sowohl den Normalfall (eine
  gültige `var(--…)`-Referenz landet unverändert im Attribut) als auch
  einen bösartigen `color`-/`b.color`-Wert (`x" onload="alert(1)`) auf
  Diagramm- UND Einzelbalken-Ebene, sowie die `esc()`-Anwendung auf einen
  HTML-tragenden `yFormat`-Rückgabewert.
* Die Regex ist gegen die tatsächlich im Frontend verwendeten Werte
  (`var(--c-petrol)`, `var(--c-lane-d)`, `var(--c-chlorine-d)`, siehe
  `modules/stats.js`/`modules/times.js`) sowie gegen mehrere
  Injektionsversuche geprüft (siehe Testdatei) — alle legitimen Werte
  bestehen, alle bösartigen fallen auf den Standardwert zurück.

---

## P3 — `EVENTS.push()` mutiert ein exportiertes Referenzdaten-Array

**Schwere: Niedrig.** `modules/resultsImportUI.js:153`:

```js
if (!EVENTS.includes(newLabel)) EVENTS.push(newLabel);
```

Der Kommentar darüber begründet die Absicht (Session-Erweiterung, kein
eigener Store) nachvollziehbar. Die *Umsetzung* ist trotzdem ein globaler
Seiteneffekt: `EVENTS` aus `refdata.js` speist die Auswahllisten in
`times.js`, `competitions.js` und `stats.js`. Nach einem Import steht der
neue Eintrag dort mit — ohne Übersetzung (`trCode(event, 'events')` findet
keinen Schlüssel) und ohne dass die betreffenden Module davon wissen.

**Empfehlung.** Wenn die Erweiterung gewollt ist, sie explizit machen:
eine Funktion in `refdata.js` (`registerSessionEvent(label)`), die den
Zusatz in einer getrennten Liste hält und über einen Getter
zusammenführt. Dann steht der Seiteneffekt dort, wo die Daten wohnen,
statt in einem UI-Modul.

**Fix (2. September 2026) — mit einer bewussten Vereinfachung gegenüber
der eigenen Empfehlung oben.** `EVENTS` wird von sechs Stellen in vier
Modulen (`times.js`, `competitions.js`, `stats.js`,
`resultsImportUI.js`) direkt als lebendiges Array gelesen (`.map()`,
`.includes()`, `EVENTS[0]`) — eine getrennte Zusatzliste mit
Getter-Zusammenführung hätte bedeutet, entweder alle sechs Lesestellen
auf den Getter umzustellen (deutlich größerer, hier nicht gerechtfertigter
Diff für einen Niedrig-Befund) oder zwei parallele Wahrheiten (`EVENTS`
und der Getter) nebeneinander zu pflegen. Stattdessen bleibt `EVENTS`
dieselbe, weiterhin von allen Modulen gelesene Array-Referenz — behoben
ist nur, DASS und WO der Seiteneffekt passiert:

* `apps/web/js/refdata.js`: neue, exportierte Funktion
  `registerSessionEvent(label)` — identisches Verhalten
  (`if (!EVENTS.includes(label)) EVENTS.push(label)`), jetzt aber in der
  Datei, die `EVENTS` besitzt und dokumentiert, statt in einem
  UI-Modul.
* `modules/resultsImportUI.js`: ruft `registerSessionEvent(newLabel)`
  auf, statt `EVENTS` direkt zu mutieren.
* Neue Tests in `apps/web/test/refdata.dsv7EventLabel.test.js`
  (`describe('registerSessionEvent()')`): fügt ein neues Label hinzu,
  und fügt ein bereits vorhandenes Label kein zweites Mal hinzu
  (Dedupe-Verhalten erhalten).

---

## P4 — Falscher Pfad in einer Begründung

**Schwere: Niedrig.** `packages/sync-protocol/src/conflictResolution.ts:67`
verweist auf `apps/web/js/modules/resultsImport/*`. Tatsächlich liegt das
Modul unter `apps/web/js/resultsImport/*` (`modules/` enthält nur
`resultsImportUI.js`). In einer Codebasis, deren Kommentare durchgängig
als Navigationshilfe dienen, ist ein toter Verweis mehr als ein Tippfehler.

**Fix (2. September 2026).** Pfad korrigiert. Zusätzlich das gesamte
Repository nach demselben Verwechslungsmuster durchsucht
(`js/modules/resultsImport` ohne `UI`) — kein weiterer Treffer; alle
übrigen Vorkommen von `js/modules/resultsImportUI.js` verweisen korrekt
auf die tatsächlich unter `modules/` liegende Datei.

---

## P5 — `npm test` scheitert im frischen Klon

**Schwere: Niedrig.** `apps/api/src/app.ts:129-135` begründet ausführlich,
warum `getPrisma()` verzögert aufgerufen wird: „dadurch braucht keine
Testumgebung einen generierten Prisma Client oder eine echte Datenbank".
`test/db/prisma.test.ts` durchbricht genau diese Eigenschaft — zwei seiner
drei Tests rufen `getPrisma()` direkt auf und scheitern ohne vorheriges
`prisma generate` mit „@prisma/client did not initialize yet".

CI ist grün, weil `ci.yml` „Prisma Client generieren" vor „Test" ausführt.
Betroffen ist nur, wer nach `git clone && npm install` schlicht `npm test`
tippt — der bekommt zwei rote Tests, die nichts mit seiner Änderung zu tun
haben.

**Empfehlung.** Entweder ein `pretest`-Schritt in `apps/api/package.json`,
der `prisma generate` mitnimmt, oder die beiden Tests überspringen, wenn
kein generierter Client vorliegt (mit `test.skipIf`), samt Hinweis auf
`npm run prisma:generate`.

**Fix (2. September 2026).** Die erste Variante umgesetzt — `prisma
generate` braucht weder eine erreichbare Datenbank noch eine gesetzte
`DATABASE_URL` (empirisch geprüft: läuft auch ganz ohne diese Variable
sauber durch), ein `test.skipIf` hätte den frischen Klon dagegen mit zwei
grün ÜBERSPRUNGENEN statt tatsächlich laufenden Tests zurückgelassen.

* `apps/api/package.json`: `pretest` und `pretest:integration` hängen
  jetzt zusätzlich `&& cd ../../apps/api && prisma generate` an (nach dem
  bereits bestehenden `packages/sync-protocol`-Build) — dieselbe
  Reihenfolge wie in `.github/workflows/ci.yml` (Prisma Client generieren
  vor Test), jetzt aber auch für einen lokalen, direkten `npm test`-Aufruf
  ohne CI.
* Verifiziert am tatsächlichen Symptom: `node_modules/.prisma`
  (generierter Client) gelöscht, `.prisma`-Paket-Verzeichnis selbst aber
  UNVERÄNDERT gelassen (reine Simulation von „nie generiert", nicht von
  „nie installiert") — `npm test` vom Repo-Root aus generiert den Client
  automatisch über den neuen `pretest`-Schritt und alle vier Workspaces
  laufen grün durch, ohne einen manuellen `npm run prisma:generate`-Schritt
  dazwischen.
* Nebenbei aufgeräumt: ein erster Verifikationslauf hatte versehentlich
  das installierte `@prisma/client`-Paket selbst gelöscht (nicht nur den
  generierten Client) — `npm install` installierte es beim nächsten Lauf
  automatisch in einer neueren, ebenfalls zu `^5.20.0` passenden Version
  nach und schrieb diese in `package.json`/`package-lock.json`. Dieser
  unbeabsichtigte Versions-Bump wurde vor dem Commit zurückgenommen; die
  einzige tatsächliche Änderung ist die `pretest`/`pretest:integration`-Zeile.

---

## Geprüft und für gut befunden

Der Vollständigkeit halber — folgende Bereiche wurden durchgesehen, ohne
dass ein Befund entstanden ist:

* **Guard-Kette in `sync.service.ts`** (`PUSH_GUARDS`, `:277-285`): Die
  sicherheitsrelevante Reihenfolge ist als Array-Position kodiert und
  stimmt; `requireOwnClub` läuft vor `requireForeignKeysWithinClub`, beide
  vor jedem Schreibzugriff. `validatePayload()` streift `createdAt`/
  `updatedAt` ab, bevor der Payload irgendwo verwendet wird — das
  Mass-Assignment-Risiko ist tatsächlich geschlossen, nicht nur
  dokumentiert.
* **Zeilenebene über der Store-Ebene** (`:405-419`, `:433-445`): Die
  `results`-Verengung für Rolle „athlete" prüft **sowohl** den bestehenden
  Datensatz als auch den Payload und schließt den Delete-Fall korrekt ein.
* **`scopeChangeForAthlete()`** (`sync.athleteScope.ts`): Allowlist statt
  Blockliste, eigenes Profil korrekt vom fremden unterschieden.
* **Paginierung** (`sync.pagination.ts`, `sync.service.ts: pull()`): Die
  Behandlung gleicher Zeitstempel an der Seitengrenze inklusive des
  Extremfalls (gesamtes Fenster gleicher Zeitstempel) ist korrekt und
  gedeckelt.
* **Single-Flight-Refresh** (`apiClient.js:280-292`) und die
  429-Sonderbehandlung (`:202-204`): schlüssig, verhindert den
  Massen-Logout durch eigene Parallelität.
* **`escapeHtml()`** (`mailer.ts:303-305`): vollständig, inklusive
  Anführungszeichen — die `href`-Interpolation ist sauber.
* **Service Worker** (`sw.js:126-183`): `/api/`- und `/auth/`-Umgehung
  greift, `res.type === 'basic'` verhindert das Zwischenspeichern
  fremder Antworten.
* **Rollen-/Modul-Matrix** (`sync.permissions.ts`): Whitelist,
  `Record<EntityStoreName, …>` erzwingt Vollständigkeit zur Compile-Zeit.
* **Import-Berechtigung**: `resultsImportButton()` hängt an
  `modules/competitions.js` (`roles: ['trainer','admin']`, `:26`), und der
  Server setzt unabhängig davon durch — die UI-Beschränkung ist keine
  Fassade.
* **`npm audit --omit=dev`**: ohne Befund; der CI-Schritt dafür ist
  vorhanden und blockierend.
