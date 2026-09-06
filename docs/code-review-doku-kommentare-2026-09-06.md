# Code-Review — Wartbarkeit von Dokumentation und Kommentaren (6. September 2026)

**Auftrag.** Durchgehendes Review über das gesamte Repository mit Blick
ausschließlich auf **Dokumentation und Kommentare**: Sind sie so
geschrieben, dass sie eine Änderung am Code überleben? Wo sind sie länger
als nötig? Wo widersprechen sie dem Code bereits?

**Abgrenzung zu den Vorreviews.** Die Codebasis trägt vier
Sicherheitsreviews (`security-review-2026-08*.md`), zwei Code-Reviews
(`code-review-2026-08.md`, `code-review-2026-09-02.md`), ein
Wartbarkeitsreview (`code-review-wartbarkeit-2026-08.md`) und das Review
vom 30.08.2026. Alle sieben beurteilen **Code**. Dieses Review beurteilt
**Text** — und dabei ausgerechnet den Text, den jene sieben Reviews
hinterlassen haben. Kein Befund hier ist eine Wiederholung, und kein
Befund hier ändert Programmverhalten.

**Ergebnis vorweg.** Die Kommentare dieses Projekts sind
überdurchschnittlich sorgfältig und inhaltlich fast durchgehend richtig.
Ihr Problem ist nicht Nachlässigkeit, sondern eine Form: sie sind über
sieben Reviews hinweg als **Änderungsprotokoll** gewachsen statt als
Beschreibung. Ein typischer Block beginnt mit „Sicherheitsreview
2026-08-27, Befund N5:", beschreibt dann in der Vergangenheitsform, was
der Code **früher** falsch machte, und nennt die heute gültige Regel erst
im letzten Drittel. Das ist dreifach teuer: der Verweis zeigt auf einen
Zustand, den man im Code nicht mehr findet; der Text altert bei jeder
weiteren Änderung mit; und die tragende Begründung steht unter drei
Absätzen begraben, die `git log` ohnehin besser beantwortet.

Messbar: **7.416 der 25.438 Quellzeilen (29 %) waren Kommentar**, in
`sync.permissions.ts` 66 %, in `config/env.ts` 62 %, in `state.js` 55 %.
**349 Kommentarzeilen** in 72 Dateien nannten eine Review-Fundstelle.

Zwei Befunde sind echte Abweichungen zwischen Kommentar und Wirklichkeit
(**D1**, **D2**) — einer davon deckte eine doppelt laufende Testdatei auf.
Die übrigen betreffen Länge und Form.

**Umgesetzt in diesem Durchgang** (drei Commits, siehe **Fix**-Abschnitte):
D1–D4 vollständig, D5 für die 15 am dichtesten kommentierten Dateien.
Danach **6.690 von 24.712 Zeilen (27 %)** Kommentar, **123 der 349**
Review-Verweise entfernt. **226 verbleiben** und sind unter **D5** als
benannte Restarbeit aufgeführt, samt der Begründung, warum sie nicht
maschinell zu erledigen ist.

**Prüfstand.** Nach jedem der drei Commits vollständig ausgeführt:
`apps/web` 232, `apps/api` 547, `packages/shared-types` 194,
`packages/sync-protocol` 9 — alle grün. `eslint` über alle vier Workspaces
ohne Befund. Die einzige Zahlenänderung gegenüber dem Ausgangsstand ist
`apps/api` 556 → 547; das sind exakt die neun doppelt gelaufenen Tests aus
**D2**, kein Deckungsverlust (Nachweis dort).

Schweregrade: **Mittel** = führt absehbar in die Irre; **Niedrig** =
Ballast ohne akute Irreführung.

---

## D1 — Jede Quelldatei nannte ihren eigenen Pfad (Niedrig)

**Befund.** 141 der 205 versionierten Quelldateien (`.ts`/`.js`/`.cjs`/`.sh`)
begannen mit ihrem eigenen Repo-Pfad als Kommentar:

```ts
// apps/api/src/config/env.ts
//
// Liest und validiert Umgebungsvariablen einmalig beim Start. …
```

Die Angabe steht in jedem Editor-Tab, in jeder `grep`-Ausgabe und in
jedem Diff-Header. Sie kostet nichts zu schreiben, aber sie ist die
einzige Stelle im Repository, die beim Verschieben einer Datei **still**
falsch wird — nichts prüft sie, kein Test schlägt fehl.

Zwei waren bereits abgedriftet:

- `apps/web/js/modules/dashboard.js` wies sich als `modules/dashboard.js`
  aus — abweichend von der sonst repoweit genutzten Schreibweise ab
  Repo-Wurzel. Für sich genommen harmlos, aber ein Beleg dafür, dass die
  Konvention nicht gepflegt wird.
- `apps/api/test/sync/purgeExpiredDeletions.test.ts` wies sich als
  `apps/api/test/jobs/purgeExpiredDeletions.test.ts` aus — siehe **D2**.

Dazu kam in `apps/web` ein zweiter Kopf-Stil mit zwei reinen Zierzeilen
je Datei und noch einmal demselben Dateinamen:

```js
// ============================================================
// modules/templates.js — wiederverwendbare Trainingsplan-Vorlagen
// ============================================================
```

**Fix.** Die Pfadzeile aus allen 141 Dateien entfernt, ebenso die
`// ====`-Rahmen der 53 `apps/web`-Header und der dem Beschreibungstext
vorangestellte Dateiname. Was inhaltlich etwas sagte, blieb: aus dem
Beispiel oben wird `// wiederverwendbare Trainingsplan-Vorlagen`.
`dashboard.js` hatte gar keine Beschreibung, nur den Namen — dort steht
jetzt eine (`// Startseite — je nach Rolle die Trainer:innen- oder die
Athlet:innen-Ansicht.`).

Mitte-Datei-Trenner (`// ==== Datumsangaben ====` und Ähnliches) sind
**nicht** angetastet: die sind Navigation, keine Redundanz.

Commit `65bc076`, 249 Zeilen entfernt.

---

## D2 — Eine Kopf-Kommentarzeile verriet eine doppelt laufende Testdatei (Mittel)

**Befund.** Beim Abgleich der Pfad-Kopfzeilen aus **D1** gegen die
tatsächlichen Pfade blieb genau ein echter Widerspruch übrig:

```
apps/api/test/sync/purgeExpiredDeletions.test.ts
  -> Kopfzeile: // apps/api/test/jobs/purgeExpiredDeletions.test.ts
```

Beide Dateien existierten. Die Kopfzeile war korrekt geblieben und die
**Datei** falsch: `test/sync/…` war eine Kopie von `test/jobs/…`,
liegengeblieben in einem Verzeichnis, in das sie nicht gehört.

Nachgewiesen, nicht vermutet — die Kopie ist eine echte Teilmenge:

```
$ diff <(tail -n +25 apps/api/test/sync/purgeExpiredDeletions.test.ts) \
       <(tail -n +159 apps/api/test/jobs/purgeExpiredDeletions.test.ts)
   (keine Ausgabe — Rumpf identisch)
```

Die Vorlage in `test/jobs/` enthält denselben Rumpf Zeile für Zeile, davor
zusätzlich sechs neuere Tests (Kommentar- und
Einladungs-Anonymisierung). Die neun Tests der Kopie liefen also bei jedem
`npm test` doppelt — ohne Nutzen, aber mit Laufzeit, und mit dem Risiko,
dass eine künftige Änderung nur in einer der beiden Fassungen landet.

**Fix.** `apps/api/test/sync/purgeExpiredDeletions.test.ts` entfernt.
`apps/api` geht dadurch von 556 auf 547 Tests — genau die neun
Duplikate; alle neun laufen weiterhin aus `test/jobs/`. Commit `65bc076`.

---

## D3 — Tote Verweise auf das aufgeteilte `utils.js` (Mittel)

**Befund.** `apps/web/js/utils.js` wurde im Wartbarkeitsreview (Befund L4)
in sieben Dateien aufgeteilt und gelöscht. Sieben dieser Nachfolgedateien
tragen seither einen Kommentar, der auf die gelöschte Datei verweist:

```js
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
```

Wer heute `utils.js` sucht, findet nichts. Der Kommentar erklärt nicht,
was die Datei tut, sondern woher sie kam — Information, die vollständig in
`git log` steht und dort nicht veraltet.

Zwei weitere Verweise standen an Stellen, die tatsächlich in die Irre
führen:

- `apps/web/sw.js` trug mitten in der `PRECACHE_URLS`-Liste eine
  dreizeilige Notiz darüber, dass ein früherer Eintrag dieser Liste
  aufgeteilt wurde. In einer Liste zu cachender Dateien ist das reine
  Störung.
- `docs/deployment.md:528` und `docs/deployment-netcup.md:547` begründen
  in einem **produktiv einzusetzenden Nginx-Konfigurationsschnipsel**,
  warum die CSP `style-src 'unsafe-inline'` erlaubt, und verweisen dabei
  auf `el()` in `js/utils.js`. Wer die Begründung nachprüfen will, findet
  die Datei nicht.

**Fix.** Die sieben Herkunftsnotizen und die `sw.js`-Notiz entfernt; die
inhaltlichen Beschreibungen der sieben Dateien bleiben unverändert. In
beiden Deployment-Anleitungen zeigt der Verweis jetzt auf `js/dom.js`,
wo `el()` tatsächlich liegt (`apps/web/js/dom.js:16`, geprüft).
Commits `65bc076` und `1bd5a97`.

---

## D4 — Der Kopf von `sync.permissions.ts` duplizierte die Tabelle darunter (Mittel)

**Befund.** Die Datei begann mit 59 Kommentarzeilen, darin eine
ASCII-Tabelle mit einer Zeile je Store:

```
//   Store          | trainer | admin | athlete | Begründung
//   ---------------|---------|-------|---------|------------
//   results        | R + W   | R + W | R + W*  | js/modules/times.js zeigt für ALLE Rollen …
//   plans          | R + W   | R + W | R + W   | js/modules/plans.js: ebenso, für alle Rollen …
//   …
```

Zehn Zeilen darunter steht dieselbe Aussage als Code — und **dort** ist
sie die Wahrheit:

```ts
export const STORE_PERMISSIONS: Record<EntityStoreName, StoreAccess> = {
  results: shared,
  plans: shared,
  athletes: adminManaged,
  …
};
```

Zwei Quellen derselben Wahrheit, von denen nur eine der Compiler prüft.
Ändert jemand `groups` von `coachManaged` auf `adminManaged`, wird die
Tabelle darüber falsch, ohne dass etwas fehlschlägt. Erschwerend nannte
die Begründungsspalte konkrete Funktionsnamen aus der Oberfläche
(`openAthleteModal()`, `renderAthleteList`), die niemand mitpflegt.

Dasselbe Muster, kleiner, in den drei Zugriffsprofilen darunter: der
Kommentar zählte auf, welche Stores `shared`/`coachManaged`/`adminManaged`
sind — was die Tabelle daneben zeigt.

**Fix.** Die Tabelle entfernt. Erhalten und ins Präsens gesetzt bleibt
alles, was der Code **nicht** sagt und was jemand sonst wegoptimieren
würde:

- warum es eine Whitelist ist (eine neue Rolle hat automatisch nirgends
  Zugriff, ein Versehen fällt als „zu wenig Rechte" auf, nicht als Lücke),
- dass `Record<EntityStoreName, StoreAccess>` die Vollständigkeit zur
  Compile-Zeit erzwingt,
- dass `superadmin` bewusst überall fehlt,
- warum `athletes` enger ist als die übrigen Stores (die Oberfläche
  verbirgt die Athleten-Stammdaten auch vor `trainer`; ein gemeinsames
  Profil ließe das per direktem Push umgehen) — die einzige Zeile der
  alten Tabelle, die wirklich etwas erklärte,
- dass diese Datei nur die Store-Ebene regelt und die Verengung auf
  eigene Zeilen/Felder in `sync.athleteScope.ts` bzw. `push()` sitzt.

171 → 105 Zeilen, Code unverändert. Commit `1bd5a97`.

---

## D5 — Kommentare erzählen die Entstehungsgeschichte statt der Regel (Mittel)

**Befund.** Das durchgängige Muster, und der Grund für die 29 %
Kommentaranteil. Drei Beispiele aus dem Ausgangsstand:

**`apps/web/js/state.js`** — 35 Kommentarzeilen für eine einzige
Konstante, davon 20 unter der Überschrift „Vorgeschichte:" über zwei
Ausprägungen eines Fehlers, den es nicht mehr gibt:

```js
// Sicherheitsreview 2026-08-29, Befund H1: Schlüssel im 'meta'-Store, …
//
// Vorgeschichte: logout() unten räumt die lokale Ablage per wipeAll() auf
// — genau dafür wurde es eingeführt. Es gibt aber mehrere Wege, … 
//   [20 Zeilen]
//
// Fix: die lokale Ablage ist ab jetzt an GENAU EINE Identität gebunden.
const LOCAL_STORE_OWNER_META_KEY = 'localStoreOwner';
```

**`apps/api/src/config/env.ts`** — 27 Zeilen zu `TRUSTED_PROXY_IPS`, die
zwei aufeinanderfolgende frühere Fassungen und deren jeweiliges Versagen
nacherzählen („Der damalige Fix (trustProxy: true) behob das, vertraute
dabei aber JEDER Adresse …"). Die heute gültige Regel — nenne die Hops
namentlich, sonst ist `request.ip` client-bestimmt — steht in drei davon.

**`apps/api/src/modules/auth/auth.service.ts`** — 28 Verweise auf sechs
verschiedene Reviews, teils verschachtelt („Sicherheitsreview 2026-08-27,
Befund N3 (behoben zusammen mit H2) — analog zum bestehenden P2002-Fang in
acceptInvitation()").

Das Problem ist nicht die Ausführlichkeit. Die Begründungen sind
sachlich richtig und an sicherheitsrelevanten Stellen zu Recht lang. Das
Problem ist, dass die Vergangenheitsform mitaltert: „vormals holte JEDE
der zehn Store-Abfragen …" ist beim nächsten Umbau falsch, „diese Abfrage
holt bewusst nur id/updatedAt" bleibt richtig oder wird mit dem Code
gelöscht.

**Fix (15 Dateien).** Jede Regel im Präsens begründet: was gilt und was
ohne sie passiert. Kein sachlicher Inhalt entfernt — insbesondere stehen
alle sicherheitsrelevanten Begründungen weiter an ihrer Stelle
(Timing-Angleich in `login()`, Reuse-Detection beim Refresh,
Single-Flight in `apiClient.js`, Store- gegen Zeilenebene beim Sync,
Bindung der lokalen IndexedDB an genau eine Identität). Wo eine
verworfene Alternative die Regel absichert, steht sie weiterhin da — nur
als Alternative, nicht als Chronik: in `erasure.repository.ts` etwa
warnt der Kommentar unverändert davor, das JSONB-`UPDATE` durch eine
Lade-Filter-Schreib-Schleife zu ersetzen (Prisma-Timeout, DSGVO-Frist),
beginnt jetzt aber mit der geltenden Lösung.

Wörtlich erhalten sind zwei Blöcke, die als Ganzes tragen: die drei
Umgehungswege, die begründen, warum `sync.commentAuthorship.ts` eine
verbrauchende Vielfachmenge statt eines `id`-Nachschlags prüft, und der
Abschnitt „GRENZE DER ZUSICHERUNG" ebendort.

| Datei | vorher | nachher |
|---|---:|---:|
| `auth.service.ts` | 816 | 733 |
| `sync.service.ts` | 645 | 583 |
| `apiClient.js` | 485 | 443 |
| `state.js` | 419 | 380 |
| `config/env.ts` | 201 | 141 |
| `sync.commentAuthorship.ts` | 178 | 162 |
| `sync.permissions.ts` (D4) | 171 | 105 |

Dazu `sync.gateway.ts`, `erasure.repository.ts`,
`commentAnonymization.ts`, `sw.js`, `dom.js`, `ui.js`, `charts.js`,
`forms.js`, `dates.js`, `modal.js`, `swimTime.js`.
Commits `1bd5a97` und `348a21b`.

### Restarbeit: 226 Verweise in 56 Dateien

Nicht erledigt und bewusst nicht erzwungen. Die größten Posten:

| Datei | Verweise |
|---|---:|
| `scripts/setup-codespace.sh` | 23 |
| `scripts/setup-netcup.sh` | 21 |
| `packages/shared-types/src/auth.ts` | 15 |
| `apps/api/src/modules/auth/auth.route.ts` | 12 |
| `apps/api/src/mail/mailer.ts` | 12 |
| `apps/web/js/state.js` (Rest) | 10 |
| `apps/web/js/apiClient.js` (Rest) | 9 |
| `apps/api/src/app.ts` | 7 |
| `apps/web/js/db.js` | 7 |

**Warum nicht maschinell.** Ein Durchgang mit einem regulären Ausdruck
über die Klammer-Einschübe (`(Sicherheitsreview 2026-08, Befund M5)`) war
Teil dieses Reviews und wurde **verworfen**, nachdem das Ergebnis
gegengelesen war: er hinterlässt zerrissenen Zeilenumbruch und
sinnentleerte Satzanfänge —

```
-    // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund H2): ohne
+    // Sicherheitskorrektur: ohne
-// "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) — bewusst
+// "Passwort vergessen" — bewusst
```

— also schlechteren Text als vorher, dafür in 60 Dateien auf einmal. Die
verbleibenden Verweise stecken jeweils in einem Satz, der mitgeschrieben
werden muss; das ist Handarbeit und gehört sinnvollerweise in den
Commit, der die betroffene Stelle ohnehin anfasst.

**Empfehlung für neue Kommentare.** Zwei Fragen genügen:

1. Steht es schon im Code darunter? Dann weglassen (**D4**).
2. Beschreibt es, was war, statt was gilt? Dann umschreiben — oder
   `git blame` überlassen (**D5**).

Ein Verweis auf ein Review-Dokument ist dort am Platz, wo die Begründung
tatsächlich zu lang für den Code ist (etwa
`docs/kampfrichter-modul-plan.md, Abschnitt 1.4` in
`sync.permissions.ts`). Als bloße Herkunftsangabe einer Zeile ist er
Ballast: `git log -S` findet den Commit, und der Commit nennt das Review.

---

## Was nicht zu beanstanden war

Der Vollständigkeit halber, damit ein späteres Review es nicht erneut
prüft:

- **Die Deployment-Anleitungen** (`docs/deployment*.md`, 3.732 Zeilen über
  fünf Zielumgebungen) sind durchweg schrittweise, mit prüfbaren
  Kommandos und erwarteten Ausgaben. Einziger Befund darin war der tote
  `utils.js`-Verweis (**D3**).
- **`apps/web/README.md`** beschreibt Architektur und
  Erweiterungspunkte (neues Modul, neue Sprache) korrekt und aktuell. Die
  Verweise auf `help/en/index.html` und `js/i18n/fr-FR.js` sind
  ausdrücklich als Beispiele für künftige Erweiterungen formuliert, nicht
  als bestehende Dateien — kein toter Verweis.
- **Die sieben Vorreview-Dokumente** sind Zeitdokumente und sollen
  ausdrücklich nicht mitgepflegt werden. Ihre Verweise auf `utils.js`
  und andere entfernte Dateien bleiben unangetastet: sie beschreiben
  korrekt den Stand ihres Datums.
- **Die Kopfzeilen der beiden Setup-Skripte** (50 bzw. 30 Zeilen) sind
  Bedienungsanleitung für die ausführende Person — Nutzung,
  Umgebungsvariablen, Wiederholbarkeit. Länge hier ist angemessen; nur
  die Review-Verweise im Rumpf gehören in die Restarbeit oben.
- **`packages/shared-types`** kommentiert dicht (bis 61 %), aber
  überwiegend am richtigen Ort: die Schemas sind die Schnittstelle
  zwischen Frontend und Backend, und die Kommentare erklären dort
  Feldsemantik, nicht Historie. Ausnahme ist `auth.ts` (15 Verweise,
  siehe Restarbeit).
