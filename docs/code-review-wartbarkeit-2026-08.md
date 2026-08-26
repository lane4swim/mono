# Code-Review — Wartbarkeit, Redundanzen, Methodenlänge, Abhängigkeiten

Stand: August 2026 · Umfang: `apps/api`, `apps/web`, `packages/*`, Build-/CI-Konfiguration
· Schwerpunkte laut Auftrag: **Wartbarkeit, Redundanzen, überlange Methoden und Klassen,
übermäßige Abhängigkeiten**.

Ergänzt `docs/code-review-2026-08.md` (Sicherheit/Korrektheit/Effizienz/Stil). Befunde, die
dort bereits behoben wurden, sind hier nicht wiederholt; wo ein dortiger Befund nur teilweise
umgesetzt wurde, ist das ausdrücklich vermerkt.

**Zahlenbasis:** 9.530 Zeilen Produktivcode, 2.995 Zeilen Kommentar (22 %), 1.086 Leerzeilen;
7.578 Zeilen Tests; 252 KB Dokumentation.

**Verifikation:** `npm ci` sauber, `npm run lint --workspaces` grün, `apps/web` (60 Tests) und
`packages/shared-types` (102 Tests) grün. Die API-Suiten (Vitest + Prisma-Integration) wurden
nicht ausgeführt — dafür fehlt in dieser Umgebung ein Postgres-Container. Befund **W1** unten
ist stattdessen durch einen eigens geschriebenen, ausgeführten Test belegt.

Schweregrade: **Hoch** = jetzt beheben · **Mittel** = einplanen · **Niedrig** = bei nächster
Berührung mitnehmen.

**Stand der Behebung (25.08.2026):** Sämtliche Befunde in Abschnitt 1 (W1–W7), Abschnitt 2
(R1–R9) und Abschnitt 3 (L1–L7) sind behoben bzw. geprüft (Commits „Behebt W1–W3 […]",
„Behebt W4–W5 […]", „Behebt W6–W7 […]", „Behebt R1–R2 […]", „Behebt R3–R9 […]" und „Behebt
L1–L7 […]" auf diesem Branch) — mit sechs dokumentierten Abweichungen vom ursprünglichen
Befund-/Fix-Text: W3 nur auf den vier am dichtesten betroffenen Dateien (siehe dortiger
Status), W2s `SyncStoreSchema` bewusst nicht mit abgeleitet (siehe dortiger Status), R1s Fix
grundlegend überarbeitet, nachdem sich der ursprünglich vorgeschlagene
`openEntityForm()`-Mega-Helfer beim tatsächlichen Implementieren als nicht tragfähig erwies
(siehe dortiger Status für die Begründung und was stattdessen umgesetzt wurde), R4s
gemeinsamer `clubForm.js`-Helfer verzichtet in `admin.js`s Anlegen-Formular auf dessen
ursprüngliche 401-Sonderbehandlung (siehe dortiger Status), L1/L2s Zeilenschätzungen wurden
überschritten, weil die Sicherheitskommentare bewusst erhalten blieben statt sie im selben
Zug zu kürzen (siehe dortige Status), und L5 korrigiert den Befund selbst — `isEventProcessed()`
ist entgegen der ursprünglichen Analyse KEINE tote Testmethode, sondern der Idempotenz-Fast-Path
von `push()` (siehe dortiger Status). Verifiziert über `npm run lint/test/build/typecheck
--workspaces` (grün: 309 API- + 63 Web- + 102 Shared-Types- + 9 Sync-Protocol-Tests, 483
insgesamt), für R1, R3–R5/R8 und L3/L4/L6 zusätzlich im echten Browser gegen
`demo.html`/`admin/index.html`/`index.html` (Playwright: Formulare, Einstellungsdialog,
Ausrüstungs-Editor und Wettkampfmodus geöffnet/bedient, alle 14 Modul-Routen sowie alle drei
Einstiegspunkte ohne Konsolenfehler geladen) und für W7 gezielt gegen die neue
`no-bitwise`-Regel. Wie bei der ursprünglichen Verifikation oben stand auch in diesen
Folgesessions kein Postgres-Container zur Verfügung — die 309 API-Tests sind weiterhin die
Vitest-Suite gegen die `*.repository.memory.ts`-Doubles (`npm run test`), nicht die
Prisma-Integrationssuite (`npm run test:integration`), die dementsprechend erneut ungeprüft
blieb. Damit sind alle Befunde dieses Reviews mit Ausnahme der fortlaufenden Kommentar-Diät
(W3, Position 10 in Abschnitt 6) bearbeitet.

---

## Zusammenfassung

Die Architektur ist gut: klare Schichtung (Route → Service → Repository/Gateway), Repository-
Pattern mit In-Memory-Doubles, generische Sync-API über eine Entity-Registry statt zehn
Sonderpfaden, konsequentes `clubId`-Scoping, ein durchdachter CI-Lauf. Die
**Abhängigkeitshygiene ist vorbildlich** (Abschnitt 4) — dort gibt es nichts zu tun.

Die Wartbarkeitsprobleme liegen woanders und haben zwei gemeinsame Ursachen:

1. **Eine fachliche Wahrheit steht an sechs Stellen im Code** (W2) — und nur eine davon ist
   compilerseitig abgesichert. Ein elfter Store ließe sich hinzufügen, ohne dass irgendetwas
   fehlschlägt; er würde schlicht nie synchronisiert.
2. **Kommentare sind zum Änderungsprotokoll geworden** (W3). 239 Fundstellen verweisen auf
   frühere Review-Befunde oder beschreiben, wie der Code *vorher* aussah. In
   `sync.service.ts` stehen 384 Kommentarzeilen über 302 Zeilen Code.

Beide erzeugen dieselbe Kostenart: Wer eine Änderung machen will, muss erst die Geschichte
des Codes lesen, um seinen aktuellen Zustand zu verstehen — und findet trotzdem nicht alle
Stellen, die er anfassen muss.

Dazu kommen rund **700 Zeilen mechanisch duplizierter Code** (Abschnitt 2), fast vollständig
in zwei Mustern: Formular-Modals im Frontend und Fehler-Mapping in den API-Routen. Beide
lassen sich mit je einem Helfer auflösen.

**Empfohlene Reihenfolge:** W1 (echter Fehler) → W2 (stille Fehlerklasse) → R1/R2 (die
zwei großen Duplikatsmuster) → L1/L2 → W3 (Kommentar-Diät, am besten beiläufig bei jeder
Berührung).

---

## 1. Wartbarkeit

### W1 — Zwei Funktionen namens `uid()`, eine davon erzeugt ungültige IDs (Hoch)

**Status: behoben.** `libraryTransfer.js` importiert `uid()` jetzt aus `db.js` (UUID) für
`exercises.id`/`templates.id`; die Namenskollision ist aufgelöst, indem `utils.js`' Variante in
`localId()` umbenannt wurde (alle drei Aufrufstellen — `setEditor.js`, `comments.js`, die
eingebetteten Set-/Block-IDs in `libraryTransfer.js` selbst — entsprechend angepasst).
`test/libraryTransfer.test.js` prüft jetzt zusätzlich direkt gegen
`ExerciseSchema`/`TemplateSchema`, wie unten vorgeschlagen.

`apps/web/js/utils.js:6` und `apps/web/js/db.js:62` exportierten (Stand des Befunds) beide eine
Funktion `uid()`
mit **unterschiedlichem Ausgabeformat**:

```js
// utils.js  -> "id_mt8q5xry_9vorx8"   (kein UUID)
export function uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}_…`; }

// db.js     -> "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
export function uid(){ return crypto.randomUUID(); }
```

`apps/web/js/modules/libraryTransfer.js:23` importiert **die falsche** und vergibt damit in
`importLibrary()` die Primärschlüssel importierter Übungen und Vorlagen:

```js
import { el, uid, toast, openModal } from '../utils.js';   // Zeile 23
const id = uid();                                          // Zeile 129 — exercises.id
id: uid(),                                                 // Zeile 149 — templates.id
```

`ExerciseSchema`/`TemplateSchema` (`packages/shared-types/src/entities.ts:54,180`) verlangen
aber `id: z.string().uuid()`. **Jede importierte Übung und Vorlage scheitert damit beim
allerersten Sync-Push** — dauerhaft, und nach `MAX_SYNC_ATTEMPTS` (5, siehe
`syncClient.js:32`) landet das Event auf `status: 'failed'` und wird gar nicht mehr versucht.
Die Daten bleiben lokal auf dem importierenden Gerät und erreichen den Verein nie.

Belegt durch einen ad hoc geschriebenen und ausgeführten Test gegen das echte
`importLibrary()` und das echte Server-Schema:

```
GENERATED ID -> id_mt8q5xry_9vorx8
server schema accepts it? -> false
first issue -> {"validation":"uuid","code":"invalid_string","path":["id"]}
```

`test/libraryTransfer.test.js` deckt das nicht ab, weil es nur die lokale IDB-Wirkung prüft,
nicht die Gültigkeit gegen das Wire-Schema.

**Fix:** In `libraryTransfer.js` `uid` aus `db.js` importieren. Anschließend die
Namenskollision selbst auflösen — `utils.js`' Variante erzeugt bewusst *keine* UUIDs (sie ist
für eingebettete Set-/Block-/Kommentar-IDs gedacht, siehe `PlainSetSchema.id: z.string()`) und
sollte deshalb `localId()` o. Ä. heißen. Solange zwei gleichnamige Exporte mit
unterschiedlicher Semantik existieren, ist der nächste Fehlgriff nur eine Frage der Zeit.
Als Absicherung: den Import-Test um eine Prüfung gegen `ExerciseSchema`/`TemplateSchema`
erweitern.

*Nebenbefund:* Der Kommentar bei `CommentSchema` (`entities.ts:38`) behauptet, `id` sei dort
„bewusst kein UUID (wie z. B. bei `PlainSetSchema.id`)" — `PlainSetSchema.id` ist aber
ebenfalls `z.string()`, kein UUID. Der Verweis führt in die Irre.

### W2 — Die Liste der zehn fachlichen Stores steht sechsmal im Code (Hoch)

**Status: behoben** (mit einer Einschränkung). `ENTITY_STORE_NAMES` wird jetzt in
`packages/shared-types/src/entities.ts` per `Object.keys(ENTITY_SCHEMAS)` abgeleitet;
`entityRegistry.ts` und `sync.gateway.ts` (`ALL_STORES`) importieren diese eine Liste, statt sie
eigenständig zu pflegen. Für `apps/web/js/db.js` (`CLUB_SCOPED_STORES`) — strukturell weiterhin
nicht importierbar, siehe W6 — wurde stattdessen der vorgeschlagene Test ergänzt
(`test/db.test.js`), der die Liste gegen `ENTITY_STORE_NAMES` prüft.

**Abweichung vom ursprünglichen Fix-Vorschlag:** `SyncStoreSchema` (`syncEvent.ts`) wurde
NICHT ebenfalls aus `ENTITY_SCHEMAS` abgeleitet, wie unten vorgeschlagen — `entities.ts`
importiert bereits `SyncStoreSchema` von `syncEvent.ts` (für den `satisfies`-Constraint bei
`ENTITY_SCHEMAS`); eine Ableitung in die Gegenrichtung hätte einen Modul-Zyklus zwischen beiden
Dateien erzeugt. `SyncStoreSchema` bleibt daher die einzige weiterhin von Hand gepflegte Kopie —
mit compilerseitiger Absicherung über den bereits vorhandenen Test in
`packages/shared-types/test/entities.test.ts` (`ENTITY_SCHEMAS registry`), der prüft, dass
`ENTITY_SCHEMAS` für jeden fachlichen `SyncStoreSchema`-Wert einen Eintrag hat.

| Ort | Form | Compiler-Absicherung |
|---|---|---|
| `packages/shared-types/src/entities.ts:267` | `ENTITY_SCHEMAS` (Quelle von `EntityStoreName`) | — (kanonisch) |
| `packages/shared-types/src/syncEvent.ts:9` | `SyncStoreSchema` (z.enum) | keine |
| `apps/api/src/db/entityRegistry.ts:44` | `switch` in `getEntityDelegate()` | ja (`never`-Exhaustive) |
| `apps/api/src/db/entityRegistry.ts:59` | `ENTITY_STORE_NAMES` (Array) | **keine** |
| `apps/api/src/modules/sync/sync.gateway.ts:117` | `ALL_STORES` (Array) | **keine** |
| `apps/api/src/modules/sync/sync.service.ts:130` | `STORE_PERMISSIONS` | ja (`Record<EntityStoreName,…>`) |
| `apps/web/js/db.js:99` | `CLUB_SCOPED_STORES` (Set) | keine (anderer Workspace) |

Zwei Einträge sind abgesichert, die übrigen nicht. Konkret: `ALL_STORES` in
`sync.gateway.ts` ist die Liste, über die `listChangedSince()` iteriert — **sie allein
entscheidet, welche Stores beim Pull überhaupt betrachtet werden**. Ein elfter Store
(Schema in `entities.ts`, Delegate im `switch`, Rechte in `STORE_PERMISSIONS` — alles
compilerseitig eingefordert) ließe sich vollständig hinzufügen, ohne dass Build, Lint oder
Tests etwas melden. Push würde funktionieren, Pull würde ihn stillschweigend nie ausliefern:
Daten erreichen andere Geräte nie, ohne jede Fehlermeldung.

Genau diese Fehlerklasse hat das Projekt bei `STORE_PERMISSIONS` bereits erkannt und dort
sauber gelöst (siehe den Kommentar zur Whitelist-Entscheidung, `sync.service.ts:56-68`) — die
Lösung wurde nur nicht auf die übrigen Listen übertragen.

**Fix (klein, hoher Ertrag):**

```ts
// packages/shared-types/src/entities.ts
export const ENTITY_STORE_NAMES = Object.keys(ENTITY_SCHEMAS) as EntityStoreName[];
```

und `ENTITY_STORE_NAMES` sowie `ALL_STORES` von dort importieren statt neu zu tippen.
`SyncStoreSchema` lässt sich analog aus denselben Schlüsseln plus `'users'` bilden. Für
`apps/web/js/db.js` gilt W6 (kein gemeinsamer Ursprung möglich) — dort hilft ersatzweise ein
Test, der die Liste gegen `ENTITY_SCHEMAS` prüft.

### W3 — Kommentare sind zum Änderungsprotokoll geworden (Mittel)

**Status: teilweise behoben, wie unten empfohlen fortlaufend — mit einem offen benannten
Rückschritt durch die späteren Befund-Behebungen.** Auf den vier in der Tabelle unten am
dichtesten betroffenen Dateien (`sync.service.ts`, `security.ts`, `sync.gateway.ts`,
`syncClient.js`) sowie punktuell in `shell.js`, `invitations.service.ts`, `setEditor.js` und
dem inzwischen aufgeteilten `utils.js` (heute `dom.js`/`dates.js`/… — siehe L4) sind die
„Code-Review"/„Sicherheitsreview"/„Befund X"/„vormals"-Formulierungen durch Kommentare
ersetzt, die den AKTUELLEN Code erklären, ohne die zugrunde liegende Begründung zu verlieren.
Repo-weit sank die Zahl der Fundstellen (dieselbe Suche wie unten, gemessen über `src` +
Tests) von 239 auf 206.

**Nachtrag nach R1–R9/L1–L7 (ehrliche Korrektur zweier Aussagen dieses Status):** Die
Behebung der übrigen Befunde hat diesen Punkt teilweise zurückgedreht. Die Fix-Commits haben
**25 neue `Code-Review, Befund X`-Marker** eingeführt (Schwerpunkte: L4 mit 7, L2 mit 7, L3
mit 3) — genau die Kommentargattung, die dieser Befund als eigentliche Einstiegshürde
benennt. Zwei konkrete Aussagen oben sind dadurch überholt: `sync.service.ts` ist **nicht
mehr** „vollständig frei davon" (L1 und L2 haben je einen Marker ergänzt), und `utils.js`
existiert als Datei nicht mehr. Netto ist der Stand über den gesamten Branch ausgeglichen (35
solcher Zeilen ergänzt, 37 entfernt; src-only heute 109 Fundstellen), der *qualitative*
Rückschritt bleibt aber bestehen.

Zur Einordnung, ohne ihn kleinzureden: die neuen Marker sind überwiegend von der besseren
Sorte — sie erklären, **warum eine Datei so geschnitten ist** („diese Datei entstand aus der
Aufteilung von X"), statt wie das Negativbeispiel unten eine gelöschte Codezeile
nachzuerzählen. Trotzdem gilt für sie dieselbe Empfehlung wie für den Rest: bei nächster
Berührung durch Kommentare ersetzen, die den aktuellen Zustand aus sich heraus erklären.
Zusammen mit den übrigen offenen Stellen, insbesondere in `jobs/erasure.repository.ts` und
`config/env.ts` (beide unten in der Tabelle, weiterhin nicht angefasst), bleibt W3 damit
bewusst offen — als fortlaufende Aufgabe, kein Big-Bang.

Der Vorgänger-Review hat das als **W1** benannt; es ist der einzige Befund von dort, zu dem
sich kein Behebungs-Commit findet — und der Umfang ist seither gewachsen.

Messwerte:

| Datei | Zeilen | davon Kommentar | Anteil |
|---|---:|---:|---:|
| `plugins/security.ts` | 99 | 54 | 55 % |
| `modules/sync/sync.service.ts` | 737 | 384 | **52 %** |
| `jobs/erasure.repository.ts` | 150 | 75 | 50 % |
| `config/env.ts` | 99 | 50 | 50 % |
| `js/syncClient.js` | 201 | 98 | 49 % |
| `modules/sync/sync.gateway.ts` | 328 | 154 | 47 % |

239 Fundstellen enthalten „Code-Review", „Sicherheitsreview", „Befund X", „vormals",
„zuvor", „Nachtrag" oder „Sicherheitskorrektur".

Ein hoher Kommentaranteil ist per se kein Mangel — die *Art* der Kommentare ist es. Beispiel
aus `sync.gateway.ts:255`:

> „Aufräumarbeit (Code-Review): vormals `since ? 'update' : 'create'` — das unterstellte
> fälschlich, jede Zeile eines ERSTEN Pulls (since === null) sei eine Neuanlage. …"

*(Stand des Befunds — dieses konkrete Beispiel gehört inzwischen zu den behobenen Stellen;
der Kommentar an dieser Position erklärt jetzt nur noch, warum `action` nicht zwischen
"create" und "update" unterscheidet, ohne den früheren Zustand zu erwähnen.)*

Neun Zeilen über eine Codezeile, die es nicht mehr gibt. Wer `listChangedSince()` ändern will,
muss diesen Absatz lesen, um festzustellen, dass er nichts über das aktuelle Verhalten sagt.
Bei 239 solchen Stellen summiert sich das zur eigentlichen Einstiegshürde des Projekts.

Dazu kommt: Diese Kommentare veralten unbemerkt. `sync.gateway.ts:44` erklärte (Stand des
Befunds), dass `create()`/`update()`/`softDelete()`/`markEventProcessed()` „als PRIMITIVE
bestehen blieben" — tatsächlich ruft sie inzwischen **kein Produktivcode mehr auf**, nur noch
`test-integration/syncGateway.integration.test.ts`. Das Interface trägt fünf Methoden, die
jede Implementierung (Prisma *und* In-Memory) erfüllen muss, obwohl nur die Tests sie brauchen
(siehe L5 — dieser strukturelle Befund selbst ist unverändert offen, nur der veraltete
Kommentar dazu wurde korrigiert).

**Fix:** Die Faustregel des Projekts umdrehen — ein Kommentar erklärt, *warum der Code so
ist*, nie *wie er vorher war*. Die Historie steht in `git log` und in
`docs/code-review-2026-08.md`, beides verlustfrei und durchsuchbar. Konkret:

- Sätze mit „vormals", „zuvor", „bislang", „Befund X" streichen; die verbleibende
  Begründung (falls es eine gibt) in einen Satz Gegenwartsform überführen.
- Erhaltenswert sind die *Warum*-Kommentare, von denen es hier viele gute gibt — etwa die
  Begründung für `skipDuplicates` statt `create()+catch(P2002)` (`sync.gateway.ts:296`) oder
  für `useDefaults: false` bei Helmet (`security.ts:46`). Diese sollen bleiben.
- Kein Big-Bang: bei jeder Berührung einer Datei mitnehmen. Realistisch entfallen dabei
  1.200–1.500 der 2.995 Kommentarzeilen.

Als Ankerpunkt für die Größenordnung: `sync.service.ts` schrumpft dadurch von 737 auf etwa
420 Zeilen, ohne dass eine Zeile Logik angefasst wird.

### W4 — Zirkuläre Abhängigkeit `db.js` ↔ `state.js` (Mittel)

**Status: behoben**, über die zweite der beiden vorgeschlagenen Optionen: `db.js` exportiert
jetzt `setClubIdProvider(fn)` (Default: liefert `undefined`) statt `getCurrentUser` direkt zu
importieren; `state.js` registriert beim Laden `setClubIdProvider(() => getCurrentUser()?.clubId)`.
Der Zyklus ist damit vollständig aufgelöst (erneut per Skript geprüft: 0 Zyklen im
Frontend-Importgraph). `test/db.test.js` mockt `state.js` jetzt nicht mehr — es registriert
stattdessen direkt einen Test-Provider, wie unten durch den Fix versprochen; das einzig
verbliebene `state.js`-Mock in `test/libraryTransfer.test.js` betrifft eine andere,
unveränderte Abhängigkeit (`libraryTransfer.js` importiert `getCurrentUser` selbst, für
`bulkPut()`-Aufrufe, die nicht über `db.js`' automatische clubId-Ergänzung laufen — kein Teil
dieses Zyklus).

`apps/web/js/db.js:5` importierte (Stand des Befunds) `getCurrentUser` aus `state.js`;
`state.js:19` importierte `wipeAll` aus `db.js`. Das war der einzige Zyklus im
Frontend-Importgraph (162 Kanten geprüft).

Er funktioniert heute, weil beide Seiten die Gegenimporte erst zur Aufrufzeit auswerten, nicht
beim Modulladen. Er ist trotzdem aus zwei Gründen zu beheben:

1. **Richtungsumkehr:** Die Persistenzschicht kennt die Sitzungsschicht. `put()` schlägt die
   `clubId` der eingeloggten Person nach (`db.js:117`) — eine fachliche Regel in einem
   Modul, dessen Aufgabe „generisches CRUD auf IndexedDB" ist. Deshalb muss auch jeder Test,
   der `db.js` anfasst, `state.js` mocken (siehe `test/libraryTransfer.test.js:8`).
2. **Fragilität:** Zöge einer der beiden Importe künftig auf Modulebene (eine Konstante, ein
   `setLocale()`-Aufruf beim Laden), bekäme die andere Seite `undefined` — mit einem
   Fehlerbild, das weit vom Verursacher entfernt auftritt.

**Fix:** `clubId` als optionalen Parameter an `put()` übergeben, oder einen Setter
(`db.setClubIdProvider(fn)`) im Bootstrap verdrahten. Der Zyklus verschwindet, `db.js` wird
ohne Mock testbar.

### W5 — Kein Test auf Schlüsselgleichheit der Sprachdateien (Niedrig)

**Status: behoben.** `test/i18n.test.js` enthält jetzt einen `describe('Vollständigkeit der
Sprachdateien')`-Block, der jedes registrierte `LOCALES`-Wörterbuch (nicht nur `en-US`
hartcodiert) gegen die abgeflachten Schlüssel von `de-DE` prüft — eine künftige dritte
Sprache ist damit automatisch mit abgedeckt, wie unten vorgeschlagen. Verifiziert, dass der
Test tatsächlich greift: ein testweise in `en-US.js` eingefügter zusätzlicher Schlüssel ließ
den Test mit einer klaren Diff-Ausgabe fehlschlagen, bevor die Änderung wieder verworfen wurde.

`js/i18n/de-DE.js` und `js/i18n/en-US.js` haben je 837 Schlüssel und sind aktuell **exakt
deckungsgleich** (geprüft). Es gibt aber nichts, das das erhält: `t()` fällt bei fehlendem
Schlüssel still auf Deutsch zurück (`i18n.js:72`), und `test/i18n.test.js` prüft nur die
Platzhalter-Ersetzung. Ein in `de-DE.js` ergänzter Schlüssel erscheint der englischen
Oberfläche daher als deutscher Text — ohne Warnung in Lint, Test oder Konsole.

**Fix:** Fünf Zeilen Test:

```js
it('en-US hat exakt dieselben Schlüssel wie de-DE', () => {
  expect(flatKeys(en_US).sort()).toEqual(flatKeys(de_DE).sort());
});
```

Das gilt automatisch auch für jede künftige dritte Sprache, wenn man über `LOCALES` iteriert.

### W6 — `apps/web` kann `packages/shared-types` nicht nutzen (Niedrig, strukturell)

**Status: behoben** — als Nebeneffekt der W2-Behebung. Der dort ergänzte Test
(`apps/web/test/db.test.js`, `describe('CLUB_SCOPED_STORES')`) importiert `ENTITY_STORE_NAMES`
direkt aus `packages/shared-types/src/entities.ts` und prüft `CLUB_SCOPED_STORES` dagegen — das
ist exakt die unten skizzierte Minimalvariante. `STORES` (die volle Store-Liste inkl. rein
lokaler Stores wie `meta`/`syncQueue`/`users`/`clubs`/`invitations`) bleibt bewusst ungeprüft:
dafür gibt es keine vergleichbare serverseitige Referenzliste — nur `CLUB_SCOPED_STORES` (die
zehn mandantenfähigen Stores) hat ein server-seitiges Gegenstück (`ENTITY_STORE_NAMES`), gegen
das sich Drift überhaupt feststellen ließe. Die aufwendigere erste Option (vorgebautes
ESM-Bundle nach `apps/web/vendor/`) wurde nicht umgesetzt — nicht nötig, seit die
Minimalvariante die eigentliche Lücke bereits schließt.

`apps/web` ist bewusst build-frei (Vanilla-ESM, direkt vom Webserver ausgeliefert) und kann
deshalb weder die Zod-Schemas noch die Store-Namen aus `packages/shared-types` importieren —
beides ist TypeScript. Die Folge ist die Frontend-Hälfte von W2: `STORES` und
`CLUB_SCOPED_STORES` in `db.js` sind handgepflegte Kopien, und das Frontend kann seine
Payloads nicht gegen dieselben Schemas prüfen, an denen der Server sie misst (genau darum
fällt W1 erst serverseitig auf).

Das ist eine bewusste, dokumentierte Abwägung und **kein Fehler** — aber sie hat einen Preis,
der bislang nirgends festgehalten ist. Zwei gangbare Wege ohne Aufgabe der Build-Freiheit:

- `packages/shared-types` zusätzlich als vorgebautes ESM-Bundle nach `apps/web/vendor/`
  ausliefern (ein `npm run build`-Schritt, den nur *das Paket* braucht, nicht die App).
- Minimalvariante: ein Vitest-Test in `apps/web`, der `STORES`/`CLUB_SCOPED_STORES` gegen die
  kompilierten `ENTITY_SCHEMAS` prüft — Tests dürfen TypeScript laden, die ausgelieferte App
  nicht.

Die zweite Variante kostet zehn Zeilen und schließt die Lücke dort, wo sie wehtut.

### W7 — `&` statt `;` in zwei Callback-Ausdrücken (Niedrig)

**Status: behoben.**

- `competitions.js:85` nutzt jetzt `refreshDetail` — einen bereits vorhandenen, in derselben
  `renderDetail()`-Funktion definierten Helfer (`async function refreshDetail() {
  clear(container); renderDetail(container, compId); }`, schon von drei anderen
  Callbacks in derselben Datei genutzt: Ergebnis hinzufügen/löschen, Startlisten-Eintrag
  hinzufügen). Sauberer als der ursprünglich vorgeschlagene `void`-Wrapper, da er dieselbe,
  bereits existierende und bereits an vier Stellen bewährte Refresh-Logik wiederverwendet,
  statt sie ein fünftes Mal zu schreiben.
- `athletes.js:116` — hier gab es (anders als in `competitions.js`) keinen entsprechenden
  Helfer; `navigate('athletes', athleteId)` und `location.reload()` sind beide synchron, ein
  `await`-bedingtes Timing-Risiko wie beim ersten Fall bestand hier nicht. Ersetzt durch
  `() => { navigate('athletes', athleteId); location.reload(); }` — funktional unverändert
  (beide Aufrufe liefen wegen der Kurzschluss-freien Auswertung von `&` ohnehin bereits in
  dieser Reihenfolge), aber ohne den irreführenden bitweisen Operator.
- `no-bitwise: 'error'` in `packages/shared-config/eslint-preset.cjs` ergänzt (gilt für ALLE
  Workspaces über die gemeinsame Basis) — TypeScripts `|`/`&` in Typausdrücken (Union/
  Intersection Types) sind ein eigener Syntaxknoten und lösen die Regel nicht aus, geprüft
  über `npm run lint --workspaces` (weiterhin grün) sowie einen gezielten Test: ein testweise
  eingefügter `1 & 2`-Ausdruck wurde zuverlässig als `no-bitwise`-Fehler gemeldet.

```js
// modules/competitions.js:85 (Stand des Befunds)
onclick: () => openCompModal(comp, () => renderDetail(container, compId) & clear(container))
// modules/athletes.js:116 (Stand des Befunds)
onclick: () => openAthleteModal(athlete, groups, () => navigate('athletes', athleteId) & location.reload())
```

Das ist der **bitweise Und-Operator** auf ein Promise und `undefined` — das Ergebnis (`0`)
wird verworfen; der Ausdruck „funktioniert" nur, weil beide Operanden ausgewertet werden.
In `competitions.js` läuft `clear(container)` dadurch *nach* dem Start von `renderDetail()`,
aber *vor* dessen erstem `await`-Ende — die Reihenfolge stimmt rein zufällig und kippt, sobald
`renderDetail()` seine ersten Zeilen umstellt.

**Fix:** `() => { void renderDetail(container, compId); }` bzw. den Aufruf sauber sequenzieren.
Eine ESLint-Regel (`no-bitwise`) fängt beide Stellen und alle künftigen.

---

## 2. Redundanzen

Rund **700 Zeilen** mechanisches Duplikat, davon ~600 in zwei Mustern.

### R1 — 16 fast identische Formular-Modals (~450 Zeilen) (Hoch)

**Status: teilweise behoben — mit einer wichtigen Korrektur am Fix-Vorschlag.** Beim
tatsächlichen Implementieren stellte sich heraus, dass der unten vorgeschlagene
`openEntityForm({ title, entity, defaults, fields, validate, save })`-Mega-Helfer in der
Praxis nicht trägt: die Feld-Zusammensetzung variiert zwischen den Modalen weit stärker, als
sich aus einer Höhenübersicht erkennen ließ — dynamische Tageslisten mit eingebettetem
Set-Editor und Vorlagen-Einfügung (`openPlanModal`), eine Anwesenheitstabelle, die sich beim
Gruppenwechsel komplett neu aufbaut (`openSessionModal`), ein eingebetteter, sofort
speichernder Kommentar-Thread (`openExerciseModal`), umschaltbare Ausrüstungs-Pills mit
eigenem Zustand (`openExerciseModal`), eine Berechtigungsprüfung mit frühem Abbruch vor dem
Aufbau des Formulars (`openAthleteModal`). Ein deklaratives `fields`-Array kann das nicht
abbilden, ohne selbst zu einer vollständigen zweiten DOM-Bau-Sprache zu werden — der Helfer
wäre am Ende undurchsichtiger als die 16 einzelnen, aber jeweils linear lesbaren Funktionen,
die er ersetzen sollte (siehe die generelle Warnung vor Abstraktionen, die mehr verstecken als
sie sparen).

Tatsächlich **identisch** ist dagegen genau ein Baustein: der vierzeilige
Abbrechen/Speichern-Knopfblock am Fußende. Der wurde extrahiert
(`formActions({ onCancel, submitLabel, extraClass, spanFull })` — damals in
`apps/web/js/utils.js`, seit L4 in `apps/web/js/forms.js`; gibt
zusätzlich zum fertigen Element den Submit-Button selbst zurück, für die drei Modals, die ihn
während eines laufenden Speichervorgangs deaktivieren) und in **13 der 17** `openXModal()`-
Funktionen im Frontend eingesetzt (die tatsächliche Gesamtzahl — vier davon sind gar keine
Entity-Formulare und blieben deshalb bewusst unangetastet: `openGroupModal`, eine dauerhafte
Liste+Anlegen-Zeile ohne Abbrechen-Knopf; `openImportConfirmModal`, ein reiner
Bestätigungsdialog ohne Datenfelder; `openDeleteAccountModal`, eine löschende Bestätigung mit
Texteingabe-Verifikation; `openClubMembersModal`, eine reine Anzeige ohne Formular). Ersparnis:
39 Zeilen an den 13 Aufrufstellen, abzüglich 21 Zeilen für den neuen Helfer — netto 18 Zeilen,
deutlich weniger als die ursprünglich geschätzten ~250, aber ohne den Interpretationsaufwand
einer Konfigurations-API für hochgradig unterschiedliche Formulare. Jede der 13 konvertierten
Stellen wurde gegen das Original diffed (Klassen, Styles, Labels, Reihenfolge) und zusätzlich
im echten Browser gegen `demo.html` geprüft (Playwright: vier Modals geöffnet, Feldanzahl und
Beschriftung geprüft, ein Datensatz tatsächlich angelegt und in der Liste bestätigt, danach im
Bearbeiten-Modus erneut geöffnet und die "Speichern"-Beschriftung verifiziert).

Ursprünglicher Befund (Stand der Analyse, vor der obigen Korrektur):

`openCompModal`, `openEntryModal`, `openResultModal`, `openAthleteModal`, `openGroupModal`,
`openExerciseModal`, `openTemplateModal`, `openPlanModal`, `openSessionModal`, `openTimeModal`,
`openItemModal`, `openInviteModal`, `openCreateClubModal` (2×), … folgen alle demselben
Sechs-Schritt-Gerüst:

```js
function openXModal(entity, …, onSaved) {
  const isEdit = !!entity;
  const data = entity ? { ...entity } : { /* Defaults */ };
  const form = el('form', { class: 'form-grid' });
  const fA = textInput(data.a); /* … Felder … */
  form.appendChild(field(t('…'), fA, { span2: true })); /* … */
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (/* Validierung */) { toast(t('…'), 'error'); return; }
    await put('store', { ...data, /* Felder */ });
    toast(isEdit ? t('…') : t('…'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('…') : t('…'), bodyNode: form, wide: true });
}
```

Der vierzeilige `form-actions`-Block steht 14× wortgleich da. Variabel sind ausschließlich:
Feldliste, Validierung, Speicherzuordnung, vier Übersetzungsschlüssel.

Nebenwirkung: In allen 16 Fällen wird `close()` in Handlern verwendet, die **vor** der
`const { close } = openModal(…)`-Zeile definiert werden. Das funktioniert (der Handler läuft
erst nach der Initialisierung), ist aber unnötig subtil — und wer das Muster kopiert und
`openModal()` versehentlich weiter nach oben zieht, bekommt eine `TemporalDeadZone`-Fehlermeldung
an einer Stelle, die nichts damit zu tun hat.

**Fix:** Ein Helfer in `utils.js`:

```js
export function openEntityForm({ title, entity, defaults, fields, validate, save, wide = true }) { … }
```

Jedes Modal schrumpft von ~28 auf ~12 Zeilen (Feldliste + Validierung + Speicherzuordnung).
Ersparnis: ~250 Zeilen; wichtiger ist, dass Änderungen am Modal-Verhalten (Fokus-Falle,
Escape-Handling, Doppelklick-Schutz auf Speichern) danach *an einer* Stelle stattfinden.
Heute müsste man sie 16-mal nachziehen — und 16-mal daran denken.

### R2 — Route-Boilerplate: 9× Validierung, 29× Fehler-Mapping (Hoch)

**Status: behoben, wie unten vorgeschlagen — mit einer Zahlenkorrektur.** Nachgezählt tragen
`auth.route.ts` und `invitations.route.ts` zusammen tatsächlich 22 `instanceof`-Zweige, nicht
29 — die 29 zählten offenbar (die ursprüngliche Analyse nannte keine Fundstellen) auch
`instanceof`-Vorkommen außerhalb der HTTP-Fehler-Zuordnung mit (u. a. `auth.service.ts`s
eigene interne Fehler-Übersetzung beim Einlösen einer Einladung, `authenticate.ts`,
`tokens.ts`) — andere Zuständigkeit, absichtlich nicht Teil dieses Umbaus. Beide Teile des
Fix-Vorschlags wurden umgesetzt:

1. `apps/api/src/plugins/httpErrorHandler.ts` (neu, 109 Zeilen): eine `Map<ErrorKlasse, {
   status, code }>` mit allen 17 unterscheidbaren Fehlerklassen, registriert über
   `app.setErrorHandler()` auf der Wurzelinstanz (siehe `app.ts`). Alle try/catch-Blöcke in
   `auth.route.ts` entfielen dadurch vollständig (12 Zweige, alle deckungsgleich mit der
   Registry). In `invitations.route.ts` entfiel ebenfalls jedes catch bis auf eines: `preview()`
   behält bewusst ein lokales catch für `InvitationNotFoundError` (410 statt der
   registrierten 404) — genau der unten beschriebene Fall, jetzt als bewusste, kommentierte
   Ausnahme sichtbar statt als unbemerkte Abweichung.
2. `apps/api/src/plugins/parseInput.ts` (neu, 22 Zeilen): `parseInput(schema, data, reply)`
   ersetzt die neun wortgleichen Validierungsblöcke (acht gegen `request.body`, einer —
   `GET /api/sync/pull` — gegen `request.query`; als ein Parameter statt zweier Funktionen,
   da beide identisch funktionieren).

Ergebnis: `auth.route.ts` 240 → 167 Zeilen, `invitations.route.ts` 112 → 100, `sync.route.ts`
59 → 55 (−89 Zeilen an den drei Routen-Dateien zusammen), gegen +131 Zeilen für die beiden
neuen, wiederverwendbaren Dateien — netto +42 Zeilen repo-weit, aber die Fehler-Zuordnung
steht jetzt an einer Stelle statt über 22 Zweige verteilt. Verifiziert über die volle
API-Testsuite (309 Tests, ausschließlich statusCode-Erwartungen — bestätigt, dass sich am
beobachtbaren Verhalten nichts geändert hat) sowie `typecheck`/`build`/`lint`, alle grün.

Jeder der neun Route-Handler beginnt gleich:

```ts
const parsed = XSchema.safeParse(request.body);
if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
```

und jeder mit einem Fehlerpfad endet auf einer handgeschriebenen `instanceof`-Kette
(29 Zweige in `auth.route.ts`, `invitations.route.ts`):

```ts
if (err instanceof ForbiddenError)          return reply.code(403).send({ error: 'forbidden',            message: err.message });
if (err instanceof ClubNotFoundError)       return reply.code(404).send({ error: 'club_not_found',       message: err.message });
if (err instanceof AthleteClubMismatchError) return reply.code(400).send({ error: 'athlete_club_mismatch', message: err.message });
throw err;
```

Die Kosten sind bereits messbar: **`InvitationNotFoundError` wird an einer Stelle auf 410,
an einer anderen auf 404 abgebildet** (`invitations.route.ts:46` vs. `:107`). Im Kontext
jeweils vertretbar — aber dass die Abweichung existiert und niemandem auffiel, ist genau das
Symptom: Es gibt keine Stelle, an der man die Abbildung im Ganzen sehen könnte.

**Fix, zwei Teile:**

1. Eine zentrale Fehler-Registry plus `app.setErrorHandler()`:

   ```ts
   const HTTP_ERRORS = new Map<Function, { status: number; code: string }>([
     [ForbiddenError,          { status: 403, code: 'forbidden' }],
     [ClubNotFoundError,       { status: 404, code: 'club_not_found' }],
     [InvalidInvitationError,  { status: 410, code: 'invalid_invitation' }],
     // …
   ]);
   ```

   Die `try/catch`-Blöcke in den Handlern entfallen dann vollständig. Wo eine Route bewusst
   abweicht (410 statt 404), bleibt ein lokaler `catch` stehen — dann aber sichtbar als
   Ausnahme von der Regel, nicht als eine unter 29 gleich aussehenden Zeilen.
2. Ein `parseBody(schema, request, reply)`-Helfer oder Fastifys eingebauter
   `schema`-Support für die neun Validierungsblöcke.

Ersparnis: ~120 Zeilen; der eigentliche Gewinn ist, dass „Welcher Fehler wird zu welchem
Status?" wieder in einem Bildschirm lesbar ist.

### R3 — `app.js` / `app-demo.js`: Modul-Registrierung und Einstellungen doppelt (Mittel)

**Status: behoben, wie vorgeschlagen.** `js/moduleRegistry.js` (neu) enthält die 14
Modul-Imports und exportiert `registerAllModules()`; beide Bootstrap-Dateien rufen nur noch
diese eine Funktion auf. `shell.js` exportiert `setupSettingsModal({ storageNoteKey,
exportPrefix, getExportData, extraActions })`; beide Aufrufer übergeben ihre jeweiligen
Abweichungen (Hinweistext, Datei-Präfix, Export-Quelle, ob ein Zurücksetzen-Knopf existiert)
als Parameter. Eine Stolperfalle beim Implementieren: `storageNoteKey` wird bewusst als
Übersetzungs**schlüssel** (nicht als bereits übersetzter Text) übergeben und `extraActions`
bewusst als Fabrikfunktion (nicht als fertiges Array) — beide werden dadurch bei **jedem**
Öffnen des Dialogs frisch ausgewertet, statt einmalig beim Modul-Laden. Ohne diese
Unterscheidung hätte die Konsolidierung die Live-Sprachumschaltung im Einstellungsdialog
stillschweigend zerstört, die vorher funktionierte, weil `t(...)` in der lokalen Kopie jedes
Mal neu aufgerufen wurde. Im echten Browser gegen `demo.html` geprüft (Playwright: Dialog
geöffnet, Sprache von Deutsch auf Englisch umgeschaltet, Hinweistext aktualisiert sich
korrekt bei beiden Öffnungen). Zusätzlich gegen `index.html` und `demo.html` auf
Konsolenfehler beim Laden geprüft (keine).

Befund **R1** des Vorgänger-Reviews („~130 Zeilen Duplikat") ist nur teilweise behoben — der
Shell-Teil ist nach `shell.js` gewandert, aber es stehen weiterhin ~60 Zeilen wortgleich in
beiden Dateien:

- die 14 Modul-Imports plus der `.forEach(registerModule)`-Block (`app.js:40-57` ≡
  `app-demo.js:26-43`) — **wortgleich, inklusive Zeilenumbruch im Array**;
- `openSettings()` (~13 Zeilen, unterscheidet sich in zwei Zeilen);
- `exportData()` (unterscheidet sich im Dateinamens-Präfix);
- der `btn-settings`-Listener.

Konkrete Folge: Ein neues Modul muss an **zwei** Stellen registriert werden. Vergisst man
`app-demo.js`, fehlt es lautlos nur in der Demo.

**Fix:** `js/moduleRegistry.js` mit den Imports und einem `registerAllModules()`-Export;
`openSettings({ storageNote, exportPrefix, extraActions })` nach `shell.js`.

### R4 — `openCreateClubModal` existiert zweimal — mit eigenem Übersetzungssatz (Mittel)

`apps/web/admin/admin.js:174` und `apps/web/js/modules/userManagement.js:183` sind bis auf
Übersetzungsschlüssel und Erfolgsbehandlung identisch (je ~40 Zeilen, gleiche Feldnamen,
gleiche E-Mail-Regex, gleiche `errorBox`-Mechanik, gleiche `submitBtn.disabled`-Logik).

Doppelt kostet das nicht nur Code: Es gibt zwei parallele i18n-Schlüsselsätze für dieselben
Beschriftungen (`admin.formClubName` / `usermgmt.formClubName`, `admin.formAdminEmail` /
`usermgmt.formAdminEmail`, …) — **in beiden Sprachdateien**, also vier Stellen je Label.
Ändert sich die Formulierung, ist der Drift vorprogrammiert.

**Fix:** Die Funktion nach `js/modules/clubForm.js` ziehen (sie hängt nur an `apiClient`,
`utils`, `i18n` — alles, was `admin.js` laut eigenem Dateikopf ohnehin schon einbindet), die
Erfolgsbehandlung als Callback übergeben, den `admin.*`-Schlüsselsatz zugunsten von
`usermgmt.*` auflösen.

**Status: behoben, wie vorgeschlagen.** `js/modules/clubForm.js` (neu) exportiert
`openCreateClubModal({ onSuccess })`; Felder, Validierung, `errorBox`-Mechanik und
`usermgmt.*`-Schlüssel sind jetzt genau einmal vorhanden. `userManagement.js` übergibt einen
`onSuccess`, der Toast + `onChanged?.()` + `showInviteLinkModal(...)` reproduziert; `admin.js`
übergibt einen `onSuccess`, der stattdessen `admin.clubCreatedMailSent` toastet und die
Vereinsliste neu lädt — genau die Abweichung, die laut Befund beim jeweiligen Aufrufer bleiben
sollte. Die vier `admin.*`-Schlüssel (`formClubName`, `formAdminName`, `formAdminEmail`,
`createClubModalTitle`) wurden aus beiden Sprachdateien entfernt, nachdem ein Repo-weites Grep
bestätigte, dass sie nirgends mehr referenziert werden; `admin.clubCreatedMailSent` (fachlich
verschieden vom `usermgmt`-Pendant) blieb erhalten. Eine Abweichung vom Ist-Zustand vor dem
Fix: `admin.js`s Fehlerbox in diesem einen Formular zeigt bei einem 401 jetzt die generische
Fehlermeldung statt (wie zuvor lokal in `admin.js` üblich) `auth.errorInvalidCredentials` —
der geteilte Helfer kennt diese Sonderbehandlung bewusst nicht (sie ist Aufrufer-spezifisch,
siehe R5), und ein 401 mitten im Anlegen-Formular einer bereits laufenden Superadmin-Sitzung
ist ein seltener Randfall (abgelaufenes Token), für den die generische Meldung ausreicht.
Verifiziert über Lint, die volle Testsuite (483 Tests) und einen Playwright-Lauf gegen
`admin/index.html`, `index.html`, `demo.html` (keine Konsolenfehler beim Laden, alle drei
Einstiegspunkte importieren die neuen Module fehlerfrei).

### R5 — `describeError()` dreimal, mit drei Schlüsselpaaren (Niedrig)

`profile.js:176`, `userManagement.js:358`, `admin/admin.js:121` — dieselbe Funktion, jeweils
mit eigenen `*.errorNetwork`/`*.errorUnknown`-Schlüsseln. Die deutschen Texte sind bereits
heute **wortgleich** (`de-DE.js:27,323,328,359`: „Server nicht erreichbar. Bitte
Internetverbindung prüfen.").

**Fix:** Eine Funktion in `apiClient.js` (dort leben `ApiError`/`NetworkError` ohnehin), ein
Schlüsselpaar `common.errorNetwork`/`common.errorUnknown`. Die Sonderbehandlung von 401 aus
`admin.js` als optionaler Parameter.

**Status: behoben, wie vorgeschlagen.** `apiClient.js` exportiert jetzt
`describeError(err, { on401Message } = {})`, das die schon vorhandenen, aber bis dahin
ungenutzten Schlüssel `common.errorNetwork`/`common.errorUnknown` nutzt. `profile.js` und
`userManagement.js` importieren die Funktion direkt und haben ihre lokalen Kopien entfernt
(`userManagement.js`s eigene Kopie hatte zusätzlich einen unabhängigen, redundanten
`NetworkError`/`ApiError`-Ternary in `renderError()`, der bei dieser Gelegenheit auf denselben
Helfer umgestellt wurde). `admin/admin.js` importiert die Funktion ebenfalls, behält aber einen
lokalen Einzeiler `describeAdminError = (err) => describeError(err, { on401Message:
t('auth.errorInvalidCredentials') })` für seine drei ursprünglichen Aufrufstellen (Login,
Vereinsliste laden) — genau der optionale Parameter aus dem Fix-Vorschlag, mit der einen
bewussten Ausnahme in `clubForm.js` (siehe R4-Status). Verifiziert über Lint und die volle
Testsuite (483 Tests).

### R6 — IndexedDB-Request→Promise-Boilerplate zehnmal (Niedrig)

`db.js` wiederholt zehnmal dasselbe Muster:

```js
return new Promise((resolve, reject) => {
  const req = os.getAll();
  req.onsuccess = () => resolve(req.result || []);
  req.onerror = () => reject(req.error);
});
```

**Fix:** `const p = (req, map = r => r) => new Promise((res, rej) => { req.onsuccess = () => res(map(req.result)); req.onerror = () => rej(req.error); });`
Ersparnis ~40 Zeilen, und `db.js` wird auf einen Blick lesbar.

**Status: behoben, wie vorgeschlagen.** `db.js` enthält jetzt `reqPromise(req, map = r => r)`
genau nach diesem Muster; alle zehn Fundstellen (`getAll`, `get`, `put`, `putWithoutSync`,
`remove`, `removeWithoutSync`, `clearStore`, `countAll`, `clearSyncedEvents`,
`pendingSyncCount`) rufen sie jetzt auf, statt die drei Zeilen erneut auszuschreiben.
`bulkPut()` und die beiden transaktionsweiten Löschungen in `clearSyncedEvents()` bleiben
unverändert — sie hängen an `transaction.oncomplete`/`onerror` statt an
`request.onsuccess`/`onerror` und passen nicht in dasselbe Muster. Ersparnis: 30 Zeilen (352 →
322). Verifiziert über Lint und die volle Testsuite (483 Tests, darunter alle `db.js`-Aufrufer
in `apps/web`).

### R7 — Konstante definiert, dann als Literal wiederholt (Niedrig)

`sync.service.ts:254` definiert `FOREIGN_ENTITY_ERROR`; `describeSyncError()` in derselben
Datei (Zeile 730) schreibt denselben Satz noch einmal als String-Literal aus. Der Kommentar
dazwischen erklärt sogar ausdrücklich, dass beide identisch *sein müssen* („Bewusst dieselbe
Formulierung … schließt so das Existenz-Orakel") — und verlässt sich dann auf Handarbeit.
Die Konstante steht direkt darüber.

**Status: behoben.** `describeSyncError()`s `P2003`-Zweig gibt jetzt `FOREIGN_ENTITY_ERROR`
zurück statt den Satz erneut als Literal auszuschreiben. Verifiziert über Lint, `typecheck`
und die volle API-Testsuite (309 Tests, darunter die bestehenden Tests für beide
Aufrufstellen der Konstante).

### R8 — Toter Code (Niedrig)

Nirgends importiert: `nowISO`, `daysBetween`, `avatarInitials`, `debounce` (alle `utils.js`),
`hasAccessToken` (`apiClient.js`), `WEEKDAYS` (`refdata.js`).

Zusätzlich `competitions.js:52`:

```js
const [c2, a2] = await Promise.all([getAll('competitions'), getAll('athletes')]);
renderList(container, c2, a2);       // renderList nimmt nur (container, competitions)
```

`a2` — ein vollständiger `getAll('athletes')` — wird bei jedem Refresh der Wettkampfliste
geladen und sofort verworfen.

**Status: behoben, wie beschrieben.** `nowISO`, `daysBetween`, `avatarInitials`, `debounce`
(`utils.js`), `hasAccessToken` (`apiClient.js`) und `WEEKDAYS` (`refdata.js`) entfernt —
jeweils per Repo-weitem Grep bestätigt, dass keine andere Datei sie importiert.
`competitions.js`s `refresh()` lädt jetzt nur noch `getAll('competitions')` und übergibt es an
`renderList(container, c2)`, ohne den verworfenen zweiten Parameter. Verifiziert über Lint,
die volle Testsuite (483 Tests) und einen Playwright-Lauf gegen `demo.html`, der gezielt zur
Wettkampf-Ansicht navigiert und danach erneut (löst `refresh()` indirekt über einen
Modul-Wiedereinstieg aus) — keine Konsolenfehler.

### R9 — `listClubMembers` / `listAssignableTrainers` (Niedrig)

`auth.service.ts:351` und `:372` teilen sich Abruf, Sortierung und `toPublicUser`-Mapping und
unterscheiden sich nur in Filter und Sortierkriterium. Eine gemeinsame private Hilfsfunktion
`listMembers(clubId, { filter, compare })` genügt.

**Status: behoben, wie vorgeschlagen.** `createAuthService()` enthält jetzt die lokale
Hilfsfunktion `listMembers(clubId, { filter, compare })`; `listClubMembers()` ruft sie mit der
bestehenden Rollen-dann-Name-Sortierung ohne Filter auf, `listAssignableTrainers()` mit dem
Trainer/Admin-Filter und reiner Namenssortierung. Verifiziert über Lint, `typecheck` und die
volle API-Testsuite (309 Tests, darunter die bestehenden Tests für beide Endpunkte).

---

## 3. Überlange Methoden und Klassen

### L1 — `syncService.push()`: 218 Zeilen in einer Schleife (Hoch)

`sync.service.ts:391-608`. Der Rumpf ist eine `for`-Schleife über die Events mit **acht
aufeinanderfolgenden Prüfstufen**, die alle nach demselben Schema abbrechen
(`results.push({… status: 'error' …}); continue;`):

1. `SyncEventSchema.safeParse` · 2. `isKnownStore` · 3. `canWrite` · 4. `isEventProcessed`
· 5. Payload gegen `ENTITY_SCHEMAS` · 6. `createdAt`/`updatedAt` entfernen · 7. `clubId`-Abgleich
· 8. Fremdschlüssel-Eigentümerprüfung — dann erst `resolveConflict()` und ein vierarmiger
Schreib-`if`.

Der Preis ist konkret: Jede dieser Stufen ist eine eigenständige, klar benennbare
Sicherheitsregel, aber keine davon ist einzeln testbar. `test/sync/sync.service.test.ts` ist
deshalb auf **1.226 Zeilen** angewachsen — jeder Test muss ein vollständiges Event samt
Gateway aufbauen, um eine einzelne Regel zu prüfen. Wer eine neunte Regel hinzufügt, muss
außerdem selbst herausfinden, an welche Position in der Kette sie gehört; die Reihenfolge ist
sicherheitsrelevant (Kommentar bei Stufe 8: „erst NACH der clubId-Prüfung … aber VOR jedem
Lese-/Schreibzugriff") und heute nur durch die Zeilenreihenfolge kodiert.

**Fix:** Die Stufen als Liste reiner Funktionen mit einheitlicher Signatur
`(event, requester, ctx) => SyncEventResult | null` (null = „durchgereicht") ausdrücken:

```ts
const PUSH_GUARDS = [parseEvent, requireKnownStore, requireWritePermission,
                     shortCircuitIfProcessed, validatePayload, requireOwnClub,
                     requireForeignKeysWithinClub];
```

`push()` schrumpft auf ~40 Zeilen (Schleife + Konfliktentscheidung + Schreibzweig), die
Reihenfolge wird explizit und dokumentierbar, jede Regel einzeln testbar — und das
1.226-Zeilen-Testfile lässt sich entlang derselben Struktur aufteilen.

**Status: behoben, wie vorgeschlagen — mit einer Zahlenkorrektur.** `sync.service.ts` enthält
jetzt genau das vorgeschlagene `PUSH_GUARDS`-Array (`parseEvent`, `requireKnownStore`,
`requireWritePermission`, `shortCircuitIfProcessed`, `validatePayload`, `requireOwnClub`,
`requireForeignKeysWithinClub`) mit der Signatur `(ctx) => SyncEventResult | null` — `ctx` ist
ein je Event neu angelegtes, mutierbares Objekt, in das jede Stufe ihr Zwischenergebnis (das
geparste Event, den Store, den validierten Payload) einträgt, damit spätere Stufen und der
Rumpf von `push()` danach darauf zugreifen können; die sicherheitsrelevante Reihenfolge steht
jetzt als Array-Position statt als Zeilenreihenfolge in einer Schleife. `push()` selbst
schrumpfte auf 110 Zeilen — mehr als die geschätzten ~40, weil die ausführlichen
Sicherheits-Begründungskommentare (Reihenfolge-Zwang, Mass-Assignment, Ledger-Atomizität)
bewusst erhalten blieben und teils zu den neuen Guard-Funktionen wanderten, statt sie im
Zuge dieser Änderung zu kürzen (das wäre W3, nicht L1); ohne Kommentare sind es 59 Zeilen
Code. `test/sync/sync.service.test.ts` wurde NICHT wie im letzten Satz des Fix-Vorschlags
skizziert aufgeteilt — die 1.226 Zeilen bleiben eine Datei, nur die beiden Importe
(`describeSyncError`, `splitAtSafeTimestampBoundary`) zeigen jetzt auf ihre neuen Dateien
(siehe L2). Das Testfile prüft weiterhin ausschließlich über `push()`/`pull()` als Black Box
und lief nach der Umstellung unverändert grün (309 Tests) — der stärkste Beleg, dass die
Umstellung auf die Guard-Kette das beobachtbare Verhalten nicht verändert hat. Verifiziert
über `typecheck`/`lint`/die volle API-Testsuite.

### L2 — `sync.service.ts` als Modul: 737 Zeilen, fünf Zuständigkeiten (Mittel)

Rechte-Matrix (`STORE_PERMISSIONS`, `canRead`, `canWrite`) · Fremdschlüsselprüfung
(`FOREIGN_KEY_REFS`, `collectSetExerciseIds`, `assertForeignKeysWithinClub`) ·
Athlet:innen-Redaktion (`scopeChangeForAthlete`, `isOwnAttendanceRecord`) · Pagination
(`splitAtSafeTimestampBoundary`) · Push/Pull selbst · Fehlerübersetzung (`describeSyncError`).

Alle sechs sind für sich sauber gebaut — sie gehören nur nicht in eine Datei. Drei davon sind
bereits exportiert, *um sie einzeln testen zu können* (der Kommentar bei
`splitAtSafeTimestampBoundary` sagt das ausdrücklich): Das ist der Punkt, an dem eine eigene
Datei ohnehin fällig ist.

**Fix:** `sync.permissions.ts`, `sync.foreignKeys.ts`, `sync.athleteScope.ts`,
`sync.pagination.ts`, `sync.errors.ts` — `sync.service.ts` behält Push/Pull. Zusammen mit W3
(Kommentar-Diät) landet jede Datei bei 60–120 Zeilen.

*Nebenbei:* `ForeignKeyRef` ist eine Union aus drei Formen, die über `'kind' in ref &&
ref.kind === 'nested'` und danach `'store' in ref` unterschieden werden — die `nested`-Variante
trägt aber **ebenfalls** ein `store`-Feld. Die Unterscheidung hängt allein an der Reihenfolge
der beiden `if`s. Ein durchgängiger Diskriminator (`kind: 'entity' | 'user' | 'nested'` auf
allen drei Varianten) macht die Union selbsterklärend und den Compiler zum Wächter.

**Status: behoben, wie vorgeschlagen (inkl. „Nebenbei").** Alle fünf Dateien wurden exakt
unter den vorgeschlagenen Namen angelegt: `sync.permissions.ts` (115 Zeilen —
`STORE_PERMISSIONS`/`canRead`/`canWrite`/`isKnownStore`), `sync.foreignKeys.ts` (144 —
`FOREIGN_KEY_REFS`/`assertForeignKeysWithinClub`/`FOREIGN_ENTITY_ERROR`, jetzt auch von
sync.errors.ts referenziert, siehe R7), `sync.athleteScope.ts` (69 —
`scopeChangeForAthlete`), `sync.pagination.ts` (46 — `splitAtSafeTimestampBoundary`),
`sync.errors.ts` (46 — `describeSyncError`); `sync.service.ts` behält `push()`/`pull()`.
`ForeignKeyRef` trägt jetzt den vorgeschlagenen durchgängigen `kind`-Diskriminator
(`'entity' | 'user' | 'nested'`); `assertForeignKeysWithinClub()` unterscheidet über
`ref.kind === 'entity'` statt über die Reihenfolge zweier `in`-Prüfungen.

Eine Zahlenkorrektur gegenüber der Schätzung „60–120 Zeilen je Datei zusammen mit W3": die
vier reinen Auslagerungsdateien liegen mit 46–144 Zeilen in diesem Rahmen, `sync.service.ts`
selbst landet aber bei 433 Zeilen (737 vorher) — mehr als geschätzt, weil W3 (Kommentar-Diät)
hier bewusst NICHT mit angewendet wurde (das ist ein eigener, nur teilweise erledigter Befund,
siehe dortiger Status) und die neuen `PUSH_GUARDS`-Funktionen (L1) ihre eigenen, ausführlichen
Sicherheitskommentare tragen. Verifiziert über `typecheck`/`lint`/`build`/die volle
API-Testsuite (309 Tests, unverändert grün — bestätigt, dass die Aufteilung selbst keine
Verhaltensänderung ist).

### L3 — `competitions.js`: 675 Zeilen, drei Features (Mittel)

Die mit Abstand größte Frontend-Datei vereint:

- **CRUD** — `renderList`, `renderCompTable`, `renderDetail` (85 Zeilen)
- **Wettkampfmodus** — `buildLiveGroups`, `renderLiveMode`, `buildSharedStopwatch`,
  `buildAthleteCard` (98 Zeilen), `appendEntryRows` (75), `buildStopwatchPanel` (71):
  zusammen ~350 Zeilen Stoppuhr-, Lauf- und Bahn-Logik, die mit der Wettkampfverwaltung nur
  die Entität teilt
- **drei Modals** (~90 Zeilen, siehe R1)

**Fix:** `modules/competitions.js` (CRUD) und `modules/competitionLive.js` (Wettkampfmodus);
`buildStopwatchPanel`/`buildSharedStopwatch` weiter nach `modules/stopwatch.js`, da sie
nichts über Wettkämpfe wissen. Ohne eine Zeile Logikänderung.

**Status: behoben, wie vorgeschlagen — mit zwei Präzisierungen.** `modules/stopwatch.js` (neu)
trägt `buildSharedStopwatch`/`buildStopwatchPanel`; `modules/competitionLive.js` (neu) trägt
`buildLiveGroups`/`renderLiveMode`/`buildAthleteCard`; `modules/competitions.js` behält CRUD
(`renderList`/`renderCompTable`/`renderDetail`/`groupByHeat`) und die drei Formular-Modals
(siehe R1). Wortgleiche Übernahme, keine Logikänderung — bestätigt durch die weiterhin grüne
Testsuite und einen Playwright-Lauf, der u. a. in den Wettkampfmodus navigiert.

Zwei Stellen, an denen die tatsächliche Umsetzung von der (informell formulierten)
Themen-Zuordnung im Befund abweicht:
- `appendEntryRows` (Startlisten-Zeilen, von der Beschreibung oben unter „Wettkampfmodus"
  aufgezählt) blieb in `competitions.js`: es wird ausschließlich von `renderDetail()` (CRUD)
  aufgerufen, nicht vom Wettkampfmodus selbst, und leiht sich von dort nur
  `buildStopwatchPanel()`. Es nach `competitionLive.js` zu ziehen hätte `competitions.js` dazu
  gezwungen, es von dort wieder zurückzuimportieren — ohne echten Vorteil.
- `findResultForEntry` (ein Zweizeiler) wird von BEIDEN Dateien gebraucht
  (`appendEntryRows` in competitions.js, `buildAthleteCard` in competitionLive.js). Er lebt
  jetzt in `competitionLive.js`, nicht in `competitions.js` — einzig, damit der Importpfad
  einseitig bleibt (`competitions.js` → `competitionLive.js`, dieselbe Richtung wie bei
  `buildLiveGroups`/`renderLiveMode`) statt einen Zyklus zwischen beiden neuen Dateien zu
  erzeugen, der genau der Art von Kopplung entspräche, die dieses Review an anderer Stelle
  (W4: `db.js` ↔ `state.js`) ausdrücklich vermeiden wollte.

Verifiziert über Lint (workspace-weit sauber — deckt nicht aufgelöste Importe zuverlässig
auf), die volle Web-Testsuite (63 Tests) und einen ausführlichen Playwright-Lauf gegen
`demo.html` (alle 14 Modul-Routen, Wettkampf-Detailansicht, Einstieg in den Wettkampfmodus —
keine Konsolenfehler).

### L4 — `utils.js`: das Sammelmodul (Mittel)

360 Zeilen, **von 23 der 30 Frontend-Dateien importiert**, und darin mindestens zehn
zusammenhanglose Themen: ID-Erzeugung · DOM-Baukasten (`el`/`h`/`icon`/`clear`) ·
HTML-Escaping · Render-Absicherung (`beginRender`) · Datumsrechnung (8 Funktionen) ·
Schwimmzeit-Formatierung · UI-Bausteine (`badge`, `statCard`, `emptyState`, `laneWave`) ·
Toast · Modal · Formularfelder · funktionale Helfer (`debounce`, `groupBy`, `average`) ·
zwei SVG-Diagramm-Generatoren (85 Zeilen).

Das ist die eigentliche „übermäßige Abhängigkeit" des Projekts — nicht die npm-Pakete
(Abschnitt 4). Ein Modul, das nur `fmtDateLong()` braucht, zieht die Diagramm-Generatoren und
die Modal-Mechanik mit; und weil alles hier landet, ist `utils.js` auch der Ort, an dem die
zweite `uid()`-Variante entstehen konnte (W1).

**Fix:** Aufteilen in `dom.js`, `dates.js`, `swimTime.js`, `ui.js`, `modal.js`, `forms.js`,
`charts.js`. Die Aufrufstellen ändern sich nur im Importpfad — mechanisch, risikoarm, gut
mit einem Suchen-und-Ersetzen zu erledigen. Danach zeigt der Importgraph, was ein Modul
tatsächlich braucht.

**Status: behoben, wie vorgeschlagen — vollständig, nicht als Re-Export-Fassade.** Alle
sieben Dateien wurden unter den vorgeschlagenen Namen angelegt (`localId`/`el`/`h`/`icon`/
`clear`/`beginRender` → `dom.js`; die neun Datumsfunktionen → `dates.js`; `secToTime`/
`timeToSec` → `swimTime.js`; `badge`/`statCard`/`emptyState`/`laneWave`/`toast`/`fullName`/
`groupBy`/`average` → `ui.js`, da die „funktionalen Helfer" aus dem Befund für zwei Funktionen
keine eigene achte Datei rechtfertigen; `openModal`/`confirmAction` → `modal.js`; `field`/
`formActions`/`textInput`/`dateInput`/`selectInput` → `forms.js`; `svgLineChart`/
`svgBarChart` (inkl. der privaten `esc()`) → `charts.js`). `utils.js` wurde anschließend
**gelöscht**, nicht als dünne Re-Export-Fassade belassen — eine Fassade hätte den eigentlichen
Zweck des Befunds unterlaufen (jedes Modul zieht weiterhin alles mit, importiert es
weiterhin von "einer Stelle"). Stattdessen wurden alle 27 betroffenen Dateien (die
tatsächliche, nachgezählte Zahl — mehr als die im Befund geschätzten 23, u. a. weil R3/R4/R5
und L3 in denselben Sessions neue Dateien hinzufügten) einzeln auf die passenden neuen
Importpfade umgestellt, je nach tatsächlich genutzten Symbolen (nicht pauschal alle sieben
Dateien importiert).

Zwei Nebenkorrekturen, die beim Löschen von `utils.js` nötig wurden und ohne die die
Aufteilung die Offline-Fähigkeit der PWA beschädigt hätte: `sw.js`s Precache-Manifest listete
`./js/utils.js` als zu cachende Datei — ersetzt durch die sieben Nachfolgedateien, `
CACHE_VERSION` auf `lane1-v28` erhöht. Dabei fiel zusätzlich auf, dass das Manifest bereits
vor dieser Session (durch R3/R4, `js/moduleRegistry.js`/`js/shell.js`/`js/modules/
clubForm.js`) unvollständig war — bei dieser Gelegenheit mit ergänzt, ebenso wie die neuen
`js/modules/competitionLive.js`/`js/modules/stopwatch.js` aus L3. `README.md`s drei
Verweise auf `js/utils.js` sowie zwei stale gewordene Code-Kommentare (`libraryTransfer.js`,
`plans.js`) wurden ebenfalls aktualisiert.

Verifiziert über Lint (workspace-weit sauber — bei 27 geänderten Importpfaden der wichtigste
Beleg, dass kein Symbol falsch zugeordnet wurde), die volle Web-Testsuite (63 Tests) und einen
ausführlichen Playwright-Lauf: Boot ohne Konsolenfehler an allen drei Einstiegspunkten
(`index.html`, `demo.html`, `admin/index.html`), alle 14 Modul-Routen im Demo-Modus, vier
Anlegen-Modals (Vorlagen/Katalog/Wettkämpfe/Pläne — durchlaufen `forms.js`→`dom.js`/
`dates.js`/`modal.js`) mit korrekter Feldanzahl geöffnet, sowie der Einstellungsdialog
(`shell.js`→`dom.js`/`ui.js`/`modal.js`).

### L5 — `SyncGateway`: fünf Methoden nur für Tests (Niedrig)

`create()`, `update()`, `softDelete()`, `markEventProcessed()` und `isEventProcessed()` (als
eigenständige Methode) werden von **keinem** Produktivpfad mehr aufgerufen — `push()` nutzt
ausschließlich `applyAndMarkProcessed()`. Aufrufer sind nur
`test-integration/syncGateway.integration.test.ts`.

Beide Implementierungen (`PrismaSyncGateway`, `InMemorySyncGateway`) müssen sie trotzdem
tragen und konsistent halten; `sync.gateway.memory.ts` bildet dafür eigens Prismas
P2002-Verhalten nach. Das ist ein Testgerüst, das als Produktions-Interface auftritt.

**Fix:** Entweder die Primitiven aus `SyncGateway` in ein separates
`SyncGatewayTestSurface`-Interface ziehen (das nur `PrismaSyncGateway` implementiert), oder
die Integrationstests auf `applyAndMarkProcessed()` umstellen und die Primitiven entfernen.
Die zweite Variante testet zusätzlich näher an dem, was tatsächlich läuft.

**Status: behoben — mit einer wichtigen Korrektur am Befund selbst.** Ein Repo-weites Grep
nach `gateway.isEventProcessed(` zeigt: diese Methode wird SEHR WOHL von einem Produktivpfad
aufgerufen — `push()`s Idempotenz-Fast-Path (`sync.service.ts`) fragt sie direkt ab, VOR jeder
Schema-/Fremdschlüsselprüfung. Der Befund zählte sie fälschlich zu den toten Methoden; nur
`create()`, `update()`, `softDelete()` und `markEventProcessed()` sind tatsächlich ohne
Aufrufer außerhalb der eigenen `applyAndMarkProcessed()`-Implementierung.

Umgesetzt wurde die erste der beiden vorgeschlagenen Varianten (separates
`SyncGatewayTestSurface`-Interface), nicht die zweite: die Integrationstests nutzen
`gateway.create()` überwiegend NICHT, um `create()` selbst zu prüfen, sondern um
Test-Fixtures für andere Prüfungen aufzubauen (`findById()`, `update()`, `softDelete()`,
`listChangedSince()`) — sie auf `applyAndMarkProcessed()` umzustellen hätte bedeutet, jeden
dieser Testaufbauten umzuschreiben, mit entsprechendem Risiko für diese sicherheitskritische
Suite (sie ist die einzige, die das clubId-Scoping gegen eine ECHTE SQL-WHERE-Klausel statt
eines In-Memory-Doubles prüft). Die schmalere Interface-Trennung erreicht denselben
Kern-Nutzen (kein künftiges `SyncGateway` muss diese vier Methoden mehr implementieren) ohne
dieses Risiko: `SyncGatewayTestSurface` (neu, in `sync.gateway.ts`) trägt jetzt `create()`/
`update()`/`softDelete()`/`markEventProcessed()`; `SyncGateway` selbst behält nur noch
`findById`/`listChangedSince`/`isEventProcessed`/`applyAndMarkProcessed`/`findClubIdForUser`.
`PrismaSyncGateway implements SyncGateway, SyncGatewayTestSurface` (unverändertes
Methodenverhalten); `InMemorySyncGateway` implementiert `SyncGatewayTestSurface` bewusst NICHT
mehr — ihre vier gleichnamigen Methoden sind jetzt `private`, nur noch für die eigene
`applyAndMarkProcessed()`-Implementierung sichtbar. `test-integration/
syncGateway.integration.test.ts` musste dadurch nicht angepasst werden: `const gateway = new
PrismaSyncGateway(prisma)` (ohne explizite `SyncGateway`-Typannotation) behält strukturell
weiterhin Zugriff auf alle Methoden der konkreten Klasse.

Verifiziert über `typecheck`/`lint`/die volle API-Testsuite (309 Tests). Die
Integrationstests selbst liefen wie im gesamten bisherigen Verlauf dieses Reviews NICHT
(kein Postgres-Container in dieser Umgebung verfügbar) — unverändert gegenüber dem
eingangs dokumentierten Stand.

### L6 — Weitere Funktionen über 60 Zeilen (Niedrig)

Nach `push()` (218) und `createAuthService` (264, aber als Sammlung kurzer Methoden
unproblematisch): `authRoutes` (215 — löst sich weitgehend mit R2 auf), `seedDemoClubData`
(116), `buildDemoData` (111), `catalog.js:renderList` (109),
`dashboard.js:renderTrainerDashboard` (106), `profile.js:renderView` (98),
`competitions.js:buildAthleteCard` (98), `setEditor.js:buildSetRow` (87). Die
`render*`-Funktionen sind flache DOM-Aufbauten und damit vertretbar; `buildAthleteCard` und
`buildSetRow` mischen dagegen Aufbau *und* Ereignislogik und lohnen eine Trennung.

**Status: behoben für die beiden benannten Fälle, `render*`-Funktionen bewusst unangetastet
(wie im Befund selbst empfohlen).** `buildAthleteCard` (`competitionLive.js`, siehe L3):
`saveHeatResult()` trägt jetzt die Persistenz-/PB-Ermittlungslogik separat (reine
Datenoperation, kein DOM-Bezug); der „Ziel"-Klick-Handler orchestriert nur noch (aufrufen,
dann UI aktualisieren). `setEditor.js:buildSetRow` (87 Zeilen): `appendCatalogInfo()` trägt
jetzt den eigenständigen Katalog-Hinweis+Ausrüstungs-Editor (eigener `editorOpen`-Zustand,
eigene Persistenz über `put('exercises', …)`) separat; `buildSetRow` baut nur noch die fünf
Basisfelder und ruft bei Bedarf `appendCatalogInfo()` auf. Beide Extraktionen sind reine
Verschiebungen ohne Verhaltensänderung. Verifiziert über Lint, die volle Web-Testsuite und
zwei gezielte Playwright-Läufe: einmal der Wettkampfmodus-Einstieg (siehe L3/L4-Status),
einmal der Ausrüstungs-Editor selbst (Editor geöffnet, 10 Ausrüstungs-Pills gerendert, ein
Pill angeklickt, `put('exercises', …)` erfolgreich — keine Konsolenfehler in beiden Fällen).

### L7 — `auth.service.ts`: vier Zuständigkeiten (Niedrig)

Authentifizierung (`login`/`refresh`/`logout`) · Registrierung (`acceptInvitation`) ·
Eigenes Profil (`getMe`/`updateMe`) · DSGVO (`exportMyData`/`requestAccountDeletion`) ·
Nutzerverzeichnis (`listClubMembers`/`listAssignableTrainers`).

Mit 383 Zeilen und durchweg kurzen Methoden ist das heute kein Problem — es ist die Stelle,
die als nächste wächst. Die letzten beiden Gruppen (Profil/DSGVO und Verzeichnis) hängen
jeweils an eigenen Repositories (`profileGateway`, `users.listByClub`) und ließen sich
schnittfrei herauslösen, sobald die Datei die 500 Zeilen erreicht.

**Status: geprüft, keine Änderung nötig — wie im Befund selbst festgestellt.** Der Befund
empfiehlt explizit KEINE sofortige Maßnahme („heute kein Problem"), sondern nennt nur den
Schwellenwert (500 Zeilen), ab dem sich eine Auslagerung lohnt. Nachgezählt: `auth.service.ts`
liegt nach R9 (gemeinsame `listMembers()`-Hilfsfunktion, siehe Abschnitt 2) bei 396 Zeilen —
noch unter der genannten Schwelle. Keine Datei-Aufteilung vorgenommen.

---

## 4. Abhängigkeiten

**Hier gibt es nichts zu beheben.** Der Vollständigkeit halber die Prüfung:

**Produktivabhängigkeiten `apps/api` — jede einzelne ist tatsächlich importiert:**

| Paket | Verwendet in |
|---|---|
| `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` | `plugins/security.ts` |
| `fastify-plugin` | `plugins/authenticate.ts` |
| `hash-wasm` | `auth/password.ts` (argon2id) |
| `jose` | `auth/tokens.ts` (RS256) |
| `nodemailer` | `mail/mailer.ts` (dynamischer Import — wird nur geladen, wenn SMTP konfiguriert ist) |
| `zod` | `config/env.ts` + über `shared-types` |
| `@prisma/client`, `prisma` | siehe unten |

Keine Fundamentbibliothek (lodash, moment, axios, date-fns), keine überlappenden Pakete,
kein Framework-Wildwuchs. Das ist für ein Projekt dieser Größe ungewöhnlich diszipliniert.

**`prisma` (11 MB CLI) steht bewusst korrekt in `dependencies`,** nicht in
`devDependencies`: Das Laufzeit-Image führt `npx prisma migrate deploy && node dist/index.js`
aus (`apps/api/Dockerfile`, letzte Zeile) und enthält nach `npm ci --omit=dev` nur
Produktivabhängigkeiten. Ein Verschieben würde den Containerstart brechen. Falls die 11 MB
je stören: `@prisma/migrate` allein genügt für `migrate deploy`; angesichts des einmaligen
Startvorgangs lohnt der Aufwand aber nicht.

**`apps/web` hat null Laufzeitabhängigkeiten** — Vanilla-ESM, kein Build, kein Bundler,
eigener Mini-Router, eigene SVG-Diagramme, eigene i18n-Engine. Für eine Offline-First-PWA in
einem Vereinsumfeld ist das die richtige Entscheidung: keine Lieferketten-Angriffsfläche,
keine Bundler-Migration in drei Jahren. Der Preis ist W6 (kein Zugriff auf
`packages/shared-types`) und L4 (`utils.js` als Ersatz für eine fehlende UI-Bibliothek) —
beides beherrschbar.

**Interner Abhängigkeitsgraph:** `shared-config ← {api, web, shared-types, sync-protocol}`,
`shared-types ← sync-protocol ← api`. Azyklisch und in der richtigen Richtung. Der einzige
Zyklus im gesamten Repository ist `db.js ↔ state.js` (W4).

**Kleinigkeit:** Das Wurzel-`eslint.config.cjs` und die zugehörigen Wurzel-`devDependencies`
(ESLint 10, `typescript-eslint`, `globals`) werden von `npm run lint --workspaces` nie
benutzt — sie existieren ausschließlich für Editor-Integrationen. Das ist im Dateikopf
dokumentiert und in Ordnung; erwähnenswert nur, weil ein `npm run lint` an der Wurzel *nicht*
das prüft, was die CI prüft.

---

## 5. Was gut ist

Damit die Befunde nicht den Blick verstellen — diese Entscheidungen sollten erhalten bleiben:

- **Repository-/Gateway-Pattern mit In-Memory-Doubles.** Die gesamte Geschäftslogik ist ohne
  Datenbank testbar, und die Integrationstests prüfen zusätzlich die echten Prisma-Pfade, wo
  das `clubId`-Scoping tatsächlich sitzt. Das ist der Grund, warum diese Codebasis trotz
  L1/L2 überhaupt gut testbar ist.
- **Generische Sync-API statt zehn Sonderpfaden.** `ENTITY_SCHEMAS` + Entity-Registry +
  `resolveConflict()` — ein neuer Store ist im Idealfall ein Schema und ein Delegate. W2 ist
  genau deshalb ärgerlich: Der Entwurf ist richtig, nur die Verdrahtung ist an vier Stellen
  handgepflegt.
- **`STORE_PERMISSIONS` als Whitelist über `Record<EntityStoreName, …>`.** Eine neue Rolle hat
  automatisch nirgends Zugriff, ein neuer Store lässt sich ohne Rechteeintrag nicht
  kompilieren. Vorbildlich — und genau das Muster, das W2 auf die übrigen Listen übertragen
  will.
- **CI-Lauf.** Blockierendes `npm audit --omit=dev`, separater Typecheck für Testdateien,
  `migrate deploy` statt `db push` (prüft die Migrationshistorie gleich mit), getrennter
  Integrationstest-Schritt gegen echtes Postgres.
- **`apiClient.js`.** Single-Flight-Refresh, proaktive Token-Erneuerung, saubere Trennung von
  `ApiError`/`NetworkError`, eine Funktion je Endpunkt. Die beste Datei im Frontend.
- **Dockerfile.** Drei Stages mit einer eigenen `prod-deps`-Stage, `USER node`, Migration vor
  Serverstart.

---

## 6. Vorgeschlagene Reihenfolge

| # | Befund | Aufwand | Wirkung | Status |
|---|---|---|---|---|
| 1 | **W1** — `uid()`-Fehlgriff in `libraryTransfer.js` | 1 Zeile + Test | Behebt einen aktiven Datenverlust-Pfad | ✅ behoben |
| 2 | **W2** — Store-Listen aus `ENTITY_SCHEMAS` ableiten | ~10 Zeilen | Schließt eine stille Fehlerklasse | ✅ behoben |
| 3 | **W5** — Test auf i18n-Schlüsselgleichheit | ~5 Zeilen | Verhindert Sprachdrift | ✅ behoben |
| 4 | **R2** — Fehler-Registry + `setErrorHandler` | ~1 Tag | −89 Zeilen an den Routen, Status-Mapping an einer Stelle lesbar | ✅ behoben |
| 5 | **R1** — gemeinsamer Formular-Knopfblock | ~1–2 Tage | −18 Zeilen netto; Mega-Helfer verworfen, siehe dortiger Status | ✅ teilweise behoben |
| 6 | **L1** — `push()` in Guard-Kette zerlegen | ~1 Tag | Regeln einzeln testbar, Reihenfolge explizit | ✅ behoben |
| 7 | **W4** — Zyklus `db.js` ↔ `state.js` | ~2 Std. | `db.js` ohne Mock testbar | ✅ behoben |
| 8 | **L2/L3/L4** — Dateien aufteilen | ~2 Tage | Rein mechanisch, kein Verhaltensrisiko | ✅ behoben |
| 9 | **R3/R4/R5/R6/R7/R8/R9** — kleine Duplikate | je < 2 Std. | −150 Zeilen | ✅ behoben |
| 10 | **W3** — Kommentar-Diät | fortlaufend | −1.200 bis −1.500 Zeilen; senkt die Einstiegshürde am stärksten | 🟡 begonnen (4 Dateien, 239→206); durch R/L-Fixes 25 neue Befund-Marker ergänzt, siehe dortiger Nachtrag |
| 11 | **W7** — `no-bitwise` in ESLint aufnehmen | 1 Zeile | Fängt beide `&`-Stellen und alle künftigen | ✅ behoben |
| 12 | **L5** — `SyncGatewayTestSurface` abspalten | ~2 Std. | `SyncGateway`-Implementierungen müssen vier Test-Primitiven nicht mehr tragen | ✅ behoben |
| 13 | **L6** — `buildAthleteCard`/`buildSetRow` trennen | ~2 Std. | Persistenz-/Widget-Logik einzeln lesbar von der DOM-Verdrahtung | ✅ behoben |
| 14 | **L7** — `auth.service.ts` beobachten | — | Kein Handlungsbedarf vor 500 Zeilen (heute 396) | ✅ geprüft, kein Bedarf |

Positionen 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13 und 14 sind vollständig erledigt (14 als
bewusste Nicht-Maßnahme, siehe dortiger Status); W6 (kein eigener Tabelleneintrag, siehe
dortiger Abschnitt) ist als Nebeneffekt von Position 2 ebenfalls erledigt. Position 5 (R1) ist
im Kern erledigt, aber mit korrigiertem Umfang — 13 von 17 Formular-Modals konvertiert, kein
`openEntityForm()`-Mega-Helfer (siehe dortiger Status für
die Begründung). Position 10 ist als fortlaufende Aufgabe angelegt und auf den dichtesten
Dateien begonnen — bewusst nicht auf `sync.service.ts` erweitert, obwohl dessen L1/L2-Umbau
in derselben Session lief (siehe L1-Status: die dortigen Sicherheitskommentare blieben
absichtlich stehen). Position 10 (W3) ist damit der einzige noch offene Punkt dieser Tabelle;
alle anderen Positionen sind abgeschlossen.
