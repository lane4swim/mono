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

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| **S1** | Jeder Login stempelt die Einwilligung blind auf die *aktuelle* Version — eine geänderte Datenschutzerklärung gilt damit als angenommen, ohne dass sie jemand gesehen hat. Die Versionskonstante wird zusätzlich an zwei Orten gepflegt | `auth.service.ts:311-319`; `shared-types/src/auth.ts:18` + `web/js/state.js:26` | **Hoch — behoben** |
| **S2** | Rate-Limits außerhalb von Login/Passwort-vergessen zählen **nur nach IP** — ein Verein hinter NAT sperrt sich selbst aus; genau der Fall, den `plugins/security.ts` für den Login ausdrücklich vermeiden wollte | `auth.route.ts:29,81,99,158,231,264` | Mittel |
| **S3** | `/auth/forgot-password` verrät per Laufzeit, ob eine Adresse existiert — der Timing-Ausgleich des Logins wurde hier nicht mitgezogen | `auth.service.ts:407` | Niedrig |
| **S4** | E-Mail-Wechsel benachrichtigt die **bisherige** Adresse nicht (Ergänzung zu B1 des Vorreviews, das die *neue* Adresse betrachtete) | `auth.service.ts: changeEmail()` | Niedrig |
| **S5** | Rollen-/Kontoentzug wirkt bis zu 15 Minuten verzögert: `role`/`clubId`/`athleteId` stammen aus den Token-Claims, nur `enabledModules` wird frisch gelesen | `plugins/authenticate.ts`, `sync.route.ts:46-58` | Niedrig |
| **E1** | `requesterFrom()` liest den Verein bei **jeder** Sync-Anfrage — bei einem Erstabgleich bis zu 1.000-mal dieselbe Zeile | `sync.route.ts:51` | Mittel |
| **E2** | `push()` verarbeitet 200 Events streng seriell mit je 3 Rundreisen — ~600 nacheinander laufende Abfragen pro Anfrage | `sync.service.ts: push()` | Mittel |
| **E3** | `pull()` filtert Leserechte **nach** der Paginierung — Athlet:innen bezahlen den Datenbestand des ganzen Vereins für ihren Bruchteil davon | `sync.service.ts: pull()` | Niedrig–Mittel |
| **U1** | **Kein Dialog der Anwendung ist bedienbar ohne Maus:** kein `role="dialog"`, kein Fokuswechsel, keine Fokusfalle, keine Fokusrückgabe, Hintergrund nicht inert | `web/js/modal.js:10` | **Hoch — behoben** |
| **U2** | `<label>` und Eingabefeld sind Geschwister ohne `for`/`id` — jedes Formularfeld der Anwendung ist für Screenreader unbeschriftet, Labelklick fokussiert nicht | `web/js/forms.js:11` | Mittel — behoben |
| **U3** | `<html lang>` bleibt fest `"de"`, auch auf Englisch | `web/index.html:2`, `demo.html:2`, `admin/index.html:2`; `web/js/i18n.js:38` | Mittel — behoben |
| **U4** | Ein 429 auf `/auth/refresh` endet als **stiller Logout** — ununterscheidbar von „Sitzung abgelaufen" | `web/js/apiClient.js:160-167`, `web/js/state.js:52-56` | Mittel |
| **U5** | Service Worker: `skipWaiting()`/`clients.claim()` erreichen ihren Zweck nicht (die laufende Sitzung behält ihren Code), und es gibt keinen Hinweis „neue Version verfügbar" — eine über Stunden offene PWA bleibt beliebig lange veraltet | `web/sw.js:89,96-97` | Niedrig |

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

### E4 — Ein Schreibvorgang je Login (Niedrig)

Das `UPDATE users` aus **S1** läuft bei jeder Anmeldung, auch wenn sich
weder Version noch Sachlage geändert haben. Der unter S1 empfohlene
Abgleich (`nur stempeln, wenn abweichend`) beseitigt ihn als Nebenwirkung.

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
4. **S2** + **U4** — gemeinsam anzufassen: die Ursache und ihre sichtbare
   Folge.
5. **E1**, **E2** — messbar auf dem Raspberry-Pi-Deployment; E1 zuerst,
   da trivial.
6. **S3**, **S4**, **S5**, **E3**, **U5** — bei nächster Berührung des
   jeweiligen Bereichs.

Für jeden Befund gilt die Hausregel der bisherigen Reviews: ein
Regressionstest, der ohne die Korrektur nachweislich fehlschlägt. Für
**U1**–**U3** ist das jetzt eingelöst — `vitest` mit einer
`jsdom`-Umgebung (per `// @vitest-environment jsdom`-Pragma, nur für die
drei betroffenen Testdateien) prüft `role`, `aria-labelledby`,
`document.activeElement`, `label.htmlFor` und `documentElement.lang`
unmittelbar; U1 zusätzlich in einem echten Browser (siehe dessen
Fix-Abschnitt). Dieselbe Technik trägt auch **S1**, dort in Zod-Schema-
und Service-Tests statt in `jsdom`.
