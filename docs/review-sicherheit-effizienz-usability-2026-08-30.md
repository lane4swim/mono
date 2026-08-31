# Review — Sicherheit, Effizienz, Usability (30. August 2026)

**Auftrag.** Empfehlung von Verbesserungsbereichen in den drei Dimensionen
**Sicherheit**, **Effizienz** und **Usability**. Umfang: das gesamte
Repository (`apps/api`, `apps/web`, `packages/*`, CI/Deployment).

**Abgrenzung zu den Vorreviews.** Die Codebasis trägt bereits vier
Sicherheitsreviews (`security-review-2026-08*.md`), ein Code-Review
(`code-review-2026-08.md`), ein Wartbarkeitsreview
(`code-review-wartbarkeit-2026-08.md`) und einen Performance-Durchgang
(Commit `332ee7a`). Alle dort behobenen Befunde wurden stichprobenartig am
aktuellen Code gegengelesen und sind nicht regressiert. **Keiner der hier
aufgeführten Befunde ist eine Wiederholung.** Sie liegen bewusst in den
Bereichen, die bisher am wenigsten systematisch betrachtet wurden:

* **Einwilligungslogik** (S1) — bisher nur als Schema-Zwang geprüft, nie als
  Ablauf,
* **Schlüsselwahl der Rate-Limits** (S2/U4) — bisher nur der `keyGenerator`
  des Logins,
* **Barrierefreiheit** (U1–U3) — in keinem der sieben Vorreviews Gegenstand.
  Das Wartbarkeitsreview nennt eine „Fokus-Falle" einmal (Zeile 494), aber
  als *Wunsch* für einen künftigen gemeinsamen Modal-Helfer, nicht als
  vorhandenes Verhalten.

**Ergebnis vorweg.** Kein Befund erlaubt eine Kontoübernahme, eine
Rechteausweitung über die API oder einen Mandantendurchbruch. Die harten
serverseitigen Kontrollen halten. Der schwerwiegendste Befund ist **kein
Sicherheitsbefund**, sondern **U1**: Über `openModal()` laufen sämtliche
Anlege-, Bearbeiten- und Löschdialoge der Anwendung, und dieser eine
Einstiegspunkt ist für Tastatur- und Screenreader-Nutzung unbrauchbar.
Der zweitwichtigste (**S1**) entwertet den DSGVO-Einwilligungsnachweis
genau in dem Moment, für den er gedacht ist.

**Prüfstand.** `npm ci` sauber; `apps/web` 106 Tests grün,
`packages/shared-types` 146 Tests grün. Die Prisma-Integrationssuite wurde
nicht ausgeführt — in dieser Umgebung steht kein Postgres-Container zur
Verfügung. Alle Befunde sind statisch am Code belegt, mit Datei und Zeile.

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

**Update (30. August 2026, im Anschluss an dieses Review).** Die beiden
Hoch-Befunde (**S1**, **U1**) sowie die beiden verbleibenden
Barrierefreiheits-Befunde (**U2**, **U3**) sind behoben — siehe die
jeweiligen **Fix**-Abschnitte. Jeder der vier Fixes trägt eigene, neu
geschriebene Regressionstests (23 insgesamt: 9 für U1, 6 für U2, 3 für
U3, 5 für S1), die allesamt ohne die jeweilige Korrektur nachweislich
fehlschlagen (für U1–U3 per `git stash` der drei geänderten
Produktivdateien empirisch geprüft; für S1 folgt es unmittelbar aus der
neuen Schema-Pflichtprüfung). Daneben wurden 35 bereits bestehende
Login-Testaufrufe lediglich um das neue Pflichtfeld ergänzt, um unter der
verschärften Validierung weiter zu bestehen — das sind Anpassungen an
API-Vertragsänderungen, keine neuen Regressionstests. U1 wurde
zusätzlich in einem echten, headless-gesteuerten Browser gegen `demo.html`
verifiziert (Playwright gegen die in dieser Umgebung vorinstallierte
Chromium-Version): Fokusplatzierung, Fokusfalle über acht Tab-Drücke,
`inert`-Hintergrund, Escape-Verhalten und die Label-Verknüpfung wurden am
tatsächlich gerenderten Dialog beobachtet, nicht nur in `jsdom`. Gesamtsuite
danach: **738 Tests, alle grün** (`apps/api` 457, `apps/web` 124,
`packages/shared-types` 148, `packages/sync-protocol` 9 — Letztere
unverändert gegenüber dem ursprünglichen Review, das ihre Zahl nicht
gesondert auswies), `npm run lint`, `npm run typecheck` (API) und
`npm run build` (alle Workspaces) sauber. Wie bei den Vorreviews stand
auch hier kein Postgres-Container zur Verfügung — die 457 API-Tests sind
die Vitest-Suite gegen die `*.repository.memory.ts`-Doubles
(`npm run test`), nicht die Prisma-Integrationssuite. S2–S5, E1–E4 und U4–U5
sind unverändert offen.

**Update (30. August 2026, zweiter Durchgang).** **S2** und **U4** sind
ebenfalls behoben — siehe die jeweiligen **Fix**-Abschnitte. Bei **S2**
stellten sich beide ursprünglich vorgeschlagenen Rate-Limit-Schlüssel
(`request.user!.sub`; ein Hash des vorgelegten Refresh-Tokens) beim
tatsächlichen Implementieren als technisch nicht tragfähig heraus — der
Fix-Abschnitt dokumentiert beide Korrekturen samt Begründung ausführlich,
da sie den zuvor vorgeschlagenen Lösungsweg grundlegend ändern. Für **S2**
ein neuer Regressionstest (zwei Konten hinter derselben IP teilen sich das
`/api/me/password`-Budget nicht mehr) plus drei bestehende
`/auth/refresh`-Tests auf den angehobenen Grenzwert nachgezogen; für
**U4** sechs neue Tests in `apps/web`. Alle vier neuen/geänderten
`apps/api`-Tests und alle sechs neuen `apps/web`-Tests scheitern
nachweislich ohne die jeweilige Korrektur (per `git stash` der geänderten
Produktivdateien empirisch geprüft). S3–S5, E1–E4 und U5 bleiben
unverändert offen. Gesamtsuite danach: **745 Tests, alle grün** (`apps/api`
458, `apps/web` 130, `packages/shared-types` 148, `packages/sync-protocol`
9), `npm run lint`, `npm run typecheck` (API) und `npm run build` (alle
Workspaces) weiterhin sauber.

**Update (31. August 2026, dritter Durchgang).** **S3**, **S4** und **U5**
sind behoben — siehe die jeweiligen **Fix**-Abschnitte. **S5** ist
stattdessen bewusst als **akzeptiertes Risiko** geschlossen worden, ohne
Codeänderung — siehe dessen neuen „Entscheidung"-Abschnitt: die
vorgeschlagene `tokensValidFrom`-Prüfung hätte eine bereits bestehende,
in `plugins/authenticate.ts` ausführlich dokumentierte Abwägung
rückgängig gemacht (kein DB-Lookup auf den beiden höchstfrequentierten
Endpunkten der Anwendung), und die HÄLFTE des im Befund geschilderten
Schadensbilds (Rollenwechsel eines bestehenden Kontos) ist im heutigen
Funktionsumfang ohnehin unerreichbar — es gibt schlicht keine Möglichkeit,
die Rolle eines bestehenden Kontos zu ändern. Bei **S4** ging der Fix über
die im Befund als Kern benannte Stelle hinaus: sowohl `changeEmail()` ALS
AUCH `changePassword()` benachrichtigen jetzt die betroffene Adresse — der
im Befund beschriebene Kontoübernahme-Pfad gelingt über einen reinen
Passwortwechsel genauso gut wie über einen E-Mail-Wechsel, eine
Benachrichtigung nur bei Letzterem hätte den naheliegenderen Weg lautlos
gelassen. 16 neue Regressionstests (1 für S3, 9 für S4, 6 für U5), die
allesamt ohne die jeweilige Korrektur nachweislich fehlschlagen (für S3
per `vi.spyOn()` auf ein nie auflösendes Promise — der Testlauf hängt statt
fehlzuschlagen, geprüft per `git stash` + `timeout`; für S4 und U5 jeweils
per `git stash`/Entfernen der neuen Datei). U5 zusätzlich in einem echten,
headless-gesteuerten Browser verifiziert (Registrierung/Aktivierung beim
ersten Laden, kein Fehlalarm bei unverändertem Worker). Gesamtsuite danach:
**761 Tests, alle grün** (`apps/api` 468, `apps/web` 136,
`packages/shared-types` 148, `packages/sync-protocol` 9), `npm run lint`,
`npm run typecheck` (API) und `npm run build` (alle Workspaces) weiterhin
sauber. Von den ursprünglich vierzehn Befunden dieses Reviews sind damit
zehn abgeschlossen (neun behoben, S5 als akzeptiertes Risiko); nur
**E1–E4** (Effizienz) bleiben offen.

**Update (31. August 2026, vierter Durchgang).** **E1**, **E2**, **E3** und
**E4** sind ebenfalls behoben — siehe die jeweiligen **Fix**-Abschnitte.
Damit sind **alle vierzehn** Befunde dieses Reviews abgeschlossen (dreizehn
behoben, S5 als akzeptiertes Risiko). Bei **E1** hält ein pro
`syncRoutes()`-Aufruf (nicht modulweit) angelegter, 45 Sekunden gültiger
In-Memory-Cache den Vereins-Modul-Lookup vor — bewusst als Closure statt
als Singleton, damit jeder `buildTestApp()`-Aufruf automatisch seinen
eigenen, leeren Cache bekommt. Bei **E2** lädt `push()` jetzt den
Verarbeitet-Status und die "existing"-Datensätze für den gesamten Batch in
zwei bzw. (je betroffenem Store) wenigen Abfragen vorab, statt sie 200-mal
einzeln nachzuschlagen; ein `touchedInThisPush`-Wächter erzwingt einen
einzelnen Live-Nachschlag für den (in der Praxis seltenen) Fall, dass
dieselbe `entityId` zweimal im selben Batch vorkommt (z. B. Anlegen, dann
sofort Ändern desselben Offline-Datensatzes) — ohne ihn würde das zweite
Event den vorab geladenen, innerhalb des Batches bereits veralteten Stand
sehen und die falsche Konfliktentscheidung treffen. Bei **E3** grenzt
`pull()` die an `listChangedSince()` übergebenen Stores jetzt vorab auf die
für Rolle und gebuchte Module lesbaren ein; der bisherige, nach der
Paginierung laufende `canRead()`-Filter bleibt bewusst unverändert als
zusätzliche, von der Abfrage unabhängige Absicherung bestehen — die
Rechteprüfung wird dadurch nicht verlagert, sondern nur zusätzlich
vorgezogen. **E4** war bereits mit dem S1-Fix (30.08.2026) miterledigt und
wird hier lediglich verifiziert und als abgeschlossen dokumentiert — siehe
dessen Fix-Abschnitt. **8 neue Regressionstests** (`apps/api/test/sync/`:
2 für E1, 3 für E2, 3 für E3). Zwei davon scheitern nachweislich gegen den
Stand vor dem jeweiligen Fix: der E1-Cache-Test (fünf Anfragen lösen fünf
statt einen Club-Lookup aus) und der E2-Abfrage-Zähler. Die übrigen sechs
bestehen erwartungsgemäß auch gegen den alten Code und sind das auch
absichtlich: E2s und E1s Korrektheits-Wächter sichern die neuen
Optimierungen selbst ab (dass der Cache verfällt; dass eine doppelte
`entityId`/`event.id` im selben Batch nicht auf veraltete Vorab-Daten
trifft), und E3s drei Tests decken eine Stelle ab, die durch den Fix
**neu tragend** geworden ist — siehe dort.

**Nachtrag aus dem Selbst-Review dieses Durchgangs.** Der erste Anlauf
dieses vierten Durchgangs lieferte E1 und E3 ohne eigene Tests aus und
begründete das in diesem Dokument mit zwei Behauptungen, die beide einer
Prüfung nicht standhielten: E1 sei „mit dem vorhandenen Stub nicht
sinnvoll zählbar" (falsch — ein `vi.fn()` genügt), und E3 sei durch
bestehende Tests abgedeckt, die `pull()` „bereits mit unterschiedlichen
`enabledModules`" aufriefen (falsch — **jeder** `pull()`-Test der Suite
benutzte `MODULE_KEYS`). Letzteres war die ernstere der beiden Lücken:
E3 macht die `readableStores`-Berechnung erstmals dafür verantwortlich,
welche Stores überhaupt abgefragt werden, und ein künstlich daraus
entferntes `entries` oder `competitions` ließ die gesamte Suite grün —
ein ganzer Store wäre stillschweigend nie mehr synchronisiert worden. Die
acht Tests oben sind das Ergebnis; die betroffenen Fix-Abschnitte sind
korrigiert. Gesamtsuite danach: **769 Tests, alle grün** (`apps/api` 476,
`apps/web` 136, `packages/shared-types` 148, `packages/sync-protocol` 9),
`npm run lint`, `npm run typecheck` (API) und `npm run build` (alle
Workspaces) weiterhin sauber.

**Verifikationsdurchgang (31. August 2026).** Alle Fixes zu **S1–S4** und
**U1–U5** wurden unabhängig am Code nachgeprüft, nicht anhand dieses
Dokuments: jede behauptete Änderung wurde an ihrer Stelle im Quelltext
bestätigt, und für jeden Befund wurde empirisch geprüft, dass die
zugehörigen Tests ohne die jeweilige Korrektur tatsächlich fehlschlagen
(die betroffene Produktivdatei jeweils per `git checkout 27265b8 --`
auf den Stand vor dem Review zurückgesetzt): S1/S3/S4 4 Fehlschläge,
S2 2, U1 7, U2 3, U3 3, U4 3 (2 + 1 über zwei Dateien). Die Hausregel ist
für diese neun Befunde damit belegt — anders als zunächst für E1/E3, siehe
den Nachtrag im vierten Durchgang. Zwei Lücken kamen dabei ans Licht,
beide inzwischen geschlossen:

1. **S1** — die beiden von Hand gepflegten `CURRENT_CONSENT_VERSION`-
   Konstanten wurden von keinem Test verglichen, obwohl Empfehlung 4 genau
   das als Rückfallebene verlangt hatte. Seit dem S1-Fix wäre eine
   Divergenz kein still falscher Nachweis mehr, sondern ein vollständiger
   **Anmelde-Ausfall**. Test nachgereicht.
2. **U5** — der neue CI-Schritt verlangte eine `CACHE_VERSION`-Anhebung
   auch für Änderungen, die gar nicht ausgeliefert werden (Testdateien,
   Konfiguration), und hätte damit regelmäßig den Cache aller Clients ohne
   Anlass verworfen. Pathspec eingegrenzt.

Beide Nachträge stehen bei den jeweiligen Fix-Abschnitten. Gesamtsuite
danach: **770 Tests, alle grün** (`apps/api` 476, `apps/web` 137,
`packages/shared-types` 148, `packages/sync-protocol` 9).

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| **S1** | Jeder Login stempelt die Einwilligung blind auf die *aktuelle* Version — eine geänderte Datenschutzerklärung gilt damit als angenommen, ohne dass sie jemand gesehen hat. Die Versionskonstante wird zusätzlich an zwei Orten gepflegt | `auth.service.ts:311-319`; `shared-types/src/auth.ts:18` + `web/js/state.js:26` | **Hoch — behoben** |
| **S2** | Rate-Limits außerhalb von Login/Passwort-vergessen zählen **nur nach IP** — ein Verein hinter NAT sperrt sich selbst aus; genau der Fall, den `plugins/security.ts` für den Login ausdrücklich vermeiden wollte | `auth.route.ts:29,81,99,158,231,264` | Mittel — behoben |
| **S3** | `/auth/forgot-password` verrät per Laufzeit, ob eine Adresse existiert — der Timing-Ausgleich des Logins wurde hier nicht mitgezogen | `auth.service.ts:407` | Niedrig — behoben |
| **S4** | E-Mail-Wechsel benachrichtigt die **bisherige** Adresse nicht (Ergänzung zu B1 des Vorreviews, das die *neue* Adresse betrachtete) | `auth.service.ts: changeEmail()` | Niedrig — behoben |
| **S5** | Rollen-/Kontoentzug wirkt bis zu 15 Minuten verzögert: `role`/`clubId`/`athleteId` stammen aus den Token-Claims, nur `enabledModules` wird frisch gelesen | `plugins/authenticate.ts`, `sync.route.ts:46-58` | Niedrig — akzeptiertes Risiko |
| **E1** | `requesterFrom()` liest den Verein bei **jeder** Sync-Anfrage — bei einem Erstabgleich bis zu 1.000-mal dieselbe Zeile | `sync.route.ts:51` | Mittel — behoben |
| **E2** | `push()` verarbeitet 200 Events streng seriell mit je 3 Rundreisen — ~600 nacheinander laufende Abfragen pro Anfrage | `sync.service.ts: push()` | Mittel — behoben |
| **E3** | `pull()` filtert Leserechte **nach** der Paginierung — Athlet:innen bezahlen den Datenbestand des ganzen Vereins für ihren Bruchteil davon | `sync.service.ts: pull()` | Niedrig–Mittel — behoben |
| **U1** | **Kein Dialog der Anwendung ist bedienbar ohne Maus:** kein `role="dialog"`, kein Fokuswechsel, keine Fokusfalle, keine Fokusrückgabe, Hintergrund nicht inert | `web/js/modal.js:10` | **Hoch — behoben** |
| **U2** | `<label>` und Eingabefeld sind Geschwister ohne `for`/`id` — jedes Formularfeld der Anwendung ist für Screenreader unbeschriftet, Labelklick fokussiert nicht | `web/js/forms.js:11` | Mittel — behoben |
| **U3** | `<html lang>` bleibt fest `"de"`, auch auf Englisch | `web/index.html:2`, `demo.html:2`, `admin/index.html:2`; `web/js/i18n.js:38` | Mittel — behoben |
| **U4** | Ein 429 auf `/auth/refresh` endet als **stiller Logout** — ununterscheidbar von „Sitzung abgelaufen" | `web/js/apiClient.js:160-167`, `web/js/state.js:52-56` | Mittel — behoben |
| **U5** | Service Worker: `skipWaiting()`/`clients.claim()` erreichen ihren Zweck nicht (die laufende Sitzung behält ihren Code), und es gibt keinen Hinweis „neue Version verfügbar" — eine über Stunden offene PWA bleibt beliebig lange veraltet | `web/sw.js:89,96-97` | Niedrig — behoben |

---

## Sicherheit

### S1 — Die Einwilligung wird bei jedem Login neu gestempelt (Hoch)

**Ort.** `apps/api/src/modules/auth/auth.service.ts:311-319`;
Konstante doppelt in `packages/shared-types/src/auth.ts:18` und
`apps/web/js/state.js:26`.

**Befund.** `login()` schreibt nach erfolgreicher Passwortprüfung
bedingungslos:

```ts
// input.consent ist bereits durch LoginRequestSchema (consent:
// z.literal(true)) erzwungen — jeder Login aktualisiert den
// Nachweis-Zeitstempel/die -Version erneut (z. B. nach einer
// geänderten Datenschutzerklärung).
const updated = await deps.users.update(user.id, {
  consentGivenAt: new Date(),
  consentVersion: CURRENT_CONSENT_VERSION,
});
```

Der Kommentar benennt den beabsichtigten Zweck — „z. B. nach einer
geänderten Datenschutzerklärung" — und beschreibt damit genau den Fall,
in dem die Umsetzung das Gegenteil dessen bewirkt, was der Nachweis leisten
soll.

Der Ablauf im Detail:

1. Der Server vergleicht die **gespeicherte** `consentVersion` der
   Nutzer:in **nie** mit `CURRENT_CONSENT_VERSION`. Es gibt keinen Pfad,
   der bei einer Abweichung eine erneute, bewusste Zustimmung verlangt.
2. Der Client schickt lediglich `consent: true` — ein Boolean. **Welcher
   Version** zugestimmt wurde, steht nicht in der Anfrage. Der Server
   stempelt seine eigene Konstante.
3. Wird `CURRENT_CONSENT_VERSION` auf eine neue Datenschutzerklärung
   angehoben, so wird bei der nächsten Routine-Anmeldung — Häkchen setzen,
   Passwort eingeben, wie jeden Dienstagabend — jede Alt-Einwilligung
   stillschweigend in eine Einwilligung zur **neuen** Fassung umgeschrieben.
   Niemand hat die neue Fassung gesehen; der Server kann nicht einmal
   unterscheiden, ob sie angezeigt wurde.

Der Datensatz behauptet danach „hat am 30.08.2026 der Fassung 2026-07-15
zugestimmt", und dieser Satz ist als Nachweis wertlos — er entsteht
maschinell aus einer Serverkonstante, nicht aus einer Handlung der
betroffenen Person. Das ist genau die Eigenschaft, die Art. 7 Abs. 1 DSGVO
von einem Einwilligungsnachweis verlangt und die diese Implementierung
nicht liefert.

**Verschärfend: die Konstante existiert zweimal.**

```
packages/shared-types/src/auth.ts:18:export const CURRENT_CONSENT_VERSION = '2026-07-15';
apps/web/js/state.js:26:       export const CURRENT_CONSENT_VERSION = '2026-07-15';
```

Das Login-Formular beschriftet sein Häkchen mit der **Frontend**-Konstante
(`authScreens.js:51`, `t('auth.consentLabel', { version: CURRENT_CONSENT_VERSION })`),
der Server stempelt die **Backend**-Konstante. Beide Werte stimmen heute
überein; nichts erzwingt das. Wer beim Aktualisieren der
Datenschutzerklärung nur eine der beiden Stellen anfasst, erzeugt genau den
Zustand, in dem die Nutzer:in „Fassung A" bestätigt und der Server
„Fassung B" protokolliert — ohne Test, der das bemerkt. Es ist derselbe
Befundtyp wie W2 des Wartbarkeitsreviews („eine fachliche Wahrheit an
sechs Stellen"), an einer dort nicht erfassten Stelle und mit
rechtlicher Konsequenz.

**Empfehlung.**

1. `LoginRequestSchema` um ein Pflichtfeld `consentVersion: z.string()`
   erweitern; `login()` lehnt ab, wenn es nicht `CURRENT_CONSENT_VERSION`
   entspricht. Damit bestätigt der Client nachweislich *die Fassung, die er
   angezeigt hat*.
2. Nur stempeln, wenn sich etwas ändert: bei
   `user.consentVersion === CURRENT_CONSENT_VERSION` das `UPDATE`
   auslassen (spart nebenbei einen Schreibvorgang je Login, siehe E4-Notiz
   unter „Effizienz").
3. Bei Abweichung einen eigenen, für den Client unterscheidbaren Zustand
   zurückgeben („erneute Einwilligung erforderlich"), den das Frontend als
   Anzeige der **neuen** Erklärung mit erneutem Häkchen rendert — statt
   die Zustimmung aus einem Routine-Login abzuleiten.
4. Die Konstante einmalig führen: `apps/web` bezieht sie aus einer
   generierten Datei oder über einen Build-Schritt aus
   `packages/shared-types`, statt sie zu wiederholen. Solange das nicht
   geschieht, mindestens ein Test, der beide Werte vergleicht.

**Fix (30.08.2026).** Umgesetzt wie Empfehlung 1 und 2; Empfehlung 3 (eine
eigene, vom Frontend als "neue Erklärung anzeigen" behandelte
Re-Consent-Antwort) bewusst zurückgestellt — das wäre eine neue
UI-Fläche (Bildschirm, Fehlerklasse, i18n-Text) für einen Fall, der mit
der heutigen einzigen Version noch nie eintritt; Empfehlung 4 durch die
im Folgenden beschriebene Testabsicherung ersetzt (siehe deren Begründung
unten), da eine echte einmalige Quelle den bewusst build-losen
`apps/web` widerspricht (siehe dessen `package.json`-Beschreibung).

* `packages/shared-types/src/auth.ts`: `LoginRequestSchema` verlangt jetzt
  `consentVersion: z.literal(CURRENT_CONSENT_VERSION)` — dieselbe Technik
  wie beim bestehenden `consent: z.literal(true)`. Der Client bestätigt
  damit nachweislich *die Fassung, die der Server für aktuell hält*; eine
  veraltete oder erfundene Version scheitert bereits an der
  Eingabevalidierung, bevor `login()` sie überhaupt zu Gesicht bekommt.
* `apps/api/src/modules/auth/auth.service.ts: login()`: schreibt
  `consentGivenAt`/`consentVersion` nur noch, wenn
  `user.consentVersion !== CURRENT_CONSENT_VERSION` — der zuvor
  bedingungslose `UPDATE` bei jedem Login entfällt für den Normalfall
  (deckt nebenbei die E4-Notiz unter „Effizienz" ab).
* `apps/web/js/apiClient.js`/`state.js`: `login()` sendet jetzt
  `consentVersion: CURRENT_CONSENT_VERSION` (der Frontend-eigenen
  Konstante) mit — derselbe Wert, den `authScreens.js` im
  Einwilligungstext bereits anzeigt.
* **Statt** der einmaligen Quelle aus Empfehlung 4 (siehe deren
  Begründung — ein echter Import würde den bewusst build-losen `apps/web`
  brechen): `packages/shared-types/test/auth.test.ts` enthält jetzt zwei
  Regressionstests, die eine fehlende bzw. veraltete `consentVersion`
  ablehnen; `apps/api/test/auth/auth.service.test.ts` (neuer Abschnitt
  „Einwilligungsnachweis (Befund S1)") deckt die beiden Verhaltensfälle im
  Service selbst ab: ein Konto mit veralteter gespeicherter
  `consentVersion` wird beim nächsten Login auf den aktuellen Stand
  gehoben; ein Konto, dessen Stand bereits aktuell ist, löst **keinen**
  `users.update()`-Aufruf aus (per `vi.spyOn` geprüft) und sein
  `consentGivenAt` bleibt unverändert. Alle drei Tests scheitern
  nachweislich gegen den Stand vor diesem Fix. Die eigentliche
  Divergenz-Gefahr aus Empfehlung 4 — zwei getrennt gepflegte
  `CURRENT_CONSENT_VERSION`-Konstanten — bleibt bestehen, ist durch diesen
  Fix aber entschärft: ein Auseinanderlaufen führt jetzt zu einem lauten,
  sofort bemerkten Login-Fehler statt zu einem still falsch
  protokollierten Einwilligungsnachweis.
* **Nachtrag (31.08.2026, Verifikationsdurchgang).** Der Absatz darüber
  blieb bei „laut und sofort bemerkt" stehen — laut ist dieser Fehler
  allerdings erst in **Produktion**: kein Test verglich die beiden
  Konstanten, jeder benutzte nur jeweils eine davon. Und das Schadensbild
  ist seit diesem Fix GRÖSSER als vorher: vorher stempelte der Server bei
  Divergenz still seine eigene Version (falscher Nachweis, aber die
  Anmeldung lief); seit `z.literal(CURRENT_CONSENT_VERSION)` scheitert bei
  Divergenz **jede Anmeldung** mit einer 400 — ein vollständiger
  Anmelde-Ausfall. Empfehlung 4s Rückfallebene („mindestens ein Test, der
  beide Werte vergleicht") ist deshalb nachgereicht:
  `apps/web/test/consentVersion.test.js` liest die ausgelieferte Zeile aus
  `state.js` und vergleicht sie gegen die importierte Konstante aus
  `packages/shared-types`. Die Begründung, das sei wegen des build-losen
  `apps/web` nicht möglich, trug nicht: `apps/web/test/db.test.js` nutzt
  für den `CLUB_SCOPED_STORES`-Abgleich seit Längerem exakt dieselbe
  Technik und hält den Grundsatz dort ausdrücklich fest („Ein TEST darf
  shared-types aber laden, nur die ausgelieferte App nicht").
* Testfolge: alle bestehenden Login-Aufrufstellen mit `consent: true` in
  `apps/api/test/auth/{auth.route,auth.service}.test.ts` (9 bzw. 16
  Stellen), `apps/api/test/health.test.ts` (1 Stelle),
  `packages/shared-types/test/auth.test.ts` (8 Stellen) und
  `apps/web/test/apiClient.test.js` (1 Stelle) um `consentVersion`
  ergänzt — 35 Stellen insgesamt. `acceptInvitation()`-Aufrufe (eigenes
  Schema, von S1 nicht betroffen) blieben unverändert.

---

### S2 — Rate-Limits nach IP statt nach Konto (Mittel)

**Ort.** `apps/api/src/modules/auth/auth.route.ts` — `/auth/register`
(Z. 29), `/auth/refresh` (Z. 81), `/auth/logout` (Z. 99),
`/auth/reset-password` (Z. 158), `/api/me/password` (Z. 231),
`/api/me/email` (Z. 264).

**Befund.** `plugins/security.ts` begründet den globalen
`hook: 'preHandler'` ausführlich und ausdrücklich damit, dass der Login
nach **IP + E-Mail** limitieren muss, weil sonst

> „sich ein Verein hinter NAT (Vereinsheim-WLAN o. Ä.) nach 5
> Anmeldungen/Minute selbst aus[sperrt]".

Diese Einsicht ist korrekt und wurde für `/auth/login` und
`/auth/forgot-password` umgesetzt. **Alle übrigen Limits blieben reine
IP-Limits** und reproduzieren damit genau das benannte Problem:

* **`/auth/refresh`, 10/Minute je IP** — der praktisch relevante Fall.
  `apiClient.js` erneuert proaktiv (10 s vor Ablauf, `expiresIn` 900 s) und
  reaktiv bei jedem 401. Eine Trainingsgruppe mit 15 Geräten im
  Vereinsheim-WLAN teilt sich **eine** öffentliche IP und damit **zehn**
  Erneuerungen pro Minute. Der Grenzwert wird im normalen Betrieb erreicht,
  nicht im Angriffsfall — und die Folge ist ein Logout, siehe **U4**.
* **`/auth/register`, 10/Minute je IP** — eine Gruppe, die beim Training
  gemeinsam Einladungen annimmt, läuft in dasselbe Limit.
* **`/api/me/password`, `/api/me/email`, je 5/Minute je IP** —
  authentifizierte Routen, bei denen `request.user.sub` vorliegt und der
  Zähler ohne jeden Umweg an das Konto gebunden werden könnte.

Sicherheitlich ist das IP-Limit zusätzlich **schwächer als beabsichtigt**:
Es schützt kein einzelnes Konto. Wer über wechselnde Adressen verfügt,
umgeht es; wer hinter derselben NAT sitzt wie das Opfer, löst es aus.

**Empfehlung.** Für authentifizierte Routen (`/api/me/*`) den
`keyGenerator` auf `request.user!.sub` setzen. Für `/auth/refresh` nach dem
Hash des vorgelegten Refresh Tokens schlüsseln — er identifiziert das
Konto, ohne dass eine Datenbankabfrage nötig wäre, und liegt zum
`preHandler`-Zeitpunkt bereits im geparsten Body. Das IP-Limit als
großzügigere zweite Schranke daneben bestehen lassen (etwa 100/Minute), um
den ursprünglichen Missbrauchsschutz nicht zu verlieren.

**Fix (30.08.2026) — mit zwei Korrekturen an der eigenen Empfehlung
oben.** Bei der Umsetzung stellten sich beide oben vorgeschlagenen
Schlüssel als nicht tragfähig heraus — nicht als Stilfrage, sondern aus
zwei unabhängigen technischen Gründen, die erst beim tatsächlichen
Implementieren sichtbar wurden:

1. **`request.user!.sub` ist im `keyGenerator` tatsächlich nicht
   erreichbar — nicht nur unbequem, sondern strukturell.** Die
   ursprünglichen (jetzt überholten) Code-Kommentare bei `/api/me/password`
   und `/api/me/email` behaupteten das bereits, und die Prüfung bestätigt
   es: Fastify hängt einen per `addHook(hook, fn)` registrierten Hook —
   genau so registriert `@fastify/rate-limit` sich selbst (siehe
   `plugins/security.ts`) — bei JEDER Route VOR deren eigene, im
   Routen-Objekt angegebene `preHandler`-Option. Das gilt unabhängig davon,
   ob der Rate-Limiter global oder (versuchsweise) in einem verschachtelten
   Plugin-Scope registriert wird — die Verschachtelung ändert an dieser
   Reihenfolge nichts. `app.authenticate` als route-eigene `preHandler`-
   Option läuft deshalb IMMER nach dem Rate-Limiter, egal wie die
   Registrierung strukturiert ist. Eine Umgehung — `app.authenticate`
   stattdessen als `preValidation`-Hook der Route registrieren (läuft vor
   `preHandler`, `request.user` stünde damit rechtzeitig zur Verfügung) —
   wurde erwogen und verworfen: Sie hätte einen fehlenden/ungültigen Token
   sofort mit 401 beantwortet, BEVOR der Rate-Limiter überhaupt greift —
   unauthentifizierte Anfragen an diese beiden Routen wären dadurch
   überhaupt nicht mehr rate-limitiert gewesen (schlechter als der
   Ausgangszustand, nicht besser).
   
   **Tatsächliche Lösung:** Der rohe `Authorization`-Header steht — anders
   als `request.user` oder `request.body` — bereits ab dem allerersten
   Hook zur Verfügung, unabhängig von jeder Parsing- oder Auth-Stufe. Ein
   SHA-256-Hash dieses Headers (`accessTokenRateLimitKey()` in
   `auth.route.ts`, mit `${request.ip}:no-token` als Schlüssel bei
   fehlendem Header) trennt die Budgets verschiedener angemeldeter
   Personen genauso zuverlässig wie `request.user.sub` — ohne auf dessen
   Auswertung warten zu müssen.

2. **Ein Schlüssel aus dem vorgelegten Refresh-/Einladungs-/Reset-Token
   wäre für `/auth/refresh` kontraproduktiv gewesen — er hätte das Limit
   praktisch abgeschaltet.** Der Zweck dieser Limits ist laut den
   BESTEHENDEN Code-Kommentaren an allen vier betroffenen Routen explizit
   die Abwehr von automatisiertem Durchprobieren/Erraten des jeweiligen
   Tokens. Würde der Schlüssel aus GENAU diesem Wert gebildet, bekäme jeder
   neue Rateversuch mit einem anderen erfundenen Token sein eigenes,
   frisches Budget — ein Angreifer, der bei jedem Versuch einen neuen Wert
   ausprobiert, würde nie gedrosselt, weil er den Schlüssel selbst frei
   wählt. Das ist der exakte Gegensatz zur Absicht des Limits. Betroffen:
   `/auth/refresh`, `/auth/register`, `/auth/logout`, `/auth/reset-password`
   — bei allen vieren ist der im Body übertragene Wert genau das Geheimnis,
   das erraten werden soll, nicht eine bereits besessene, stabile
   Kennung wie beim Access Token unter Punkt 1 oben.
   
   **Tatsächliche Lösung:** Schlüssel bei allen vieren unverändert IP-only
   belassen; stattdessen den Grenzwert dort angehoben, wo eine legitime
   NAT-Kollision praktisch vorkommt: `/auth/refresh` 10 → 60/Minute (der
   praktisch relevante Fall — `apiClient.js` erneuert JEDE Sitzung
   automatisch/proaktiv, nicht nur bei einer bewussten Aktion),
   `/auth/register` 10 → 20/Minute (eine Trainingsgruppe, die gemeinsam
   Einladungen annimmt). `/auth/logout` und `/auth/reset-password`
   unverändert gelassen — beides seltene, bewusste Einzelaktionen ohne
   automatischen Hintergrund-Trigger, eine legitime Kollision ist dort
   unrealistisch. Die 256 Bit Entropie der betroffenen Token (siehe
   `auth/tokens.ts`) machen ein tatsächliches Erraten ohnehin unerreichbar;
   die höheren Grenzwerte ändern daran nichts Messbares, nehmen aber
   echten Nutzer:innen die Reibung.

* `apps/api/src/modules/auth/auth.route.ts`: neue Funktion
  `accessTokenRateLimitKey()` (ausführlich kommentiert, inkl. der
  Begründung, warum sie bewusst NICHT für die vier token-basierten Routen
  gilt), als `keyGenerator` für `/api/me/password` und `/api/me/email`
  eingesetzt; Grenzwerte von `/auth/refresh` und `/auth/register` erhöht;
  `/auth/logout` und `/auth/reset-password` mit einem Kommentar versehen,
  der die bewusste Nicht-Änderung begründet.
* Neuer Regressionstest in `apps/api/test/auth/auth.route.test.ts`: zwei
  Konten hinter derselben (in `app.inject()` nicht gesetzten, also
  identischen) IP teilen sich nicht mehr dasselbe `/api/me/password`-
  Budget — Konto B kann noch abrufen, nachdem Konto A seines ausgeschöpft
  hat. Bestehende Rate-Limit-Tests für `/auth/refresh` (in
  `auth.route.test.ts` und zweimal in `test/plugins/security.test.ts`, dort
  im Zusammenhang mit dem `trustProxy`-Befund H1) auf die neuen Grenzwerte
  nachgezogen. Alle drei neuen/geänderten Tests scheitern nachweislich
  gegen den Stand vor diesem Fix (per `git stash` von `auth.route.ts`
  empirisch geprüft); die bestehenden `/api/me/password`- und
  `/api/me/email`-Tests bestehen unverändert, da sie durchgehend denselben
  Access Token verwenden und somit denselben Schlüssel treffen.

---

### S3 — Zeitliche Nutzerauskunft bei „Passwort vergessen" (Niedrig)

**Ort.** `apps/api/src/modules/auth/auth.service.ts:405-425`.

**Befund.** Antwortkörper und Statuscode sind für existierende und nicht
existierende Adressen identisch — das ist bewusst und richtig gelöst
(`auth.route.ts`, neutrale Meldung). Die **Laufzeit** ist es nicht:

```ts
const user = await deps.users.findByEmail(email);
if (!user) return;                                  // ← sofort zurück
const { plainToken, tokenHash, expiresAt } = generatePasswordResetToken(...);
await deps.passwordResetTokens.create(user.id, tokenHash, expiresAt);
```

Der Treffer-Pfad erzeugt ein Token, hasht es und schreibt eine
Datenbankzeile; der Fehlschlag-Pfad tut nichts davon. Die Differenz ist
stabil und über wenige Messungen mittelbar — die Adressliste eines Vereins
lässt sich damit durchprobieren.

Bemerkenswert ist, dass `login()` unmittelbar darüber genau diese Gefahr
adressiert und dafür eigens einen Dummy-Hash vorhält
(`DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY`, Z. 18-19). Die Sorgfalt wurde
auf die zweite Route mit demselben Problem nicht übertragen.

**Empfehlung.** Auf dem Fehlschlag-Pfad dieselbe Arbeit leisten — Token
erzeugen und hashen, Ergebnis verwerfen. Der Schreibvorgang lässt sich
nicht spiegeln; ihn dem Antwortpfad zu entziehen (nicht `await`en, analog
zum bereits so gehandhabten Mailversand) gleicht auch diesen Anteil an.

**Fix (31.08.2026).** Umgesetzt wie empfohlen.

* `apps/api/src/modules/auth/auth.service.ts: requestPasswordReset()`:
  Token-Erzeugung/-Hash (`generatePasswordResetToken()`) läuft jetzt VOR
  der `if (!user) return`-Prüfung, also auf beiden Pfaden identisch. Der
  Schreibvorgang (`passwordResetTokens.create()`) ist jetzt — wie der
  bereits zuvor so behandelte Mailversand direkt darunter — nicht mehr
  `await`et; ein Fehlschlag wird nur serverseitig geloggt, nie an den
  Client durchgereicht. Der ursprüngliche Kopfkommentar der Funktion
  beschrieb nur die Mailversand-Asymmetrie als adressiert; er ist um den
  hier behobenen zweiten Anteil ergänzt, statt einen zweiten,
  widersprüchlichen Kommentar danebenzustellen.
* Neuer Regressionstest in `apps/api/test/auth/auth.service.test.ts`: ein
  absichtlich nie auflösendes `passwordResetTokens.create()` (per
  `vi.spyOn().mockReturnValue()`) darf `requestPasswordReset()` nicht
  blockieren — vor diesem Fix wäre der Test in einen Timeout gelaufen
  (empirisch mit `git stash` geprüft: der Testlauf hängt tatsächlich,
  statt fehlzuschlagen, und musste per `timeout` abgebrochen werden).

---

### S4 — E-Mail-Wechsel ohne Benachrichtigung der bisherigen Adresse (Niedrig)

**Ort.** `apps/api/src/modules/auth/auth.service.ts: changeEmail()`.

**Befund.** Der Vorreview (29.08., Beobachtung B1) notierte, dass die
**neue** Adresse nicht bestätigt wird. Die andere Hälfte fehlt ebenfalls:
Die **bisherige** Adresse erfährt vom Wechsel nichts.

Zusammen ergibt das den klassischen Übernahme-Persistenzpfad. Wer für 15
Minuten über ein Access Token verfügt (entwendetes Gerät, kurz unbeaufsichtigte
Sitzung), ändert die Adresse; alle Refresh Tokens werden widerrufen — das ist
richtig und gewollt, wirkt hier aber gegen die rechtmäßige Nutzer:in: Sie ist
abgemeldet, ihr Passwort funktioniert nicht mehr für die neue Adresse, und
„Passwort vergessen" stellt nun an das Postfach der Angreifer:in zu. Ein
Hinweis an die alte Adresse ist der einzige Kanal, der der betroffenen Person
in dieser Lage noch bleibt.

**Empfehlung.** Bei `changeEmail()` (und sinnvollerweise auch bei
`changePassword()`) eine Benachrichtigung an die **bisherige** Adresse
senden. Der Mailer und ein lokalisiertes Template-Muster existieren bereits
(`mail/mailer.ts`), der Versand kann wie beim Passwort-Reset
fire-and-forget erfolgen. Eine Rückabwicklungs-Frist über einen
Einmal-Link wäre die stärkere, aber auch aufwendigere Ausbaustufe.

**Fix (31.08.2026).** Beides umgesetzt — `changeEmail()` **und**
`changePassword()`, nicht nur Ersteres. Grund: die im Befund beschriebene
Kontoübernahme mit einem gestohlenen Access Token gelingt einer
angreifenden Person genauso gut allein über einen Passwortwechsel (sofort
wirksame Aussperrung, ohne den Umweg über die E-Mail-Adresse) — eine
Benachrichtigung nur bei `changeEmail()` hätte diesen naheliegenderen Weg
lautlos gelassen. Die Rückabwicklungs-Frist über einen Einmal-Link
(zweiter Teil der Empfehlung) bleibt bewusst offen — eine eigenständige,
größere Ausbaustufe, wie die Empfehlung selbst schon einordnet.

* `apps/api/src/mail/mailer.ts`: neuer Payload-Typ
  `AccountSecurityChangeMailPayload` und `sendAccountSecurityChangeNotice()`
  in `MailSender` — EIN gemeinsamer Vorlagensatz für beide Auslöser
  (`changeType: 'email' | 'password'`) statt zweier fast identischer
  Kopien, da sich der Text nur in einem Wort unterscheidet. Bewusst ohne
  Link/Aktion in der Nachricht selbst — mangels Rückabwicklungsmechanismus
  (siehe oben) verweist sie auf den einzigen heute verfügbaren nächsten
  Schritt: die eigene Vereinsleitung kontaktieren. `SmtpMailSender`,
  `ConsoleMailSender` (unbedenklich zu loggen — kein Geheimnis/Token wie
  bei den beiden anderen Mailtypen) und `InMemoryMailSender` (Testdouble)
  entsprechend ergänzt.
* `apps/api/src/modules/auth/auth.service.ts`: `changeEmail()`
  benachrichtigt `user.email` — die Adresse **vor** dem Wechsel, nicht
  `updated.email` — genau der Kanal, den der Befund als fehlend
  identifiziert; `changePassword()` benachrichtigt dieselbe (unveränderte)
  Adresse. Beide Aufrufe fire-and-forget (nicht `await`et), analog zum
  bereits so gehandhabten Mailversand bei `requestPasswordReset()` — ein
  Fehlschlag darf den eigentlichen, bereits abgeschlossenen Wechsel nicht
  im Nachhinein scheitern lassen.
* 9 neue Tests: 2 in `auth.service.test.ts` (je ein Test pro Auslöser,
  prüft Empfänger-Adresse und `changeType`), 7 in `mail/mailer.test.ts`
  (Aufzeichnung im Testdouble, HTML-Escaping von `recipientName`,
  Lokalisierung beider Sprachen, Unterscheidung "E-Mail-Adresse" vs.
  "Passwort" im Text, der Hinweis auf die Vereinsleitung in beiden
  Sprachen). Alle 9 scheitern nachweislich gegen den Stand vor diesem Fix
  (per `git stash` empirisch geprüft).

---

### S5 — Rechteentzug wirkt bis zu 15 Minuten verzögert (Niedrig)

**Ort.** `apps/api/src/plugins/authenticate.ts`;
`apps/api/src/modules/sync/sync.route.ts:46-58`.

**Befund.** `requesterFrom()` liest `enabledModules` bei jeder Anfrage
frisch aus der Datenbank — Modul-Abbestellungen wirken also sofort. Die
sicherheitlich gewichtigeren Felder `role`, `clubId` und `athleteId`
stammen dagegen aus den Claims des Access Tokens und leben dessen volle
Laufzeit (`JWT_ACCESS_TTL_SECONDS`, Standard 900 s).

Folgen: Wer eine:n Trainer:in zur Athlet:in herabstuft, gewährt bis zu 15
Minuten unveränderte Schreibrechte auf Pläne, Vorlagen und
Athlet:innendaten. `requestAccountDeletion()` widerruft alle Refresh
Tokens, aber das ausgestellte Access Token bleibt gültig — ein zur
Löschung vorgemerktes Konto synchronisiert bis zu 15 Minuten weiter.

Das ist die übliche und bewusste Abwägung bei kurzlebigen JWTs und kein
Fehler; für die beiden genannten Pfade lohnt die Ausnahme.

**Empfehlung.** Ein Feld `tokensValidFrom` auf `User`, gesetzt bei
Rollenwechsel und Löschvormerkung, im `authenticate`-Plugin gegen die
`iat`-Claim geprüft. Da `requesterFrom()` ohnehin je Anfrage die Datenbank
befragt, ließe sich die Prüfung dort ohne zusätzliche Rundreise
unterbringen — sinnvollerweise gemeinsam mit dem Cache aus **E1**.

**Entscheidung (31.08.2026): akzeptiertes Risiko, absichtlich
unverändert.** Zwei Korrekturen an der eigenen Einschätzung oben, beide
erst beim Versuch der Umsetzung sichtbar geworden — und dieselbe
Fehlerklasse zeigt, warum ein zweiter Blick vor der Umsetzung lohnt,
statt eine plausibel klingende Empfehlung ungeprüft zu übernehmen:

1. **„`requesterFrom()` befragt ohnehin je Anfrage die Datenbank" ist
   ungenau.** `requesterFrom()` fragt ausschließlich `clubs.findById()` ab
   (für `enabledModules`) — **nie** die `users`-Tabelle. Eine
   `tokensValidFrom`-Prüfung wäre keine Erweiterung einer bereits
   vorhandenen Abfrage, sondern eine ZUSÄTZLICHE, neue Datenbankabfrage auf
   den beiden höchstfrequentierten Endpunkten der gesamten Anwendung
   (`/api/sync/push`/`pull`, laut deren eigenem Kopfkommentar "den Kern der
   App-Last tragen"). Das ist exakt die Kostenabwägung, die
   `plugins/authenticate.ts` bereits ausführlich dokumentiert (Sicherheits-
   review 2026-08, Befund N4 — bewusste Entscheidung GEGEN einen
   DB-Lookup je authentifizierter Anfrage, zugunsten des Performance-
   Vorteils kurzlebiger, zustandsloser Access Tokens) — dieser Befund
   benennt damit ein bereits bekanntes, absichtlich in Kauf genommenes
   Verhalten neu, keine unbemerkte Lücke.
2. **Die Hälfte des beschriebenen Schadensbilds ist heute unerreichbar.**
   Ein Rollenwechsel eines BESTEHENDEN Kontos existiert als Funktion
   schlicht nicht — `UpdateUserInput` (auth.repository.ts) erlaubt
   ausschließlich `name`/`email`/`locale`/`consentGivenAt`/
   `consentVersion`/`deletedAt`/`passwordHash`; `role`, `clubId` und
   `athleteId` werden nur bei der Kontoerstellung (Einladungsannahme)
   gesetzt und danach nie mehr verändert. Der im Befund geschilderte
   „Trainer:in zu Athlet:in herabstufen"-Fall kann im heutigen
   Funktionsumfang gar nicht eintreten.

Real und reproduzierbar bleibt nur die zweite Hälfte: ein zur Löschung
vorgemerktes Konto kann bis zu 15 Minuten weitersynchronisieren, bevor
sein Access Token regulär abläuft. Das ist exakt der in Befund N4 bereits
benannte Trade-off, nicht neu. Eine `tokensValidFrom`-Prüfung würde ihn
zwar schließen, aber nur um den Preis, die N4-Entscheidung für die am
stärksten frequentierten Endpunkte der App rückgängig zu machen — ohne
den in **E1** vorgesehenen Cache wäre das eine zusätzliche Datenbank-
abfrage pro Sync-Anfrage. Bleibt deshalb bewusst unverändert; siehe die
ausführliche Begründung direkt in `plugins/authenticate.ts`. Sollte
künftig doch eine Rollenänderung eingeführt werden, oder sollte **E1**s
Cache ohnehin gebaut werden, sinkt der Grenzaufwand einer
`tokensValidFrom`-Prüfung deutlich — dann lohnt ein erneuter Blick.

---

## Effizienz

### E1 — Ein Vereins-Lookup je Sync-Anfrage (Mittel)

**Ort.** `apps/api/src/modules/sync/sync.route.ts:51`.

**Befund.** `requesterFrom()` ruft `clubs.findById(user.clubId)` bei
**jeder** Push- und **jeder** Pull-Anfrage. Pull ist paginiert
(`PULL_PAGE_SIZE = 200`), und `syncClient.js: pull()` läuft in einer
Schleife bis `hasMore === false` — bis zu `MAX_PULL_ITERATIONS = 1000`
Seiten. Ein Erstabgleich liest damit bis zu **1.000-mal dieselbe
`Club`-Zeile**, deren Inhalt sich während des Abgleichs nicht ändert.

Das ist derselbe Befundtyp, den der Performance-Durchgang (`332ee7a`) für
`sync.foreignKeys.ts` behoben hat — an der einen Stelle, die pro *Anfrage*
statt pro *Referenz* auftritt und deshalb dort nicht auffiel.

**Empfehlung.** `enabledModules` je `clubId` mit kurzer Lebensdauer
(30–60 s) im Speicher halten. Die Fail-Closed-Semantik bleibt unberührt —
ein abbestelltes Modul wirkt dann höchstens eine Minute später statt
sofort, was gegenüber der Access-Token-Laufzeit von 15 Minuten (siehe
**S5**) ohnehin die schärfere Schranke ist. Dieselbe Zwischenschicht kann
die in **S5** vorgeschlagene `tokensValidFrom`-Prüfung mittragen.

**Fix (31.08.2026).** Umgesetzt wie Empfehlung, mit TTL = 45 s statt der
vorgeschlagenen 30–60 s (Mittelwert des Empfehlungsbereichs).

* `apps/api/src/modules/sync/sync.route.ts`: `requesterFrom()` ist jetzt
  eine Closure **innerhalb** von `syncRoutes()` (vormals eine
  Modul-Funktion, die `clubs` als Parameter entgegennahm) und lädt
  `enabledModules` über eine neue, ebenfalls lokale
  `resolveEnabledModules(clubId)`-Hilfsfunktion samt
  `clubModulesCache: Map<string, CachedClubModules>`. Bewusst als Closure
  **innerhalb** `syncRoutes()`, nicht als modulweiter Singleton: jeder
  `buildApp()`-Aufruf — insbesondere jeder Test über `buildTestApp()` —
  bekommt dadurch automatisch seinen eigenen, leeren Cache, ohne dass
  Tests ihn manuell zurücksetzen müssten oder zwischen ihnen veraltete
  Werte eines anderen Tests sehen könnten.
* Unproblematisch für den dokumentierten Produktivbetrieb: `docs/deployment.md`
  startet die API per `pm2 start dist/index.js --name lane1-api` **ohne**
  Cluster-Flag (`-i`) — genau ein Node-Prozess, also kein
  Mehrprozess-Konsistenzproblem zwischen mehreren, unabhängig
  ablaufenden Caches.
* 2 neue Regressionstests in `apps/api/test/sync/sync.route.test.ts`
  (Abschnitt „Vereins-Modul-Lookup je Sync-Anfrage"). Der `clubs`-Stub in
  `buildTestApp()` ist dafür von einer nackten Pfeilfunktion auf `vi.fn()`
  umgestellt und wird mit zurückgegeben — Rückgabewert und Verhalten
  unverändert, nur zählbar.
  1. **Der Cache greift überhaupt:** fünf aufeinanderfolgende Pull-Anfragen
     desselben Vereins lösen genau **einen** `clubs.findById()`-Aufruf aus;
     eine Anfrage eines ANDEREN Vereins löst einen zweiten aus (der Cache
     ist nach `clubId` geschlüsselt — ein gemeinsamer Eintrag wäre ein
     Mandantendurchbruch auf der Rechte-Ebene). Dieser Test schlägt gegen
     den Stand vor dem Fix nachweislich fehl (`expected "vi.fn()" to be
     called 1 times, but got 5 times`; per `git checkout 726110e --
     sync.route.ts` empirisch geprüft).
  2. **Der Cache verfällt auch wieder:** nach Vorstellen von `Date.now()`
     um 46 s (> `CLUB_MODULES_CACHE_TTL_MS`) wird erneut gelesen. Diese
     zweite Hälfte ist die sicherheitsrelevante — ein Cache ohne Verfall
     ließe ein per Superadmin abbestelltes Modul nie wirksam werden. Sie
     besteht erwartungsgemäß auch gegen den alten Code (der ohne Cache
     ohnehin bei jeder Anfrage liest) und sichert damit nicht den Befund
     ab, sondern die Unbedenklichkeit des Fixes selbst.

  Eine frühere Fassung dieses Abschnitts hielt einen Regressionstest hier
  für nicht sinnvoll möglich („mit dem vorhandenen Stub nicht sinnvoll
  zählbar"). Das war falsch — das Zählen der Aufrufe eines Test-Doubles ist
  Standard und war ohne Weiteres möglich; die Tests sind nachgereicht.

### E2 — `push()` arbeitet 200 Events seriell ab (Mittel)

**Ort.** `apps/api/src/modules/sync/sync.service.ts: push()`.

**Befund.** Die Schleife `for (const raw of events)` verarbeitet jedes
Event vollständig, bevor das nächste beginnt. Je Event fallen dabei
mindestens drei nacheinander laufende Datenbank-Rundreisen an:
`isEventProcessed()` (Guard), `findById()` (Konfliktauflösung) und
`applyAndMarkProcessed()`. Bei `PUSH_BATCH_SIZE = 200` in
`syncClient.js` sind das rund **600 sequenzielle Abfragen in einer
einzigen HTTP-Anfrage**. Auf dem dokumentierten Raspberry-Pi-Deployment
(`docs/deployment-raspberry-pi.md`) dominiert das die Dauer des ersten
Abgleichs nach einem Gerätewechsel.

Die serielle **Reihenfolge** ist dabei nicht beliebig: Der
Performance-Durchgang hat die Sendereihenfolge eigens auf `createdAt`
umgestellt, weil `resolveConflict()` die Events eines Blocks der Reihe
nach bewertet und ein Update sonst vor seinem Create eintreffen kann.
Vollständige Parallelisierung wäre also falsch.

**Empfehlung.** Die **Lesephase** vorziehen, die Entscheidungsphase seriell
lassen:

1. Nach dem Parsen aller Events einmalig alle Event-IDs gegen das
   Idempotenz-Ledger prüfen (eine `findMany`-Abfrage statt 200).
2. Alle `(store, entityId)`-Paare nach Store gruppieren und je Store in
   einer Abfrage laden — das Muster, das `findExistingIdsInClub()` für die
   Fremdschlüsselprüfung bereits etabliert hat.
3. Die bestehende Schleife unverändert in ihrer Reihenfolge über die
   vorgeladenen Maps laufen lassen; nur die Schreibvorgänge bleiben
   einzeln.

Aus ~600 Rundreisen werden so ~200 plus eine Handvoll.

**Fix (31.08.2026).** Umgesetzt wie Empfehlung, mit einer zusätzlichen
Korrektheits-Absicherung, die die Empfehlung selbst nicht benannte:

* `apps/api/src/modules/sync/sync.gateway.ts` (`SyncGateway`-Interface plus
  `PrismaSyncGateway`) und `sync.gateway.memory.ts`
  (`InMemorySyncGateway`): zwei neue Batch-Methoden.
  `findProcessedEventIds(eventIds, clubId)` ersetzt in `push()` die
  bisherigen 200 einzelnen `isEventProcessed()`-Aufrufe durch einen
  einzigen; `isEventProcessed()` selbst bleibt unverändert bestehen (wird
  weiterhin von `applyAndMarkProcessed()` und vom
  Prisma-Integrationstest direkt verwendet).
  `findManyByIdsInClub(store, ids, clubId)` liefert — anders als das
  bereits bestehende `findExistingIdsInClub()` (reine Existenzmenge für
  die Fremdschlüsselprüfung) — die **vollständigen** Datensätze, die
  `push()` für die Konfliktentscheidung (`resolveConflict()` braucht
  `updatedAt`), die Eigentümerprüfung von `results` und die
  Kommentar-Autor:innenschaft benötigt; eine Abfrage je betroffenem Store
  statt einer je Event.
* `apps/api/src/modules/sync/sync.service.ts: push()`: vor der
  bestehenden, in ihrer Reihenfolge **unveränderten** Schleife (Empfehlung
  3) werden jetzt einmalig alle Events grob vorgeparst (dasselbe
  `SyncEventSchema.safeParse()` + `isKnownStore()`, das `parseEvent()`/
  `requireKnownStore()` ohnehin gleich anschließend erneut und
  verbindlich anwenden — ein hier nicht erfasstes, weil strukturell
  ungültiges Event scheitert deterministisch an genau diesen beiden
  Guards und erreicht die `existing`-Ermittlung nie), um
  `findProcessedEventIds()` einmal für den gesamten Batch sowie
  `findManyByIdsInClub()` einmal je betroffenem Store aufzurufen.
  `shortCircuitIfProcessed()` (Guard-Stufe 4) prüft danach nur noch gegen
  die vorab geladene Menge, ohne eigenen Datenbankzugriff.
* **Korrektheits-Absicherung, über die Empfehlung hinaus.** Ein einzelner
  Offline-Datensatz kann laut `apps/web/js/db.js`
  (`enqueueSyncEvent()` vergibt bei **jedem** Aufruf eine neue Event-ID)
  mehrere Sync-Events erzeugen, die im selben Push-Batch landen — z. B.
  anlegen, dann sofort ändern. Ohne weitere Vorkehrung wäre die vorab
  geladene "existing"-Karte für das zweite Event auf dieselbe `entityId`
  **veraltet** (sie spiegelt den Stand vor dem gesamten Batch): das
  Update sähe fälschlich "existiert nicht" und liefe in den
  `create()`-Zweig statt den `update()`-Zweig — mit dem soeben im selben
  Batch bereits vergebenen `id`, also einem Unique-Constraint-Fehler
  (P2002) statt der erwarteten Aktualisierung. Ein
  `touchedInThisPush: Set<string>` markiert jedes `(store, entityId)`,
  sobald `push()` es im laufenden Batch tatsächlich schreibt (bei jedem
  Zweig außer `insert-as-new`, wo die ursprüngliche Zeile unangetastet
  bleibt), und erzwingt für eine spätere Wiederholung derselben
  `entityId` innerhalb desselben Batches einen einzelnen, frischen
  `findById()`-Aufruf statt der vorab geladenen Karte — für die
  überwältigende Mehrheit der Events (jede `entityId` kommt nur einmal im
  Batch vor) bleibt es beim einmaligen Vorab-Laden. Analog verhindert ein
  mutables, per Referenz an jeden Guard-Kontext weitergegebenes
  `processedEventIds`-Set (um die jeweilige `event.id` ergänzt, sobald
  ihre Schreibung erfolgreich abgeschlossen ist), dass eine **doppelt**
  im selben Batch gesendete `event.id` denselben Schreibversuch ein
  zweites Mal auslöst — identisch zum Verhalten des vormaligen
  Live-Datenbank-Checks, der den zwischenzeitlich committeten
  Ledger-Eintrag gesehen hätte.
* **Tatsächlich erreichte Zahlen** (gemessen, indem sämtliche
  Gateway-Aufrufe eines 200-Event-Batches gezählt wurden; die Messung
  selbst war ein Wegwerf-Test und ist nicht Teil des Commits). Die
  Schätzung der Empfehlung oben („aus ~600 werden ~200 plus eine
  Handvoll") trifft nur für Stores **ohne** Fremdschlüssel-Referenzen zu:

  | 200er-Batch | vorher | nachher |
  |---|---|---|
  | `groups` (keine Referenzen) | ~600 | **202** (1 + 1 + 200 Schreibtransaktionen) |
  | `results` (athleteId-Referenz) | ~800 | **402** (zusätzlich 200× die Fremdschlüsselprüfung) |

  Die verbleibenden 200 Schreibtransaktionen sind der bewusst seriell
  belassene Teil (Empfehlung 3). Die 200 Fremdschlüsselprüfungen sind der
  im nächsten Punkt begründete, absichtlich nicht mitgezogene Rest —
  „~200 plus eine Handvoll" wird für solche Stores also **nicht**
  erreicht, die Halbierung gegenüber vorher schon.
* `requireForeignKeysWithinClub()` (Guard-Stufe 7) bleibt bewusst
  **unangetastet**: der Befund benannte ausdrücklich nur
  `isEventProcessed()`, `findById()` und `applyAndMarkProcessed()` als die
  drei Rundreise-Typen; die Fremdschlüsselprüfung wurde bereits im
  Performance-Durchgang (`332ee7a`) für den Fall vieler Referenzen
  **innerhalb eines Events** optimiert. Sie zusätzlich **über mehrere
  Events eines Batches hinweg** zu bündeln wäre eine über den Befund
  hinausgehende Erweiterung des Umfangs gewesen und wurde bewusst nicht
  mitgezogen.
* 3 neue Regressionstests in `apps/api/test/sync/sync.service.test.ts`
  (Abschnitt „Batch-Optimierung"): zwei Korrektheits-Wächter (Create
  gefolgt von Update auf dieselbe `entityId` im selben Batch; dieselbe
  `event.id` zweimal im selben Batch) sowie ein Abfrage-Zähler-Test (20
  voneinander unabhängige Events lösen genau 1×
  `findProcessedEventIds()`, genau 1× `findManyByIdsInClub()` und **kein**
  `findById()` aus). Nur der Abfrage-Zähler-Test scheitert nachweislich
  gegen den Stand vor diesem Fix (per `git stash` von ausschließlich
  `sync.service.ts` empirisch geprüft: `findProcessedEventIdsCalls` bleibt
  dort bei 0, da der alte Code stattdessen 20-mal `isEventProcessed()`
  aufruft); die beiden Korrektheits-Wächter bestehen erwartungsgemäß auch
  gegen den alten Code — dessen Live-Nachschläge je Event waren korrekt,
  nur seriell und langsam. Sie sichern die neue Optimierungstechnik selbst
  (`touchedInThisPush`/`processedEventIds`) gegen eine künftige Regression
  ab, in der jemand das Vorab-Laden einführt, ohne diese beiden
  Fallstricke zu bedenken.

### E3 — `pull()` filtert Rechte nach der Paginierung (Niedrig–Mittel)

**Ort.** `apps/api/src/modules/sync/sync.service.ts: pull()`.

**Befund.** Die Seite wird zuerst auf `PULL_PAGE_SIZE` geschnitten, danach
gefiltert:

```ts
changes = changes.filter((change) => canRead(change.store, requester.role, ...));
if (requester.role === 'athlete') { changes = changes.map(scopeChangeForAthlete)... }
```

Für eine Athlet:in liest die Datenbank damit sämtliche Änderungen an
`plans`, `templates`, `exercises`, `sessions` und `actionItems` des
Vereins, materialisiert sie inklusive ihrer JSON-Spalten — und verwirft sie
anschließend im Anwendungscode. Über die Leitung geht korrekt nichts davon
(die Filterung greift vor dem Senden); die **Datenbankarbeit und die Zahl
der Seiten** skalieren aber mit dem Bestand des gesamten Vereins statt mit
dem sichtbaren Bruchteil. Athlet:innen sind die zahlenmäßig größte
Nutzergruppe und typischerweise auf den schwächsten Geräten und
Verbindungen unterwegs.

Ein Korrektheitsproblem ist das **nicht**: `syncClient.js` iteriert über
`hasMore`, nicht über `changes.length`, und verträgt daher leere Seiten.

**Empfehlung.** Die für die Rolle lesbaren Stores an
`listChangedSince()` durchreichen und die Watermark-Abfragen auf sie
beschränken. Das ist eine reine Verengung bereits vorhandener Abfragen und
lässt die zeilenweise Athlet:innen-Redaktion (`scopeChangeForAthlete`)
unangetastet, wo sie ist — die Rechteprüfung wird dadurch nicht verlagert,
sondern nur zusätzlich vorgezogen.

**Fix (31.08.2026).** Umgesetzt genau wie Empfehlung.

* `apps/api/src/modules/sync/sync.service.ts: pull()`: berechnet vor dem
  ersten `listChangedSince()`-Aufruf `readableStores` — die
  `ENTITY_STORE_NAMES`, für die `canRead(store, requester.role,
  requester.enabledModules)` zutrifft — und reicht sie als neues,
  **verpflichtendes** viertes Argument durch, an beide Aufrufstellen (die
  reguläre Seiten-Abfrage und die gezielte Nachfrage bei einer
  Zeitstempel-Kollision, die über die Seitengröße hinausreicht).
* `sync.gateway.ts` (`SyncGateway`-Interface, `PrismaSyncGateway`) und
  `sync.gateway.memory.ts` (`InMemorySyncGateway`): `listChangedSince()`
  nimmt `stores: readonly EntityStoreName[]` jetzt als Pflichtparameter
  entgegen, statt intern eine feste `ALL_STORES`-Konstante zu verwenden —
  sowohl die Watermark-Abfrage je Store als auch (bei Prisma zusätzlich)
  die `syncTombstone`-Abfrage werden auf `stores` eingegrenzt. Ein
  Löschvermerk aus einem nicht lesbaren Store wurde vorher unnötig
  mitgeladen; das ist mit dieser Änderung ebenfalls behoben.
* Der bestehende, **nach** der Paginierung laufende
  `changes.filter((change) => canRead(...))`-Aufruf in `pull()` bleibt
  bewusst **unverändert** bestehen (Empfehlung: „lässt … unangetastet") —
  jetzt als zusätzliche, von der Abfrage unabhängige Absicherung (z. B.
  falls eine künftige Gateway-Implementierung `stores` einmal nicht
  korrekt respektiert), nicht mehr als einzige Instanz dieser Prüfung. Mit
  den heutigen drei synchronisierenden Rollen ist er weiterhin
  größtenteils ein No-Op auf einer bereits vorgefilterten Menge (siehe
  Befundtext zu **STORE_MODULE_MAP**), genau wie vor diesem Fix.
* `apps/api/test-integration/syncGateway.integration.test.ts`: alle sechs
  bestehenden `listChangedSince()`-Aufrufstellen um `ENTITY_STORE_NAMES`
  als viertes Argument ergänzt (Anpassung an die Signaturänderung, kein
  neuer Regressionstest).
* **Neu tragende Stelle — und die Testlücke, die das zunächst aufriss.**
  Vor diesem Fix entschied `canRead()` erst NACH der Abfrage, was der
  Client zu sehen bekommt; ein Fehler darin ließ höchstens zu viel durch.
  Jetzt entscheidet `readableStores` zusätzlich, was überhaupt ABGEFRAGT
  wird — ein Fehler in die andere Richtung (ein Store fällt versehentlich
  heraus) liefert diesen Store stillschweigend nie mehr aus: stiller
  Datenverlust auf dem Gerät, ohne Fehlermeldung. Das ist genau die
  Fehlerwirkung, vor der der mit diesem Fix entfallene
  `ALL_STORES`-Kommentar in `sync.gateway.ts` gewarnt hatte („ein hier
  fehlender Store würde ohne jede Fehlermeldung stillschweigend nie
  ausgeliefert") — das Risiko ist mit dem Fix von dort nach `pull()`
  gewandert.

  Eine frühere Fassung dieses Abschnitts hielt das für durch die
  bestehende Suite abgedeckt („ruft `pull()` bereits mit unterschiedlichen
  `enabledModules`/Rollen auf"). Das war **falsch**: die Rollen variieren,
  `enabledModules` war in JEDEM `pull()`-Test der Suite `MODULE_KEYS`
  (alle Module gebucht) — `sync.permissions.test.ts` prüft `canRead()` nur
  als reine Funktion, nie über `pull()`. Empirisch belegt: ein künstlich
  aus `readableStores` entferntes `entries` bzw. `competitions` ließ die
  **gesamte** Suite (476 Tests) grün.
* 3 neue Regressionstests in `apps/api/test/sync/sync.service.test.ts`
  (Abschnitt „Store-Vorauswahl nach gebuchten Modulen"), die diese Lücke
  schließen: bei eingeschränktem Modul-Set kommen nur die lesbaren Stores
  zurück; bei vollem Modul-Set **jeder** Store; Löschvermerke (Tombstones)
  aus einem nicht gebuchten Store bleiben unterdrückt. Der zweite Test
  läuft bewusst über `ENTITY_STORE_NAMES` statt über eine handverlesene
  Store-Auswahl — eine feste Liste hätte genau die Lücke, die der Test
  schließen soll (ein Store, an den beim Schreiben niemand denkt, ist auch
  der, dessen Ausbleiben niemandem auffällt). Mit einer zuerst
  geschriebenen handverlesenen Fassung (groups/plans/sessions) blieb das
  entfernte `entries` weiterhin unbemerkt; über `ENTITY_STORE_NAMES`
  schlägt der Test fehl.
* Diese drei Tests sind **Verhaltens-Bewahrungs**-Tests, keine
  „scheitert ohne den Fix"-Regressionstests im Sinne der Hausregel: die
  Ergebnismenge war vor dem Fix dieselbe (der Nachfilter erledigte
  dasselbe), sie bestehen also auch gegen den alten Code. Sie sichern die
  neu tragend gewordene `readableStores`-Berechnung ab — geprüft, indem
  ein Store künstlich aus ihr entfernt wurde (siehe oben). Die eingesparte
  Datenbankarbeit selbst ist mit dem In-Memory-Double nicht messbar.

### E4 — Ein Schreibvorgang je Login (Niedrig)

Das `UPDATE users` aus **S1** läuft bei jeder Anmeldung, auch wenn sich
weder Version noch Sachlage geändert haben. Der unter S1 empfohlene
Abgleich (`nur stempeln, wenn abweichend`) beseitigt ihn als Nebenwirkung.

**Fix — bereits erledigt (30.08.2026, mit S1).** Keine eigene Änderung in
diesem vierten Durchgang nötig: `auth.service.ts: login()` schreibt seit
dem S1-Fix `consentGivenAt`/`consentVersion` nur noch, wenn
`user.consentVersion !== CURRENT_CONSENT_VERSION` — siehe den Fix-Abschnitt
von **S1** oben, dessen Test „ein Konto, dessen Stand bereits aktuell ist,
löst **keinen** `users.update()`-Aufruf aus" (per `vi.spyOn` geprüft)
genau diesen Fall bereits abdeckt. Verifiziert für diesen Durchgang durch
erneutes Gegenlesen von `auth.service.ts:321-327` — die bedingte Schreibung
ist unverändert vorhanden und nicht regressiert.

---

## Usability und Barrierefreiheit

Dieser Abschnitt ist der bislang ungeprüfte Teil der Codebasis. Die drei
ersten Befunde sind mit je wenigen Zeilen an **einer** zentralen Stelle zu
beheben und wirken sich jeweils auf die gesamte Anwendung aus.

### U1 — Kein Dialog ist ohne Maus bedienbar (Hoch)

**Ort.** `apps/web/js/modal.js:10` (`openModal()`).

**Befund.** `openModal()` ist der einzige Dialog-Einstiegspunkt der
Anwendung — jedes Anlegen-, Bearbeiten- und Löschformular sowie jede
Bestätigung (`confirmAction()`) läuft hindurch. Die Funktion setzt
`root.hidden = false`, registriert Escape und Backdrop-Klick — und sonst
nichts. Es fehlen sämtliche Bausteine eines zugänglichen Dialogs:

| fehlt | Folge |
|---|---|
| `role="dialog"`, `aria-modal="true"` | Screenreader kündigen keinen Dialog an; der Kontextwechsel bleibt unbemerkt |
| `aria-labelledby` auf die `<h3>` | Der Dialog hat keinen zugänglichen Namen |
| Fokus in den Dialog setzen | Der Tastaturfokus bleibt auf dem auslösenden Button **hinter** dem Overlay; die erste Tab-Taste landet irgendwo im Hintergrund |
| Fokusfalle (Tab/Shift+Tab) | Tab verlässt den Dialog in die Seite dahinter — sichtbar überdeckt, aber weiter fokussierbar |
| `inert`/`aria-hidden` auf `#app-shell` | Screenreader durchlaufen die verdeckte Seite, als sei kein Dialog offen |
| Fokusrückgabe beim Schließen | Nach dem Schließen liegt der Fokus auf `<body>`; die Position in der Liste ist verloren |

In der Summe: Wer die Anwendung mit Tastatur oder Screenreader bedient,
kann **keinen** Datensatz anlegen, bearbeiten oder löschen. Das betrifft den
Kernnutzen der Anwendung, nicht eine Randfunktion.

Das Wartbarkeitsreview (Befund R1) erwähnt eine „Fokus-Falle" als eines der
Dinge, die nach einem gemeinsamen `openEntityForm()`-Helfer *an einer
Stelle* stattfinden würden. Das war eine Absichtserklärung für die Zukunft;
implementiert ist sie weder dort noch hier.

**Empfehlung.** Vollständig in `openModal()` zu lösen, ohne einen einzigen
Aufrufer anzufassen:

```js
const previouslyFocused = document.activeElement;
// box: role="dialog", aria-modal="true", aria-labelledby=<id der h3>, tabindex="-1"
document.getElementById('app-shell')?.setAttribute('inert', '');
(box.querySelector('input,select,textarea,button') ?? box).focus();
// onKey zusätzlich: Tab am letzten fokussierbaren Element -> erstes (und umgekehrt)
// close(): inert entfernen, previouslyFocused?.focus()
```

Rund 25 Zeilen, ein Ort, sämtliche Aufrufstellen profitieren. Von allen Befunden
dieses Reviews hat dieser das mit Abstand beste Verhältnis von Aufwand zu
Wirkung.

**Fix (30.08.2026).** Umgesetzt wie vorgeschlagen, mit einer Präzisierung:
die anfängliche Fokusplatzierung sucht das erste fokussierbare Element
gezielt **im Inhalt** (`bodyNode`), nicht im gesamten Dialog — der
×-Schließen-Knopf steht im Kopf immer vor `bodyNode` und wäre sonst bei
jedem einzigen Dialog das Ergebnis der Suche, unabhängig vom eigentlichen
Formularinhalt (z. B. würde `confirmAction()` beim Öffnen auf das ×
statt auf „Abbrechen" fokussieren). Die Fokusfalle selbst umfasst
weiterhin den **gesamten** Dialog inklusive ×-Knopf — nur die anfängliche
Platzierung überspringt ihn.

* `apps/web/js/modal.js: openModal()`: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` (verweist auf eine neu vergebene ID der `<h3>`),
  `tabindex="-1"` auf die Dialogbox; Fokus beim Öffnen auf das erste
  fokussierbare Element in `bodyNode` (ersatzweise die Box selbst);
  `#app-shell` erhält `inert`, solange der Dialog offen ist, und verliert
  es beim Schließen wieder; eine Fokusfalle in `onKey` hält Tab/Shift+Tab
  innerhalb des Dialogs (inkl. ×-Knopf); `close()` gibt den Fokus an das
  vor dem Öffnen fokussierte Element zurück.
* Neue Testdatei `apps/web/test/modal.test.js` (9 Tests, `jsdom`-Umgebung
  über die `// @vitest-environment jsdom`-Pragma je Testdatei — die
  übrigen `apps/web`-Tests laufen bewusst weiter in der schnelleren reinen
  Node-Umgebung, siehe `vitest.config.js`): Rolle/Name, anfängliche
  Fokusplatzierung (inkl. des Sonderfalls „nur Text, kein Steuerelement"),
  `inert` beim Öffnen/Schließen, Fokusrückgabe, Fokusfalle vorwärts und
  rückwärts, Escape, Klick auf Hintergrund vs. auf die Box selbst. Alle 9
  Tests scheitern nachweislich gegen den Stand vor diesem Fix (per
  `git stash` der drei Fix-Dateien empirisch geprüft).
* Zusätzlich **in einem echten Browser** verifiziert (nicht nur `jsdom`):
  `demo.html` unter der in dieser Umgebung vorinstallierten
  headless-Chromium-Version geladen, den „Add focus area"-Dialog geöffnet
  und per DOM-Inspektion bestätigt — `role="dialog"`/`aria-modal="true"`,
  Fokus auf dem ersten `<select>` des Formulars, `#app-shell` trägt
  `inert`, acht aufeinanderfolgende Tab-Drücke bleiben innerhalb der
  Dialogbox, Escape schließt den Dialog und entfernt `inert` wieder. Dies
  deckt eine Lücke ab, die `jsdom` allein nicht abdecken kann: `jsdom`
  führt kein echtes Fokus-Timing/-Layout aus, ein realer Browser schon.
* U2 und U3 (unten) wirken sich auf denselben Dialog aus, wurden im
  selben Durchgang mitgeprüft und sind ebenfalls behoben.

### U2 — Formularfelder sind nicht beschriftet (Mittel)

**Ort.** `apps/web/js/forms.js:11` (`field()`).

**Befund.**

```js
return el('div', { class: `field ${opts.span2 ? 'span-2' : ''}` }, [
  el('label', {}, labelText),
  inputNode,
  opts.hint ? el('div', { class: 'hint' }, opts.hint) : null,
]);
```

Das `<label>` steht **neben** dem Feld, nicht darum herum, und trägt kein
`for`. Damit besteht keine programmatische Verbindung zwischen Beschriftung
und Eingabefeld. Zwei konkrete Folgen:

1. Screenreader lesen jedes Feld als unbeschriftet vor — visuell steht
   „Geburtsdatum" darüber, angesagt wird „Eingabefeld, leer". Das gilt für
   **jedes** Formular der Anwendung, da alle über `field()` gebaut werden.
2. Ein Klick auf die Beschriftung fokussiert das Feld nicht. Am Beckenrand,
   auf einem Telefon, mit nassen Fingern ist die vergrößerte Trefferfläche
   eines Labels kein Detail — und `dates.js`/`swimTime.js` legen nahe, dass
   genau das die Einsatzumgebung ist.

Der `hint` ist aus demselben Grund nicht über `aria-describedby` angebunden
und wird ebenfalls nicht vorgelesen.

**Empfehlung.** In `field()` eine ID erzeugen (`crypto.randomUUID()` oder
ein Modulzähler), sie auf `inputNode` und als `for` auf das Label setzen,
und den `hint` per `aria-describedby` verknüpfen. Alternativ und noch
einfacher: den `inputNode` **in** das `<label>` einhängen, was die
Verbindung implizit herstellt — verlangt allerdings eine Anpassung an
`css/styles.css`, weil sich die Selektorstruktur ändert. Die ID-Variante ist
die risikoärmere.

**Fix (30.08.2026).** Umgesetzt wie empfohlen, ID-Variante (Modulzähler
`fieldIdCounter`), mit einer Ergänzung für einen in der Empfehlung nicht
bedachten Fall: `athletes.js` übergibt `field()` an einer Stelle (Aktiv-
Status) kein Eingabefeld direkt, sondern ein umschließendes `<div>` mit
einer Checkbox und begleitendem Text darin — ein `for` auf dieses `<div>`
wäre wirkungslos, da es selbst nicht fokussierbar ist. `field()` löst das
per `resolveLabelTarget()` auf: ist `inputNode` selbst ein
`INPUT`/`SELECT`/`TEXTAREA`, wird es direkt verlinkt; sonst wird das
erste `input`/`select`/`textarea` darin gesucht.

* `apps/web/js/forms.js: field()`: vergibt bei Bedarf eine `id` auf das
  aufgelöste Zielelement, setzt `for` auf dem `<label>` entsprechend, und
  verknüpft einen vorhandenen `hint` per `aria-describedby`. Kein Feld
  bleibt ohne `for`, sofern irgendein fokussierbares Steuerelement
  auffindbar ist — reiner Infotext (`opts.hint` ohne Eingabefeld) bleibt
  bewusst ohne `for`.
* Neue Testdatei `apps/web/test/forms.test.js` (6 Tests): `for`/`id`-
  Verknüpfung, eindeutige IDs bei mehreren Feldern auf derselben Seite,
  `aria-describedby` für `hint`, unverändertes Verhalten für `<select>`,
  der Wrapper-Fall (Checkbox + Begleittext), und der Fall ohne
  fokussierbares Element (kein `for`). Scheitert nachweislich gegen den
  Stand vor diesem Fix.

### U3 — `<html lang>` folgt der Sprachwahl nicht (Mittel)

**Ort.** `apps/web/index.html:2`, `demo.html:2`, `admin/index.html:2`
(alle fest `<html lang="de">`); `apps/web/js/i18n.js:38` (`setLocale()`).

**Befund.** Die Lokalisierung ist ansonsten vorbildlich — 872 Schlüssel in
`de-DE` und `en-US`, deckungsgleich, ohne eine einzige Lücke (geprüft durch
vollständigen Abgleich beider Wörterbücher; die drei identischen Werte
`settings.role_admin`, `libraryTransfer.exportButton/importButton` sind
Wörter, die in beiden Sprachen gleich lauten). Umso auffälliger, dass
`setLocale()` das Wörterbuch wechselt, `localStorage` schreibt und die
Listener benachrichtigt — aber `document.documentElement.lang` nie anfasst.
Im gesamten Frontend gibt es keinen einzigen schreibenden Zugriff darauf.

Wer auf Englisch umstellt, erhält englischen Text in einem als deutsch
deklarierten Dokument. Konkret:

* Screenreader sprechen den englischen Text mit deutscher Aussprache aus —
  in der Praxis unverständlich.
* Browser bieten an, die Seite „aus dem Deutschen zu übersetzen", obwohl
  sie bereits in der Sprache der Nutzer:in vorliegt.
* Silbentrennung, Rechtschreibprüfung in Textfeldern und Zitatzeichen
  folgen den falschen Regeln.

**Empfehlung.** Eine Zeile in `setLocale()`:

```js
document.documentElement.lang = locale;   // 'de-DE' | 'en-US'
```

Beide Werte sind gültige BCP-47-Tags und können unverändert übernommen
werden.

**Fix (30.08.2026).** Umgesetzt wie empfohlen — eine Zeile in
`setLocale()`.

* `apps/web/js/i18n.js: setLocale()`: setzt
  `document.documentElement.lang = currentLocale` (hinter einer
  `typeof document !== 'undefined'`-Absicherung, da `i18n.js` auch von
  `apps/web/test/i18n.test.js` in der reinen Node-Umgebung ohne
  `document` importiert wird).
* Neue Testdatei `apps/web/test/i18n.documentLang.test.js` (3 Tests, in
  einer eigenen Datei statt einer Ergänzung von `i18n.test.js`, damit nur
  dieser eine Test die `jsdom`-Umgebung braucht — die übrigen,
  reinen String-Tests von `i18n.js` bleiben in der schnelleren
  Node-Umgebung): Wechsel auf Englisch, Wechsel zurück auf Deutsch,
  Rückfall auf Deutsch bei einer unbekannten Locale. Scheitert
  nachweislich gegen den Stand vor diesem Fix.
* Live im Browser verifiziert (siehe U1-Fix): die dort geladene
  `demo.html` zeigte nach dem automatischen Erkennen der Browsersprache
  korrekt `<html lang="en-US">`.

### U4 — Ein Rate-Limit-Treffer endet als stiller Logout (Mittel)

**Ort.** `apps/web/js/apiClient.js:160-167`; `apps/web/js/state.js:52-56`.

**Befund.** Die Fehlerbehandlung unterscheidet nicht, **warum** eine
Token-Erneuerung scheitert:

```js
// apiClient.js (Z. 160-167)
try { await refreshTokens(); }
catch { clearTokens(); throw err; }

// state.js: restoreSession() (Z. 52-56)
catch { api.clearTokens(); current = null; return null; }
```

`performRefresh()` wirft bei **jedem** nicht-2xx-Status, also auch bei
**429**. Zusammen mit **S2** ergibt das die wahrscheinlichste reale
Fehlersituation der Anwendung: Fünfzehn Geräte im Vereinsheim-WLAN teilen
sich zehn Erneuerungen pro Minute; wer den elften auslöst, wird
kommentarlos auf den Login-Bildschirm geworfen und muss sein Passwort
eingeben. Ein Neuversuch eine Minute später wäre erfolgreich gewesen — die
Sitzung war gültig, nur die Anfrage war zu viel.

Aus Nutzersicht sind „Sitzung abgelaufen", „woanders abgemeldet" und „zu
viele Anfragen aus deinem Netz" ununterscheidbar. Wiederholte, scheinbar
grundlose Passworteingaben sind zudem sicherheitlich unerwünscht: Sie
gewöhnen Nutzer:innen daran, ihr Passwort auf Zuruf einzugeben.

**Empfehlung.** Zwei kleine, unabhängige Änderungen:

1. Bei Status 429 **nicht** `clearTokens()` aufrufen — die Sitzung ist
   gültig. Stattdessen den Fehler durchreichen und die Aktion als
   fehlgeschlagen behandeln; `syncClient` kann sie beim nächsten Lauf
   wiederholen.
2. `describeError()` um einen Zweig für 429 ergänzen (`common.errorRateLimited`,
   sinngemäß „Zu viele Anfragen aus deinem Netzwerk. Bitte in einer Minute
   erneut versuchen.") — inklusive der beiden neuen Schlüssel in `de-DE`
   und `en-US`.

Mit dem in **S2** empfohlenen kontobezogenen Schlüssel verschwindet die
Ursache; die beiden Punkte hier sorgen dafür, dass der Rest-Fall
verständlich bleibt.

**Fix (30.08.2026).** Umgesetzt wie empfohlen — mit einer Präzisierung
gegenüber dem eigenen Empfehlungstext: **S2**s tatsächlicher Fix (siehe
dortiger Fix-Abschnitt) hebt für `/auth/refresh` nur den *Grenzwert* an
(10 → 60/Minute), ändert den Schlüssel aber bewusst NICHT auf einen
kontobezogenen — ein Schlüssel aus dem Refresh Token selbst hätte das
Limit dort gegen automatisiertes Erraten wirkungslos gemacht (siehe dort).
Ein 429 auf `/auth/refresh` wird dadurch seltener, aber nicht unmöglich —
der hier beschriebene Fix bleibt deshalb kein bloßes Sicherheitsnetz für
einen inzwischen beseitigten Fall, sondern eigenständig notwendig.

* `apps/web/js/apiClient.js: request()`: der reaktive 401-Retry
  unterscheidet jetzt, WARUM der anschließende `refreshTokens()`-Versuch
  scheitert. Nur bei einem 429 werden die Tokens NICHT gelöscht — der
  429-Fehler selbst wird durchgereicht (statt des ursprünglichen 401),
  damit `describeError()` eine treffende Meldung zeigen kann. Jeder andere
  Fehlschlag (401, Netzwerkfehler, 5xx) verhält sich unverändert wie
  zuvor.
* `apps/web/js/state.js: restoreSession()`: dieselbe Unterscheidung beim
  Wiederherstellen einer Sitzung nach einem Seiten-Reload — ein 429 lässt
  die gespeicherten Tokens unangetastet, damit ein späterer
  `restoreSession()`-Aufruf (erneutes Laden der Seite) die Sitzung noch
  finden kann; nur ein echter Auth-Fehler (401) räumt sie ab.
* `apps/web/js/apiClient.js: describeError()`: neuer Zweig für Status 429
  (`t('common.errorRateLimited')`), samt dem neuen Schlüssel in
  `i18n/de-DE.js` und `i18n/en-US.js`. `describeAuthError()` in
  `modules/authScreens.js` (die separate, auf den Login-/Registrierungs-
  Bildschirmen verwendete Fehlerzuordnung) bleibt bewusst unangetastet —
  U4 nennt ausdrücklich nur die beiden oben genannten Stellen als Ort des
  Befunds.
* Sechs neue Regressionstests: drei in `apps/web/test/apiClient.test.js`
  (429 beim Refresh-Versuch behält die Tokens und wirft den 429 statt des
  401; ein ECHTER 401 löscht sie weiterhin — Kontrolltest, dass die
  bisherige Handhabung für den nicht betroffenen Fall unverändert bleibt;
  `describeError()`s neuer 429-Zweig) sowie drei weitere in der neuen
  Datei `apps/web/test/state.restoreSession.test.js` (429 → kein
  `clearTokens()`; 401 → weiterhin `clearTokens()`; ein sonstiger Fehler,
  z. B. offline → weiterhin `clearTokens()`, unverändertes Verhalten).
  Eigene Datei statt einer Ergänzung von `state.localStoreOwner.test.js`:
  dessen bestehender `apiClient.js`-Mock führt keine `ApiError`-Klasse, die
  ein `instanceof`-Vergleich hier braucht. Alle sechs Tests scheitern
  nachweislich gegen den Stand vor diesem Fix (per `git stash` von
  `apiClient.js`/`state.js` empirisch geprüft).

### U5 — Aktualisierungen erreichen eine offene Sitzung nie (Niedrig)

**Ort.** `apps/web/sw.js:89` (`skipWaiting()`), `96-97`
(`caches.delete()` + `clients.claim()`).

**Vorbemerkung.** Der Worker selbst ist korrekt gebaut: Der
`install`-Schritt füllt den neuen Cache vollständig aus dem Netz, bevor
aktiviert wird, und der `activate`-Schritt räumt die Altbestände ab. Ein
Neuladen nach einem Rollout liefert deshalb zuverlässig und in **einem**
Durchgang die neue Fassung. Ein Versionsmischmasch zur Laufzeit ist
ebenfalls ausgeschlossen — `index.html` lädt genau ein Modul (Z. 76), und
`moduleRegistry.js` importiert alle 14 Feature-Module statisch. Wenn die
Seite läuft, liegt ihr gesamter Code bereits im Speicher; der einzige
dynamische Import (`app.js:246`, `import('./db.js')`) trifft ein längst
geladenes Modul.

**Befund.** Genau daraus folgt aber, dass `skipWaiting()` und
`clients.claim()` hier nichts bewirken, was sie zu bewirken scheinen. Sie
übernehmen die Kontrolle über die offene Seite — deren JavaScript sich
davon unbeeindruckt weiter aus dem Speicher bedient. Die laufende Sitzung
bleibt bis zu einem manuellen Neuladen auf dem alten Stand, **beliebig
lange**, und erfährt davon nichts: Es gibt keinen `controllerchange`-Hörer,
keinen `registration.waiting`-Hinweis, keine Aufforderung zum Neuladen.

Für eine PWA, die als Installation auf einem Tablet am Beckenrand über
Stunden oder Tage offen bleibt, ist das der Regelfall und nicht die
Ausnahme: Eine ausgerollte Fehlerbehebung erreicht dieses Gerät erst, wenn
jemand von sich aus neu lädt.

Zweitens hängt die Korrektheit des Rollouts daran, dass
`CACHE_VERSION` (Z. 1) bei **jedem** Deployment von Hand hochgezählt wird.
Das ist bisher zuverlässig geschehen (`lane1-v28`), wird aber von nichts
erzwungen — kein CI-Schritt vergleicht die Konstante gegen den geänderten
Dateibestand. Bleibt sie einmal stehen, greift für die geänderten Dateien
stale-while-revalidate, und die neue Fassung erscheint erst beim
**übernächsten** Laden.

**Empfehlung.**

1. Auf `controllerchange` reagieren oder — für Offline-First die
   freundlichere Variante — `skipWaiting()` entfernen, die wartende
   Version über `registration.waiting` erkennen und einen unaufdringlichen
   Hinweis einblenden („Neue Version verfügbar — neu laden"). Erst damit
   erfüllt der heute wirkungslose `skipWaiting()`/`claim()`-Teil einen
   Zweck.
2. Einen CI-Schritt ergänzen, der bei Änderungen unterhalb `apps/web/`
   eine Änderung an `CACHE_VERSION` verlangt.

**Fix (31.08.2026).** Beide Empfehlungen umgesetzt — Empfehlung 1 in der
„freundlicheren" Variante (Hinweis + Knopf, kein automatischer Reload
mitten in einer Eingabe).

* `apps/web/sw.js`: `self.skipWaiting()` beim Install entfernt; ein neuer
  `message`-Handler ruft es stattdessen erst auf explizite Anforderung
  auf (`event.data === 'SKIP_WAITING'`). `CACHE_VERSION` auf `lane1-v29`
  angehoben (diese Änderung selbst berührt precachte Dateien, siehe
  unten).
* Neues, eigenständiges Modul `apps/web/js/swUpdate.js`
  (`registerServiceWorker()`, `notifyUpdateAvailable()`) statt einer
  Erweiterung direkt in `app.js`: `app.js` ist ein Bootstrap-Skript mit
  weitreichenden Seiteneffekten (kompletter Anmelde-/Sync-Ablauf) und
  ließe sich nur mit erheblichem Mock-Aufwand isoliert testen — diese
  Logik hier hängt nur von `dom.js`/`i18n.js` ab und ist dadurch ohne den
  Rest des Boot-Vorgangs testbar. `registerServiceWorker()` erkennt einen
  bereits wartenden Worker sowohl beim Registrieren selbst
  (`registration.waiting`) als auch über `updatefound`/`statechange`
  während der laufenden Sitzung — jeweils nur dann, wenn zusätzlich schon
  ein `navigator.serviceWorker.controller` existiert (unterscheidet ein
  echtes Update vom allerersten Install, bei dem es nichts zu melden
  gibt). `notifyUpdateAvailable()` hängt einen Hinweis mit
  Neu-laden-Knopf an `document.body` an, der `SKIP_WAITING` an den
  wartenden Worker schickt; ein `controllerchange`-Hörer lädt danach
  GENAU EINMAL neu. `app.js` ruft nur noch `registerServiceWorker()`
  auf.
* `apps/web/css/styles.css`: neue `.update-banner`-Regel — anders als ein
  `.toast` (verschwindet nach 3s automatisch) bewusst OHNE
  Selbstverschwinden, ein Update-Hinweis darf nicht verpasst werden,
  bevor die Person aktiv reagiert.
* Neue i18n-Schlüssel `common.updateAvailable`/`common.updateReload` in
  `de-DE`/`en-US`.
* `.github/workflows/ci.yml` (Empfehlung 2): neuer, früher Schritt
  vergleicht die geänderten Dateien des Pushes/PRs gegen dessen Basis
  (`fetch-depth: 0` im Checkout, vorher fehlte die dafür nötige Historie)
  — taucht dabei irgendetwas unterhalb `apps/web/` auf, muss
  `CACHE_VERSION` in `apps/web/sw.js` ebenfalls im Diff stehen, sonst
  schlägt der Schritt fehl. Gegen die tatsächliche Git-Historie dieser
  Änderung lokal verifiziert (beide Richtungen: schlägt fehl, wenn
  `apps/web/js/i18n/*.js` geändert wird, ohne `sw.js` anzufassen; besteht,
  wenn `CACHE_VERSION` mit angehoben wurde).
* **Nachtrag (31.08.2026, Verifikationsdurchgang).** Der Schritt prüfte
  pauschal `-- apps/web` und verlangte damit auch für eine reine
  Test-Änderung (`apps/web/test/`, `vitest.config.js`, `package.json`,
  `eslint.config.cjs`, `README.md` — nichts davon steht in
  `PRECACHE_URLS`, nichts davon erreicht je einen Browser) eine
  `CACHE_VERSION`-Anhebung. Das ist nicht bloß lästig: jede Anhebung
  verwirft den Cache **aller** Clients und erzwingt den erneuten Download
  aller 58 precachten Dateien — ein hoher Preis für eine geänderte
  Testdatei, und ein wirksamer Anreiz, die Prüfung zu umgehen. Der Schritt
  schließt diese Pfade jetzt per `:(exclude)`-Pathspec aus; beide
  Richtungen erneut gegen die echte Historie geprüft (Commit `726110e`
  — ausgelieferte Dateien — löst weiterhin aus, ein reiner Test-Commit
  nicht mehr).
* 6 neue Regressionstests in `apps/web/test/swUpdate.test.js` (`jsdom`-
  Umgebung): sofortiger Hinweis bei bereits wartendem Worker beim
  Registrieren; Hinweis bei einem über `updatefound` erkannten Update,
  aber NICHT beim allerersten Install (kein vorhandener Controller); genau
  ein Reload trotz mehrfach feuerndem `controllerchange`; kein doppelter
  Hinweis bei einem zweiten Aufruf; der Neu-laden-Knopf sendet
  `SKIP_WAITING` an den wartenden Worker. Da `jsdom` keine echte
  Service-Worker-API kennt, bauen die Tests ein minimales Double von
  `ServiceWorkerRegistration`/`ServiceWorker` nach (eigene
  `addEventListener()`/`_emit()`-Helfer). `window.location.reload` ließ
  sich nicht per `vi.spyOn()` ersetzen (jsdoms `Location`-Methoden sind
  nicht konfigurierbar) — der gängige Workaround (`delete
  window.location; window.location = { reload: vi.fn() }`) kommt
  stattdessen zum Einsatz. Alle 6 Tests scheitern nachweislich gegen den
  Stand vor diesem Fix — ohne `swUpdate.js` schlägt bereits der Import
  fehl (per Entfernen der Datei empirisch geprüft).
* Zusätzlich in einem echten, headless-gesteuerten Browser verifiziert:
  `index.html` lädt fehlerfrei, der Service Worker registriert und
  aktiviert sich beim ersten Laden; ein zweites Laden (unveränderter
  Worker) zeigt korrekt KEINEN Update-Hinweis (kein Fehlalarm).

---

## Was geprüft wurde und hielt

Damit der Umfang dieses Reviews nachvollziehbar ist — die folgenden Punkte
wurden gezielt untersucht und gaben **keinen** Anlass zu einem Befund:

* **Mandantentrennung.** `clubId`-Scoping in `sync.service.ts` (Guard-Kette
  `requireOwnClub`, `requireForeignKeysWithinClub`), die
  Athlet:innen-Redaktion in `sync.athleteScope.ts` und die
  Ergebnis-Eigentümerprüfung im Push-Pfad greifen fail-closed und
  lückenlos.
* **XSS im Frontend.** `charts.js` baut SVG per Template-Literal, escapt
  aber alle Textknoten über `esc()` (`textContent` → `innerHTML`).
  Die verbleibende Attribut-Interpolation (`fill="${color}"`) ist im Code
  bereits kommentiert und wird ausschließlich mit Konstanten aufgerufen.
  Die `innerHTML`-Stellen in `authScreens.js` setzen sämtlich den leeren
  String zum Leeren; der übrige DOM-Aufbau läuft über `el()` und
  `setAttribute()`.
* **Lokalisierung.** Vollständiger Abgleich beider Wörterbücher: 872
  Schlüssel, beidseitig deckungsgleich, keine unübersetzten Zeichenketten
  im Produktivpfad (die deutschen Texte in `demoSeed.js` sind
  Demo-Inhalte).
* **Autocomplete-Attribute.** `authScreens.js` setzt `username`,
  `current-password`, `new-password` und `name` korrekt — Passwortmanager
  funktionieren.
* **Nebenläufigkeit der Token-Erneuerung.** `refreshInFlight` in
  `apiClient.js` verhindert zuverlässig ein Erneuerungsrennen mit
  gegenseitigem Token-Widerruf.
* **Offline-Vollständigkeit.** Die 58 Einträge in `PRECACHE_URLS` decken
  alle vorhandenen JS- und CSS-Dateien ab; maschinell abgeglichen, keine
  Lücke.
* **Abhängigkeiten und CI.** `npm audit --omit=dev --audit-level=high`
  blockiert den Merge, der Dev-Lauf ist informativ danebengestellt. Die
  Begründung für den Schwellenwert ist dokumentiert und trägt.
* **Lokaler Datenbestand beim Nutzerwechsel.** Der Fix zu H1 des
  Vorreviews (`ensureLocalStoreBelongsTo()` in `state.js`) greift auf allen
  vier Einstiegspfaden — `restoreSession()`, `login()`,
  `acceptInvitation()`, `resetPassword()`. Nicht regressiert.

---

## Empfohlene Reihenfolge

1. ~~**U1** (Dialog-Barrierefreiheit)~~ — **behoben** (30.08.2026).
2. ~~**S1** (Einwilligungsversion)~~ — **behoben** (30.08.2026).
3. ~~**U2**, **U3**~~ — **behoben** (30.08.2026), im selben Durchgang wie U1.
4. ~~**S2** + **U4**~~ — **behoben** (30.08.2026), gemeinsam angefasst: die
   Ursache (S2) und ihre sichtbare Folge (U4).
5. ~~**S3**, **S4**, **U5**~~ — **behoben** (31.08.2026).
6. ~~**S5**~~ — **akzeptiertes Risiko** (31.08.2026), bewusst ohne
   Codeänderung geschlossen; siehe dessen „Entscheidung"-Abschnitt.
7. ~~**E1**, **E2**, **E3**, **E4**~~ — **behoben** (31.08.2026, vierter
   Durchgang); E4 stellte sich als bereits mit dem S1-Fix erledigt heraus.

Alle vierzehn Befunde dieses Reviews sind damit abgeschlossen (dreizehn
behoben, **S5** als akzeptiertes Risiko).

Für jeden Befund gilt die Hausregel der bisherigen Reviews: ein
Regressionstest, der ohne die Korrektur nachweislich fehlschlägt. Für
**U1**–**U3** ist das jetzt eingelöst — `vitest` mit einer
`jsdom`-Umgebung (per `// @vitest-environment jsdom`-Pragma, nur für die
betroffenen Testdateien) prüft `role`, `aria-labelledby`,
`document.activeElement`, `label.htmlFor` und `documentElement.lang`
unmittelbar; U1 und **U5** zusätzlich in einem echten Browser (siehe deren
Fix-Abschnitte). Dieselbe `jsdom`-Technik trägt auch **U5**s
`ServiceWorkerRegistration`-Double. **S1** und **S3** sind in
Zod-Schema- bzw. Service-Tests direkt geprüft — bei **S3** über ein
absichtlich nie auflösendes gemocktes Promise, das den Testlauf ohne den
Fix in einen Timeout laufen lässt, statt ihn schlicht fehlschlagen zu
lassen. **S2** und **U4** sind über Fastify-Injection (`app.inject()`)
bzw. gemockte `fetch`-Aufrufe direkt geprüft — bei **S2** hat genau diese
Prüfung die ursprünglich vorgeschlagenen Schlüssel (`request.user!.sub`,
ein Hash des Refresh-Tokens) als nicht tragfähig entlarvt; siehe dessen
Fix-Abschnitt für die Korrektur. **S5** hat aus demselben Grund keinen
neuen Test: es wurde keine Codeänderung vorgenommen. Bei **E1** und **E2**
greift die Hausregel wie gewohnt — je ein Test (Anzahl der Club-Lookups
bzw. der Gateway-Abfragen) scheitert nachweislich ohne den jeweiligen Fix.
Bei **E3** ist sie nicht im engeren Sinn anwendbar: die Ergebnismenge ist
vor und nach dem Fix identisch (der Nachfilter erledigte dasselbe), ein
„scheitert ohne den Fix"-Test kann es hier also gar nicht geben. An seine
Stelle tritt die Gegenprobe: ein künstlich aus `readableStores` entfernter
Store lässt die neuen Tests fehlschlagen — was, wie der Nachtrag oben
festhält, vor ihnen nicht der Fall war. Die jeweils zusätzlichen
Korrektheits-Wächter bei **E1** und **E2** bestehen bewusst auch ohne den
Fix: sie sichern nicht den ursprünglichen Befund ab, sondern die neue
Optimierungstechnik selbst gegen eine künftige, weniger sorgfältige
Umsetzung. **E4** hatte ohnehin keinen eigenen Fix in diesem Durchgang,
siehe dessen Abschnitt.
