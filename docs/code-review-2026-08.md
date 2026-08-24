# Code-Review — Lane 1 Monorepo (August 2026)

Umfang: `apps/api`, `apps/web`, `packages/*`, Build-/CI-/Deployment-Konfiguration
(ca. 19.000 Zeilen). Schwerpunkte laut Auftrag: Sicherheitslücken, Ineffizienzen,
redundanter Code, Code-Stil.

Vorbemerkung: Die Codebasis ist erkennbar bereits mehrfach reviewt worden und in
vielen Punkten überdurchschnittlich sauber — Repository-Pattern mit
In-Memory-Doubles, konsequentes `clubId`-Scoping in der Sync-Schicht, argon2id,
RS256 mit opaken Refresh-Tokens, Timing-Angleichung im Login, DSGVO-Pfade
(Art. 15/17) inkl. Tombstones, `npm audit` als blockierender CI-Schritt. Die
folgenden Befunde sind vor diesem Hintergrund zu lesen: es geht überwiegend um
Lücken *zwischen* bereits gut gebauten Teilen, nicht um grundlegende Mängel.

Schweregrade: **Hoch** = jetzt beheben, **Mittel** = einplanen, **Niedrig** =
bei nächster Berührung mitnehmen.

---

## 1. Sicherheit

### S1 — Login-Rate-Limit: `keyGenerator` liest einen Body, den es noch nicht gibt (Hoch)

`apps/api/src/modules/auth/auth.route.ts:60-71`

```ts
keyGenerator: (request) => {
  const email = (request.body as { email?: string } | undefined)?.email ?? 'unknown';
  return `${request.ip}:${email}`;
}
```

`@fastify/rate-limit` (v10) hängt sich standardmäßig in den `onRequest`-Hook.
Zu diesem Zeitpunkt ist der Request-Body noch nicht geparst — `request.body` ist
`undefined`. Der Schlüssel ist daher **immer** `"<ip>:unknown"`.

Zwei Konsequenzen, beide gegenteilig zur Absicht des Kommentars darüber:

1. Die dokumentierte Anti-Enumerations-Eigenschaft („ein Angreifer kann nicht
   durch Verteilung auf viele E-Mails den Grenzwert umgehen") existiert nicht;
   sie ist schlicht ein IP-Limit.
2. Schwerer: Es ist ein reines IP-Limit von **5 Versuchen pro Minute für das
   gesamte Netz**. Ein Verein hinter NAT (Vereinsheim-WLAN, Schul-/Bad-Netz —
   genau der im Kommentar genannte Fall, der vermieden werden sollte) sperrt
   sich nach fünf Anmeldungen pro Minute selbst aus.

Der vorhandene Test (`test/auth/auth.route.test.ts:157`) verdeckt das, weil er
alle sechs Versuche mit **derselben** E-Mail-Adresse fährt — er ist mit und ohne
funktionierenden `keyGenerator` grün.

**Fix:** Hook auf `preValidation` (oder `preHandler`) setzen, damit der Body
geparst vorliegt — global bei der Registrierung in `plugins/security.ts` oder
per Route. Zusätzlich einen Test ergänzen, der zwei verschiedene E-Mails von
derselben IP verwendet und erwartet, dass beide ihr eigenes Budget haben.

### S2 — Refresh-Token-Rotation ohne Reuse-Detection (Mittel)

`apps/api/src/modules/auth/auth.service.ts:refresh()`

Die Rotation ist korrekt implementiert (altes Token wird widerrufen), aber die
*Wiederverwendung* eines bereits widerrufenen Tokens wird nur mit
`InvalidRefreshTokenError` beantwortet. Genau dieses Ereignis ist jedoch das
einzige verlässliche Signal für einen Token-Diebstahl: Löst der Angreifer das
gestohlene Token vor dem legitimen Gerät ein, behält er über die Rotationskette
dauerhaften Zugang, und der Fehlschlag landet beim rechtmäßigen Nutzer, wo er wie
ein normaler Sitzungsablauf aussieht.

**Fix:** Trifft `findByHash()` ein Token mit gesetztem `revokedAt`, alle Tokens
dieses Nutzers widerrufen (`revokeAllForUser()` existiert bereits) und den
Vorfall loggen. Kostet ~3 Zeilen.

### S3 — Frontend: keine CSP, Refresh-Token in `localStorage` (Mittel)

`apps/web/index.html`, `apps/web/admin/index.html`, `apps/web/demo.html`
enthalten **keinen** `Content-Security-Policy`-Header und kein entsprechendes
`<meta>`.

Das ist die auffälligste Asymmetrie im Projekt: `plugins/security.ts` legt eine
maximal restriktive `default-src 'none'`-Policy über eine API, die
ausschließlich JSON ausliefert (also nie in einem Browser-Rendering-Kontext
landet), während die tatsächliche HTML-Anwendung — die das Refresh-Token in
`localStorage` hält, `innerHTML` an mehreren Stellen benutzt und einen
generischen `html:`-Eingang im DOM-Builder anbietet — ganz ohne Policy
ausgeliefert wird. Der Kommentar in `security.ts` verweist darauf, `apps/web`
bekomme „seine eigene, für sein Markup passende CSP" vom eigenen Hosting; im
Repository findet sich davon nichts (weder in `docs/deployment*.md` als
Nginx-Konfiguration noch als `<meta>`).

Der Blast-Radius eines XSS ist dadurch maximal: dauerhafte Sitzungsübernahme
über das persistierte Refresh-Token, nicht nur ein flüchtiger Zugriff.

**Fix:** CSP für das Frontend definieren (`default-src 'self'`, `script-src
'self'`, `connect-src 'self' <api-origin>`, `object-src 'none'`,
`base-uri 'none'`, `frame-ancestors 'none'`) und im Deployment-Dokument als
Reverse-Proxy-Header verankern.

### S4 — Client-Refresh ohne Single-Flight → unerwartete Abmeldungen (Mittel)

`apps/web/js/apiClient.js:request()`

Läuft der Access-Token ab, während mehrere Requests parallel unterwegs sind
(der Regelfall: `runSync()` → push + pull, `userManagement.render()` →
`Promise.all` über drei Endpunkte), schlagen alle mit 401 fehl und rufen jeweils
`refreshTokens()` auf. Serverseitig rotiert der erste Aufruf das Token; alle
weiteren schicken dann ein bereits widerrufenes Token, scheitern und lösen
`clearTokens()` aus — die Sitzung wird verworfen, obwohl sie gültig war.

**Fix:** Single-Flight — eine modulweite `let refreshInFlight = null;`, die alle
gleichzeitigen Aufrufer auf dieselbe Promise warten lässt.

Wird S2 umgesetzt, wird dieser Punkt von „lästig" zu „kritisch": die zweite,
mit dem alten Token ankommende Anfrage sähe dann wie ein Diebstahl aus und würde
alle Sitzungen des Nutzers widerrufen. **S3/S4 müssen zusammen mit S2 behoben
werden.**

### S5 — `PrismaUserRepository.update()` ohne `deletedAt`-Filter (Niedrig)

`apps/api/src/modules/auth/auth.repository.ts`

`findByEmail()` und `findById()` filtern bewusst und dokumentiert auf
`deletedAt: null`; `update()` tut es nicht (`where: { id }`). Heute nicht
ausnutzbar, weil jeder Aufrufer vorher über `findById()` geht — aber die
Invariante steht nur im Kommentar, nicht im Code. Ein `updateMany` mit
`{ id, deletedAt: null }` schließt die Lücke strukturell.

### S6 — `/admin`: Nicht-Superadmin behält gültiges Refresh-Token (Niedrig)

`apps/web/admin/admin.js:handleAuthenticated()`

Bei `user.role !== 'superadmin'` wird nur `api.clearTokens()` (lokal) aufgerufen,
nicht `api.logoutRemote()`. Das Refresh-Token bleibt serverseitig bis zum Ablauf
(Default 30 Tage) gültig. Da der Login gerade erst *erfolgreich* war, ist das
kein Rechteproblem — aber es widerspricht dem sonst konsequenten Muster
„abmelden heißt serverseitig widerrufen".

### S7 — Zod: Strings begrenzt, Arrays unbegrenzt (Niedrig)

`packages/shared-types/src/entities.ts`

Der Dateikopf beschreibt die Härtung ausführlich: „jedes freie Textfeld trägt
jetzt ein `.max(...)`". Die Array-Felder blieben dabei außen vor —
`tags`, `equipment`, `comments`, `laps`, `attendance`, `days`, `sets` haben keine
`.max()`-Längenbegrenzung. Ein einzelner Datensatz mit 20.000 Kommentaren passt
in das 1-MB-Bodylimit und wird dauerhaft gespeichert; `sessions.attendance` wird
zudem bei jedem Purge-Lauf und bei jedem Athleten-Pull vollständig durchlaufen.

Inkonsistent zur erklärten Absicht — die Grenzen gehören dorthin, wo die
Textgrenzen schon stehen.

### S8 — `escapeHtml()` im Mailer escaped keine einfachen Anführungszeichen (Niedrig)

`apps/api/src/mail/mailer.ts`

`&`, `<`, `>`, `"` werden ersetzt, `'` nicht. Aktuell ungefährlich, weil alle
Attribute in `buildHtmlBody()` doppelt gequotet sind — aber das ist eine
Eigenschaft des Aufrufers, nicht der Funktion. Dieselbe Lücke hat `esc()` in
`apps/web/js/utils.js`. Beide sollten `'` mitescapen oder im Namen klarstellen,
dass sie nur für Element-Inhalte gedacht sind.

---

## 2. Korrektheit und Verfügbarkeit

### C1 — Sync-Deadlock ab 500 offenen Events (Hoch)

`apps/web/js/syncClient.js:push()` gegen
`packages/shared-types/src/syncEvent.ts:SyncPushRequestSchema`

`push()` sendet **die gesamte** Warteschlange in einem Request:

```js
const toSend = queue.filter(e => e.status === 'pending' || e.status === 'error');
const events = toSend.map(...);
const { results } = await api.syncPush(events);
```

Serverseitig gilt `events: z.array(SyncEventSchema).min(1).max(500)`, und
`sync.route.ts` weist den **gesamten Batch** mit 400 ab, wenn das Schema nicht
passt.

Ergebnis: Sobald eine Offline-Phase mehr als 500 Änderungen ansammelt (bei einem
Trainingslager mit Zeiten- und Anwesenheitserfassung realistisch), scheitert
jeder weitere Push-Versuch mit 400 — dauerhaft, denn die Warteschlange kann sich
nie unter 500 abbauen. Der Hintergrund-Sync loggt den Fehler alle 60 Sekunden
stumm weg (`app.js:backgroundSync()` fängt und `console.warn`t nur). Meldet sich
die Person dann ab, ruft `logout()` → `wipeAll()` auf und **die ausstehenden
Änderungen sind verloren**. Der Schutz in `handleLogoutClick()` greift nicht: er
warnt zwar, dass noch etwas aussteht, aber sein `runSync()`-Versuch scheitert am
selben 400.

**Fix:** In `push()` in Blöcken zu z. B. 200 Events senden (die Schleife über
`results` ist bereits blockfähig). Der Server ist damit unverändert nutzbar.

### C2 — Fehlerhafte Events werden unbegrenzt wiederholt (Hoch)

`apps/web/js/syncClient.js:push()`

Der Filter nimmt `status === 'pending' || status === 'error'`. Ein Event, das
serverseitig dauerhaft scheitert (unbekannter Store, verletzter Fremdschlüssel,
gelöschte Referenz), bekommt `status: 'error'` und wird bei **jedem** der
60-Sekunden-Zyklen erneut mitgeschickt — für immer. `attempts` wird zwar
hochgezählt, aber nirgends ausgewertet.

Das erzeugt nicht nur Dauer-Traffic, es ist auch der Motor hinter C1: die
Warteschlange schrumpft nie unter ihren Fehlerbestand.

Ein konkreter Erzeuger solcher Dauer-Fehler steckt in `profile.js` (siehe R2):
`remove('users', …)` reiht ein Event für den Store `users` ein, für den es
serverseitig weder ein `ENTITY_SCHEMAS`- noch ein `STORE_PERMISSIONS`-Eintrag
gibt — es kann per Definition nie erfolgreich werden.

**Fix:** Nach n Versuchen (z. B. 5) auf einen Endzustand `failed` setzen, aus dem
Push-Filter nehmen und in der Sync-Warteschlangen-Ansicht sichtbar machen — die
UI hat dort bereits einen „Erneut versuchen"-Button, der genau dafür da wäre.

### C3 — `push()` ist nicht transaktional (Mittel)

`apps/api/src/modules/sync/sync.service.ts`

Schreibvorgang und Idempotenz-Vermerk sind zwei getrennte Aufrufe:

```ts
await deps.gateway.create(store, validatedPayload);
await deps.gateway.markEventProcessed(event.id, requester.clubId, store, event.action);
```

Bricht der Prozess dazwischen ab (Deploy, OOM, Verbindungsabbruch zur DB), wird
das Event beim Retry erneut angewendet. Für `create`/`update` ist das dank
`last-write-wins` meist folgenlos — nicht aber für den `insert-as-new`-Zweig:
dort wird ein **zweiter** Datensatz mit einer neuen `randomUUID()` erzeugt. Genau
der Fall, für den der Idempotenz-Ledger gebaut wurde.

Nebenbefund: `isEventProcessed()` → `markEventProcessed()` ist auch ein
Check-then-Act ohne Sperre; zwei parallele Pushes desselben Events (der
Retry-Fall, den der Ledger adressiert) laufen beide durch.

**Fix:** Beides in eine `prisma.$transaction` klammern und den Unique-Constraint
auf `SyncedEvent.id` als Konflikterkennung nutzen (P2002 → als bereits
verarbeitet werten), statt sich auf das vorherige `findFirst` zu verlassen.

### C4 — DSGVO-Hard-Purge kann am Transaktions-Timeout scheitern (Mittel)

`apps/api/src/jobs/erasure.repository.ts:purgeUserAndDependents()`

Innerhalb einer interaktiven Prisma-Transaktion werden **alle**
Trainingseinheiten des Vereins geladen und einzeln aktualisiert:

```ts
const sessions = user.clubId ? await tx.trainingSession.findMany({ where: { clubId: user.clubId } }) : [];
for (const session of sessions) { … await tx.trainingSession.update(…) }
```

Interaktive Transaktionen haben in Prisma ein Standard-Timeout von 5 Sekunden.
Ein Verein mit einigen Jahren Trainingshistorie (mehrere Tausend Einheiten,
jeweils ein JSON-Array-Rewrite) reißt das. Da `purgeExpiredDeletions()` den
Fehlschlag nur protokolliert und die Anfrage auf `pending` lässt, wiederholt sich
das bei jedem Cron-Lauf — die Löschung wird **nie** vollzogen, während die App
nach außen (Antwort auf `DELETE /api/me`) ein konkretes Purge-Datum zugesagt hat.
Das ist ein Compliance-Risiko, kein reines Performanceproblem.

Dieselbe Vollabfrage steht ohne Transaktion auch in
`profile.repository.ts:exportUserData()`.

**Fix:** Die Attendance-Bereinigung außerhalb der Transaktion in Batches fahren
(oder per SQL-`jsonb`-Update in einem Statement), und die Sessions über
`groupId`/Zeitraum eingrenzen statt clubweit zu laden. Mindestens `timeout` und
`maxWait` der Transaktion explizit hochsetzen.

### C5 — `pull()`-Schleife ohne Abbruchsicherung (Niedrig)

`apps/web/js/syncClient.js:pull()`

```js
while (hasMore) { … cursor = response.nextCursor; hasMore = response.hasMore; if (cursor) await setCursor(cursor); }
```

Liefert der Server jemals `hasMore: true` zusammen mit `nextCursor: null`, wird
`cursor` auf `null` gesetzt und die Schleife zieht endlos den kompletten
Vereinsbestand. Serverseitig ist dieser Zustand heute ausgeschlossen (`page` ist
nach `splitAtSafeTimestampBoundary()` bzw. dem Tie-Zweig nie leer, solange `rows`
nicht leer war) — aber der Client verlässt sich auf eine Invariante des Servers,
die er nicht prüft. Eine Iterationsobergrenze und ein `break` bei fehlendem
Cursor kosten zwei Zeilen.

### C6 — `t()` interpretiert `$&` in eingesetzten Werten (Niedrig)

`apps/web/js/i18n.js`

```js
str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
```

Bei `String.prototype.replace` mit einem *String* als Ersetzung sind `$&`, `` $` ``,
`$'` und `$1` Sonderzeichen. Ein Athletenname oder Vereinsname, der `$&` enthält,
wird falsch gerendert. Fix: Ersetzungs-*Funktion* verwenden (`() => v`).

---

## 3. Ineffizienzen

### P1 — RSA-Schlüsselimport bei jedem Sign/Verify

`apps/api/src/auth/tokens.ts`

`importPKCS8()` bzw. `importSPKI()` läuft in `signAccessToken()` und
`verifyAccessToken()` bei **jedem Aufruf** neu — also bei jedem einzelnen
authentifizierten Request (`plugins/authenticate.ts`). Das PEM-Parsing und die
Schlüsselkonstruktion sind pro Request messbar und komplett vermeidbar: das
Schlüsselpaar ist prozessweit konstant (`resolveKeyPair()` cacht es bereits).

**Fix:** Die importierten `KeyLike`-Objekte einmal (lazy, in einer `Map` über den
PEM-String) cachen.

### P2 — Pull-Query holt 11× so viele Zeilen wie nötig

`apps/api/src/modules/sync/sync.gateway.ts:listChangedSince()`

`take: limit` wird auf **jeden** der zehn Stores *und* auf die Tombstones
angewendet; anschließend wird die zusammengeführte Liste sortiert und auf `limit`
gekürzt. Für den Normalfall (`limit = 201`) heißt das: bis zu 2.211 Zeilen aus der
Datenbank, von denen ~91 % verworfen werden — bei jedem Sync-Zyklus jedes
Gerätes, alle 60 Sekunden.

Im Tie-Sonderfall (`PULL_TIE_SAFETY_LIMIT = 5000`) sind es bis zu 55.000 Zeilen
inklusive vollständiger Payloads in einem Prozess-Heap.

**Fix:** Eine `UNION ALL`-Abfrage über die Stores mit gemeinsamem
`ORDER BY updatedAt LIMIT n` (Prisma: `$queryRaw`), oder pragmatisch die
Zeitfenster-Grenze aus einer ersten, schlanken Abfrage (nur `updatedAt`)
bestimmen und erst dann die Payloads laden.

### P3 — Vereinsweite Vollabfragen für Einzelpersonen-Daten

`profile.repository.ts:exportUserData()` und `erasure.repository.ts` (siehe C4)
laden beide `trainingSession.findMany({ where: { clubId } })` — *alle*
Trainingseinheiten des Vereins — um daraus die Anwesenheitszeilen **einer**
Person herauszufiltern. Bei Postgres wäre das ein einzelnes
`jsonb`-Filter-Statement.

### P4 — Neuer SMTP-Transport pro E-Mail, nie geschlossen

`apps/api/src/mail/mailer.ts:SmtpMailSender.sendInvitationEmail()`

`nodemailer.createTransport()` wird bei jedem Versand neu aufgerufen (samt
dynamischem `import`), und `transport.close()` fehlt. Jede Einladung baut also
eine eigene SMTP-Verbindung auf, die anschließend offen im Verbindungspool des
Prozesses verbleibt. Der Transport ist zustandslos konfiguriert — er gehört
einmal in den Konstruktor, idealerweise mit `pool: true`.

### P5 — IndexedDB ohne Indizes, `getAll()` als einziges Zugriffsmuster

`apps/web/js/db.js`

Jeder Store wird mit `createObjectStore(name, { keyPath: 'id' })` und **ohne einen
einzigen Index** angelegt. Sämtliche Filterung passiert in JavaScript nach einem
vollständigen `getAll()`. Konkrete Auswirkungen:

- `countAll()` lädt alle Datensätze, nur um `.length` zurückzugeben —
  IndexedDB hat dafür `objectStore.count()`.
- `pendingSyncCount()` lädt die **komplette** Sync-Warteschlange (inklusive aller
  `payload`-Blobs), um die nicht-synchronisierten zu zählen. Diese Funktion läuft
  nach jedem Render, nach jedem Sync-Zyklus und beim Logout.
- `clearSyncedEvents()` öffnet pro gelöschtem Event eine eigene
  Read-Write-Transaktion.

Ein Index auf `syncQueue.status` und die Nutzung von `count()` würde den
häufigsten Pfad der App billig machen.

### P6 — `O(n²)` in der Push-Ergebnisverarbeitung

`apps/web/js/syncClient.js:push()` — `toSend.find(e => e.id === result.eventId)`
innerhalb der Schleife über `results`. Bei 500 Events sind das 250.000
Vergleiche. Eine `Map` vorab kostet eine Zeile.

### P7 — Import der Übungsbibliothek: zwei IDB-Transaktionen pro Datensatz

`apps/web/js/modules/libraryTransfer.js:importLibrary()` ruft `put()` sequenziell
pro Übung und pro Vorlage auf. Jedes `put()` öffnet eine eigene Transaktion —
**und** legt via `enqueueSyncEvent()` ein weiteres `put()` (also eine weitere
Transaktion) an. Ein Bundle mit 200 Übungen erzeugt 400 Transaktionen. `bulkPut()`
existiert bereits im selben Modul; der Sync-Enqueue könnte gesammelt erfolgen.

### P8 — Regex-Kompilierung im Übersetzungs-Hotpath

`apps/web/js/i18n.js:t()` erzeugt pro Variable und pro Aufruf ein neues
`RegExp`-Objekt. `t()` ist die meistgerufene Funktion der Anwendung (jedes Label,
jedes Render). Ein Cache oder eine einzelne `/\{(\w+)\}/g`-Ersetzung mit
Lookup-Funktion erledigt das in einem Durchlauf.

---

## 4. Redundanter Code

### R1 — `app.js` und `app-demo.js`: ~130 Zeilen Duplikat

Byte-identisch in beiden Dateien:

| Element | Zeilen |
|---|---|
| `GROUP_ICON_TRAINING/_PERFORMANCE/_TEAM/_ADMIN` | 4 (lange SVG-Literale) |
| `NAV_GROUPS`, `MOBILE_DIRECT_GROUPS`, `MORE_ICON` | ~12 |
| `sideNavItem()` | 6 |
| `bottomNavItem()` | 7 |
| `openMoreNav()` | 19 |
| `updateSyncBadge()` | 7 |
| `markActive()` | 7 |
| `populateLanguageSelect()` | 9 |

Zusätzlich sind `buildNav()`, `render()`, `defaultModuleFor()` und `exportData()`
bis auf wenige Zeilen gleich. Jede Änderung an der Navigation muss heute an zwei
Stellen nachgezogen werden — die Icon-Literale sind dafür ein besonders
unangenehmes Ziel.

**Fix:** Ein `js/shell.js` mit den geteilten Nav-/Render-Bausteinen; `app.js` und
`app-demo.js` behalten nur ihre tatsächlichen Unterschiede (Session-Boot vs.
Demo-Konten-Umschalter, Hintergrund-Sync vs. keiner).

### R2 — `eraseMyAccountAndData()` ist vollständig überflüssig — und schädlich

`apps/web/js/modules/profile.js:233-253`

Die Funktion räumt den lokalen Cache Datensatz für Datensatz auf. Drei Zeilen
später im Aufrufer steht:

```js
await eraseMyAccountAndData(user, athletes);
…
await logout();          // → state.js: logout() ruft wipeAll() auf
```

`wipeAll()` leert **alle** Stores. Die gesamte vorherige Arbeit ist damit
wirkungslos.

Schlimmer als nur überflüssig: Sie benutzt die *sync-erzeugenden* Varianten
`remove()`/`put()` statt `removeWithoutSync()`/`putWithoutSync()`. Für ein Konto,
das serverseitig soeben soft-gelöscht und dessen Refresh-Tokens widerrufen
wurden, werden also noch dutzende Sync-Events erzeugt — darunter
`remove('users', user.id)`, ein Event für einen Store, den die Sync-API gar nicht
kennt (siehe C2). Sie werden anschließend von `wipeAll()` mitgelöscht, aber der
Pfad ist eine offene Falle, sobald jemand die Reihenfolge ändert.

**Fix:** Ersatzlos streichen und sich auf `logout()` verlassen.

### R3 — Doppelte Sync-Validierung mit unerreichbarem Fehlerpfad

`sync.route.ts` validiert den gesamten Batch gegen `SyncPushRequestSchema` und
antwortet bei Verstoß mit einer 400 für **alle** Events. `sync.service.ts`
validiert danach jedes Event nochmals einzeln:

```ts
const parsedEvent = SyncEventSchema.safeParse(rawEvent);
if (!parsedEvent.success) {
  results.push({ eventId: …, status: 'error', message: 'Event-Struktur ungültig.' });
  continue;
}
```

Über HTTP ist dieser Zweig nicht erreichbar. Er suggeriert eine
Fehlertoleranz („ein kaputtes Event betrifft nur dieses Event"), die die Route
gerade nicht bietet — und die für C1 den entscheidenden Unterschied machen würde.

**Entweder** die Route auf `z.array(z.unknown())` lockern und die
Per-Event-Prüfung im Service wirklich greifen lassen (das wäre die robustere
Variante, und sie entschärft C1 deutlich), **oder** die tote Prüfung im Service
entfernen.

### R4 — `consentField`: wirkungsloses `.refine()`

`packages/shared-types/src/auth.ts`

```ts
z.literal(true).refine((v) => v === true, { message: … })
```

`z.literal(true)` lässt nur `true` durch; das `refine` kann nie fehlschlagen und
seine Fehlermeldung nie erscheinen. Wenn die deutsche Meldung gewünscht ist,
gehört sie als `errorMap`/`message` an `z.literal()`.

### R5/R6 — Toter Export, tote Zustandsvariable

- `esc()` in `apps/web/js/utils.js` ist exportiert, wird aber außerhalb der
  Datei nirgends verwendet (nur intern von den beiden SVG-Chart-Buildern).
- `accessTokenExpiresAt` in `apps/web/js/apiClient.js` wird an zwei Stellen
  *geschrieben* und an **keiner** gelesen. `hasAccessToken()` prüft nur, ob ein
  Token existiert, nicht ob es noch gültig ist. Das ist eine angefangene, nie
  fertiggestellte proaktive Refresh-Logik — entweder nutzen (Token kurz vor
  Ablauf erneuern, statt auf den 401 zu warten; das würde S4 zusätzlich
  entschärfen) oder entfernen.

### R7 — Vier fast identische Token-Funktionen

`apps/api/src/auth/tokens.ts` — `generateRefreshToken`/`generateInvitationToken`
und `hashRefreshToken`/`hashInvitationToken` unterscheiden sich ausschließlich in
der Byte-Länge (48 vs. 32). Die Begründung im Kommentar („die TTL ist hier in
Tagen deutlich kürzer") trägt nicht, denn die TTL ist in beiden Fällen ein
Parameter. Eine Funktion `generateOpaqueToken(bytes, ttlDays)` plus ein
`hashOpaqueToken()` deckt beides ab; die semantische Unterscheidung lässt sich
über Typ-Aliase erhalten.

### R8 — `DataDeletionRequest.status = 'purged'` wird nie gesetzt

Der Purge löscht den `User`, und der `DataDeletionRequest` verschwindet per
`onDelete: Cascade` mit. Der Zustand `'purged'` ist damit unerreichbar — im
Prisma-Schema, im `ErasureRequestRecord`-Typ und im
`DataDeletionRequestSchema` (`z.enum(['pending','purged'])`). Ebenso `purgedAt`.
Entweder den Request als Nachweis behalten (dann Cascade lösen und `status`
tatsächlich setzen — für die DSGVO-Rechenschaftspflicht durchaus sinnvoll) oder
beide Felder streichen.

### R9 — „Existiert der Übersetzungsschlüssel?" per Doppelaufruf

`apps/web/js/modules/syncQueue.js`

```js
const label = t(`syncqueue.${ENTITY_KEYS[evt.store] || ''}`) !== `syncqueue.${ENTITY_KEYS[evt.store] || ''}`
  ? t(`syncqueue.${ENTITY_KEYS[evt.store]}`) : evt.store;
```

Dreifacher `t()`-Aufruf und zweimaliger Aufbau desselben Schlüssels in einem
Ausdruck, um die Fallback-Eigenschaft von `t()` (gibt bei fehlendem Key den Key
zurück) zu invertieren. Dieselbe Konstruktion steht drei Zeilen tiefer nochmal
für `ACTION_KEYS`. Eine `tOr(key, fallback)`-Hilfsfunktion in `i18n.js` macht
daraus einen lesbaren Aufruf.

---

## 5. Code-Stil und Wartbarkeit

### W1 — Kommentare als Änderungsprotokoll statt als Erklärung

Das auffälligste Stilmerkmal der Codebasis, und der Punkt mit dem größten
Hebel:

| Datei | Kommentarzeilen |
|---|---|
| `config/env.ts` | 50 / 99 (**50 %**) |
| `modules/sync/sync.service.ts` | 338 / 680 (**49 %**) |
| `plugins/security.ts` | 40 / 84 (**47 %**) |
| `modules/sync/sync.gateway.ts` | 71 / 192 (**36 %**) |

Ein Teil davon ist wertvoll (das „Warum" hinter `SMTP_SECURE` als `z.enum` statt
`z.coerce.boolean()` etwa ist genau die Art Kommentar, die man will). Der
größere Teil ist jedoch **Historie**: „Sicherheitskorrektur (Code-Review,
kritischer Befund 3)", „vormals `since ? 'update' : 'create'`", „Aufräumarbeit
(Code-Review)", „siehe Änderungsprotokoll", „Befund 12", „die beiden Prüfungen
waren bereits einmal auseinandergelaufen".

Diese Informationen gehören in Commit-Messages und PR-Beschreibungen. Im
Quelltext haben sie drei Kosten:

1. Sie veralten, ohne dass es jemand merkt — es gibt keinen Test, der prüft, ob
   „vormals X" noch stimmt.
2. Der tatsächliche Ablauf von `sync.service.ts:push()` ist über ~340 Zeilen
   Prosa verteilt; die Funktion selbst ist deutlich einfacher, als sie beim Lesen
   wirkt.
3. Sie erzeugen den Eindruck, jede Zeile sei ein hart erkämpfter Sonderfall, was
   Refactoring psychologisch blockiert.

**Empfehlung:** Kommentare auf „warum ist das so, obwohl es anders naheliegender
wäre" reduzieren; alles mit „vormals", „Befund N", „Code-Review" in die
Git-Historie verschieben. Das Dokument `docs/backend-plan.md` ist bereits der
richtige Ort für Design-Begründungen.

### W2 — Uneinheitliche Sprache

Innerhalb einzelner Dateien wird zwischen Deutsch und Englisch gewechselt
(`utils.js`: englische Abschnittsüberschriften, deutsche Fließtexte; `db.js`,
`state.js` ebenso). In `sync.service.ts` sind zudem Bezeichner deutsch
(`geteilt`, `coachVerwaltet`, `adminVerwaltet`) inmitten einer sonst
durchgängig englischen Codebasis — `STORE_PERMISSIONS`, `canRead`, `canWrite`
stehen direkt daneben.

Eine Konvention festlegen (naheliegend: Bezeichner englisch, Kommentare und
nutzersichtbare Texte deutsch) und durchziehen.

### W3 — `apps/web` wird nie gelintet

`apps/web/package.json` hat kein `lint`-Script. Der CI-Schritt
`npm run lint --workspaces --if-present` überspringt das Paket dadurch
**stillschweigend** — ~5.000 Zeilen Frontend-JavaScript, also die größte
Einzelkomponente und der gesamte browserseitige Angriffsvektor, laufen ohne jede
statische Prüfung. Einige der oben genannten Befunde (R5, R6, ungenutzte Importe)
hätte `no-unused-vars` gefunden.

### W4 — ESLint 8 (End-of-Life) mit Legacy-Konfiguration

`package.json` pinnt `eslint: ^8.57.1`. ESLint 8 erhält seit Oktober 2024 keine
Updates mehr — für ein Dev-Tool weniger dramatisch als für eine
Laufzeitabhängigkeit, aber der CI-Schritt „Abhängigkeits-Audit" bringt für
Dev-Deps ohnehin nur `continue-on-error`.

Nebenbei: `packages/shared-config/eslint-preset.cjs` schreibt „Ein Paket/App
bindet dies in der eigenen `eslint.config.js` ein" — eine solche Datei existiert
in keinem Workspace; tatsächlich lädt ausschließlich die Root-`.eslintrc.cjs`
das Preset. Der Kommentar beschreibt eine Struktur, die es nicht gibt.

### W5 — Keine versionierte Migrationshistorie

`.gitignore` enthält `/apps/api/prisma/migrations/`. Sowohl CI als auch das
Deployment (`docs/deployment.md`, Abschnitt 7.3, im CI-Kommentar zitiert) nutzen
deshalb `prisma db push`.

Für ein Hobby-Projekt vertretbar; für ein mandantenfähiges System mit
personenbezogenen Daten von Minderjährigen ist es der riskanteste
Einzelbefund dieses Reviews:

- Schemaänderungen sind nicht reviewbar (sie tauchen im PR nur als
  `schema.prisma`-Diff auf, nicht als das, was die Datenbank tatsächlich tun
  wird).
- Es gibt keinen Rollback-Pfad.
- `db push` verwirft bei inkompatiblen Spaltenänderungen Daten — mit einer
  interaktiven Warnung, die in einem nicht-interaktiven Deploy niemand sieht.
- Zwei Umgebungen (Staging/Produktion) können unbemerkt auseinanderlaufen.

**Empfehlung:** Auf `prisma migrate` umstellen, `migrations/` committen, im
Deployment `migrate deploy` verwenden.

### W6 — `docker-compose.yml` setzt eine Variable, die es nicht gibt

```yaml
JWT_SIGNING_KEY: "local-dev-only-key-not-for-production-use-12345"
```

`config/env.ts` kennt diese Variable nicht — sie ist ein Überbleibsel aus einer
früheren, symmetrischen (HS256-)Signaturvariante. Sie hat keine Wirkung, sieht
aber so aus, als wäre die Schlüsselversorgung geregelt; tatsächlich greift der
Wegwerf-Schlüssel aus `auth/keys.ts`. Umgekehrt fehlen `FRONTEND_BASE_URL` und
die `SMTP_*`-Variablen, sodass Einladungslinks im Docker-Setup auf
`http://localhost:5173` zeigen, obwohl die API auf 3000 läuft.

### W7 — Dockerfile

`apps/api/Dockerfile`:

- `npm install --workspaces` statt `npm ci` — der Lockfile wird ignoriert, der
  Build ist nicht reproduzierbar. (Die CI nutzt korrekt `npm ci`; das Image
  nicht.)
- `COPY --from=build /repo/node_modules ./node_modules_root` — Node sucht
  Module niemals in einem Verzeichnis dieses Namens. Der Layer ist reiner
  Ballast (mehrere hundert MB), und falls er ein echtes Problem lösen sollte
  (gehobene Workspace-Abhängigkeiten), löst er es nicht.
- Das Runtime-Image erbt `apps/api/node_modules` **inklusive** `devDependencies`
  (prisma-CLI, tsx, typescript, vitest) — entgegen dem Kommentar „Laufzeit-Image
  enthält nur das Nötigste".
- Kein `USER node`: der Container läuft als root.

### W8 — Service Worker: handgepflegte Precache-Liste, all-or-nothing

`apps/web/sw.js`

`PRECACHE_URLS` listet jede einzelne Moduldatei einzeln auf und muss bei jeder
neuen Datei zusammen mit `CACHE_VERSION` (aktuell `lane1-v26`) manuell
nachgezogen werden. `cache.addAll()` ist atomar: **eine** nicht auflösbare URL
lässt die gesamte Installation scheitern — und damit die komplette
Offline-Fähigkeit, die das zentrale Produktversprechen dieser App ist.

Bereits jetzt unvollständig: `demo.html`, `js/app-demo.js`, `js/demoSeed.js`
sowie die in `manifest.json` referenzierten `icons/icon-192.png`,
`icons/icon-512.png`, `icons/icon-maskable.png` fehlen.

Ebenfalls fragil: die Pfadprüfungen `url.pathname.startsWith('/admin')` und
`'/api/'` sind absolut. Unter GitHub Pages (siehe `.github/workflows/static.yml`)
läuft die App in einem Unterpfad — dort greifen beide nicht.

### W9 — Hartcodierte Locale trotz vorhandener i18n

- `apps/web/admin/admin.js`: `new Date(club.createdAt).toLocaleDateString('de-DE')`
- `apps/web/js/modules/profile.js`: `new Date(result.purgeAfter).toLocaleDateString('de-DE')`
- `apps/api/src/mail/mailer.ts`: Datum immer `'de-DE'`, Rollenlabel nur deutsch
  (`ROLE_LABEL_DE`) — obwohl `User.locale` existiert und `en-US` eine
  unterstützte Sprache ist. Eine englischsprachige Person bekommt eine rein
  deutsche Einladungsmail.

`getLocale()` steht in beiden Frontend-Fällen bereits importierbar bereit.

### W10 — `preview()` nutzt `this` in einem Factory-Objekt

`apps/api/src/modules/invitations/invitations.service.ts`

```ts
async preview(plainToken: string) {
  const invitation = await this.findValidByToken(plainToken);
```

Alle anderen Methoden des zurückgegebenen Objekts greifen über `deps.` zu; nur
hier hängt die Korrektheit an der `this`-Bindung. `const { preview } = service;`
oder eine Weitergabe der Methode als Callback bricht das stumm. Die Funktion
lässt sich trivial vor das `return`-Objekt ziehen und von beiden Stellen
aufrufen.

### W11 — `innerHTML`-Hintertüren im DOM-Builder

`apps/web/js/utils.js:el()` unterstützt ein `html:`-Attribut, das direkt auf
`node.innerHTML` schreibt; `app.js`/`app-demo.js` setzen den Ladezustand per
`viewEl.innerHTML = \`<div class="empty-state">${t('common.loading')}</div>\``.

Beides ist heute ungefährlich (nur Konstanten und Übersetzungsstrings), aber es
sind Sinks, die bei jedem künftigen Review neu geprüft werden müssen — in einer
Datei, die ansonsten vorbildlich mit `createTextNode`/`textContent` arbeitet.
Für die SVG-Icons wäre ein eigener, klar benannter `icon(svgString)`-Helfer
ehrlicher als ein generisches `html`-Attribut; der Ladezustand gehört nach `el()`.

### W12 — Inkonsistente Action-Versionen in den Workflows

`ci.yml` nutzt `actions/checkout@v7` und `actions/setup-node@v7`,
`static.yml` `actions/checkout@v4`, `configure-pages@v5`, `deploy-pages@v5`.
Beide Workflows im selben Repository sollten dieselben Action-Versionen
verwenden; die Versionsstände bitte gegen die aktuell veröffentlichten Tags
prüfen.

---

## 6. Was gut ist

Der Vollständigkeit halber, weil es das Bild sonst verzerrt:

- Das `clubId`-Scoping in `sync.gateway.ts` ist konsequent bis in die
  `where`-Klauseln durchgezogen (`update`/`softDelete` mit Pflicht-`clubId`), und
  `findById()` behandelt fremde Vereine als „nicht vorhanden" — genau richtig
  gegen Existenz-Orakel.
- `STORE_PERMISSIONS` als Whitelist mit `Record<EntityStoreName, …>` erzwingt zur
  Compile-Zeit einen Eintrag pro Store. Eine neue Rolle hat automatisch nirgends
  Zugriff. Das ist die richtige Default-Richtung.
- `assertForeignKeysWithinClub()` inklusive der rekursiven `exerciseId`-Sammlung
  aus verschachtelten Set-Blöcken deckt einen Angriffspfad ab, den die meisten
  Implementierungen übersehen.
- Die Timing-Angleichung im Login gegen einen festen Dummy-Hash ist korrekt
  umgesetzt (gleiche Kostenparameter).
- `splitAtSafeTimestampBoundary()` als reine, exportierte, direkt testbare
  Funktion — das Zeitstempel-Kollisionsproblem bei Cursor-Pagination wird oft
  gar nicht erkannt.
- `npm audit --omit=dev --audit-level=high` als blockierender Schritt mit
  begründetem Schwellenwert, plus ein separater, informativer Dev-Lauf.
- Die Trennung `buildApp()` / `index.ts` mit `.inject()`-basierten Routentests
  und die zusätzliche Integrationssuite gegen echtes Postgres.

---

## 7. Vorgeschlagene Reihenfolge

1. **C1** (Sync-Chunking) und **C2** (Fehler-Backoff) — echter Datenverlust,
   kleiner Fix.
2. **S1** (Rate-Limit-Hook) — Selbst-Aussperrung im Regelbetrieb, drei Zeilen.
3. **S2 + S4 gemeinsam** (Reuse-Detection *und* Single-Flight-Refresh) — nur
   zusammen sicher.
4. **W5** (Migrationshistorie) — bevor das Schema in Produktion weiter wächst.
5. **S3** (CSP fürs Frontend) — Blast-Radius des localStorage-Tokens begrenzen.
6. **C4** (Purge-Transaktion) — Compliance-Zusage einlösbar halten.
7. **P1, P2** — beide klein, beide auf dem heißesten Pfad.
8. **R1, R2, R3** — Redundanz abbauen, solange die Duplikate noch identisch sind.
9. **W1, W2, W3** — Kommentar-Diät, Sprachkonvention, Frontend-Linting.
