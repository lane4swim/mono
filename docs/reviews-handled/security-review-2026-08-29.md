# Sicherheitsreview — Lane 1 Monorepo (29. August 2026)

**Anlass.** Abschließende Prüfung vor dem kommerziellen Produktivbetrieb.
Umfang: das **gesamte** Repository, ohne thematische Vorab-Eingrenzung —
Authentifizierungs- und Einladungspfad (`apps/api/src/auth/*`,
`modules/auth/*`, `modules/invitations/*`), die generische Sync-API
(`modules/sync/*`, der eigentliche Mandantentrenner), Datenzugriff und
Persistenz (`db/*`, `prisma/schema.prisma`, `jobs/*`,
`modules/profile/*`), die HTTP-Schicht (`plugins/*`, `app.ts`,
`config/env.ts`), die Verträge in `packages/shared-types` und
`packages/sync-protocol`, das vollständige PWA-Frontend (`apps/web/js/**`,
`apps/web/admin/*`, `sw.js`) sowie Betrieb und Bereitstellung
(`docker-compose.yml`, `apps/api/Dockerfile`, `scripts/setup-codespace.sh`,
`docs/deployment*.md`, `.github/workflows/*`).

**Abgrenzung.** Eigenständige Prüfung, keine Fortschreibung von
`security-review-2026-08.md`, `-08-27.md` oder `-08-28.md`. Alle dort als
behoben markierten Befunde wurden am aktuellen Code nachvollzogen und sind
tatsächlich behoben; keiner davon ist regressiert. Die Befunde dieses
Reviews sind durchweg **neu** — sie liegen in Bereichen, die die drei
Vorreviews nicht im Fokus hatten: der **lokalen Datenhaltung des
Frontends** (H1), dem **Verbindungspool-Verhalten des Prisma-Clients**
(M1) und der **Normalisierung von E-Mail-Adressen** (M2).

**Ergebnis vorweg.** Kein Befund erlaubt eine Kontoübernahme, eine
Rechteausweitung über die API oder einen serverseitigen
Mandantendurchbruch. Die serverseitigen Kontrollen — Vereins-Scoping,
Rollen-Matrix, Fremdschlüssel-Eigentümerprüfung, Athlet:innen-Redaktion,
Idempotenz — haben der Prüfung standgehalten; siehe „Was geprüft wurde und
hielt". Der schwerwiegendste Befund (**H1**) hebelt eine dieser Kontrollen
allerdings **auf dem Endgerät** aus, ohne dass der Server etwas davon
merkt.

**Update (29. August 2026, im Anschluss an dieses Review).** Alle fünf
Befunde sind behoben — siehe die jeweiligen **Fix**-Abschnitte. H1, M1 und
M2 haben je einen eigenen Regressionstest, der ohne die Korrektur
nachweislich fehlschlägt (empirisch geprüft, siehe die jeweiligen
Fix-Abschnitte). Gesamtsuite danach: **709 Tests, alle grün**
(`apps/api` 452, `apps/web` 102, `packages/shared-types` 146,
`packages/sync-protocol` 9), `npm run lint` und `npm run typecheck` (mit
generiertem Prisma-Client) sauber.

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| H1 | Die lokale IndexedDB wird **nur bei ausdrücklichem Logout** geleert — die nächste angemeldete Person sieht den vollständigen Bestand der vorherigen, inklusive der Felder, die der Server für ihre Rolle gezielt redigiert | `apps/web/js/state.js` (`restoreSession()`, `login()`, `acceptInvitation()`, `resetPassword()`), `apps/web/js/db.js: getAll()` | Hoch — **behoben** |
| M1 | `getPrisma()` liefert in **Produktion** bei jedem Aufruf einen neuen `PrismaClient` → elf Verbindungspools, Erschöpfung von PostgreSQLs `max_connections` unter Last | `apps/api/src/db/prisma.ts: getPrisma()`, `apps/api/src/app.ts:139-182` | Mittel — **behoben** |
| M2 | E-Mail-Adressen werden nirgends normalisiert, `User.email @unique` vergleicht zeichengenau → stille Anmelde-/Reset-Sackgasse und umgehbare Duplikat-Prüfung | `packages/shared-types/src/{auth,invitation,user}.ts`, `apps/api/src/modules/auth/auth.repository.ts: findByEmail()` | Mittel — **behoben** |
| N1 | Statisch ausgelieferte Weboberfläche ohne `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy` | `docs/deployment*.md`, `scripts/setup-codespace.sh` | Niedrig — **behoben** |
| N2 | `.env` und privater RS256-Schlüssel entstehen unter der geltenden `umask` (i. d. R. weltlesbar) und werden erst danach per `chmod` verengt | `scripts/setup-codespace.sh` | Niedrig — **behoben** |
| B1 | **Beobachtung, kein Befund mit Fix:** `POST /api/me/email` übernimmt die neue Adresse ohne Bestätigung an das neue Postfach | `apps/api/src/modules/auth/auth.service.ts: changeEmail()` | siehe unten |

---

## H1 — Lokaler Datenbestand überlebt den Nutzerwechsel

**Ort.** `apps/web/js/state.js` (`restoreSession()`, `login()`,
`acceptInvitation()`, `resetPassword()`), `apps/web/js/db.js`
(`getAll()`).

**Befund.** Lane 1 ist offline-first: `syncClient.js` spiegelt den
gesamten für die angemeldete Person sichtbaren Vereinsbestand in die
IndexedDB, und jedes Modul liest daraus über `getAll(<store>)` — **ohne
jeden `clubId`- oder Rollenfilter**. Die `clubId` wird ausschließlich beim
Schreiben gestempelt (`db.js: put()`), beim Lesen nie ausgewertet. Die
lokale Ablage ist damit implizit an „die eine Person, die dieses Gerät
benutzt" gebunden.

Durchgesetzt wurde diese Bindung aber nur an einer einzigen Stelle:
`logout()` ruft `wipeAll()`. Eine Sitzung endet jedoch auf mehreren Wegen,
auf denen `logout()` nie läuft:

* `restoreSession()` scheitert, weil das Refresh Token abgelaufen ist oder
  **serverseitig widerrufen** wurde. Letzteres ist kein Randfall, sondern
  vom Backend absichtlich häufig ausgelöst: `revokeAllForUser()` läuft bei
  Passwortwechsel, Passwort-Reset, E-Mail-Wechsel, bei der
  Reuse-Detection in `auth.service.ts: refresh()` und bei der
  DSGVO-Kontolöschung. `restoreSession()` räumt in diesem Fall nur die
  Tokens weg (`api.clearTokens()`) und zeigt den Login-Bildschirm — die
  IndexedDB bleibt vollständig stehen.
* Das Gerät wird schlicht geschlossen und später von einer anderen Person
  geöffnet.

`login()` räumte danach ebenfalls nicht auf. `applyEnabledModules()`
(Befund N5 des Vorreviews) leert zwar Stores — aber nur die Pakete, die
im Vergleich zum letzten bekannten Stand **weggefallen** sind; hat der
neue Verein dieselben oder mehr Module, passiert nichts.

**Wirkung.** Zwei Ausprägungen:

1. **Vereinsübergreifend.** Auf einem geteilten Gerät (Vereinsheim-Tablet,
   Gerät am Beckenrand — die Anleitung im Code spricht ausdrücklich vom
   „poolside" ausgedruckten Plan; oder ein die Vereine wechselnder
   Trainer) sieht Verein B die Athlet:innen samt Notizen, Pläne,
   Trainingseinheiten und Anwesenheiten von Verein A. Auf einer
   Mehrmandanten-Instanz ist das ein echter Mandantendurchbruch — nur
   eben clientseitig.
2. **Rollenübergreifend, und praktisch näherliegend.** Meldet sich auf dem
   Tablet einer Trainerin anschließend eine Athlet:in desselben Vereins
   an, sieht sie genau die Felder, die `sync.athleteScope.ts`
   serverseitig gezielt für ihre Rolle redigiert: `athletes.notes`,
   `sessions.trainerNote`, die `attendance`-Zeilen aller anderen
   Athlet:innen sowie `birthdate`/`gender`/`joinDate` fremder Personen.
   Die Befunde M1 und M2 des Vorreviews `security-review-2026-08.md` (die
   diese Redaktion überhaupt erst eingeführt haben) waren damit auf dem
   Endgerät vollständig ausgehebelt.

Kein Server-Zugriff wird dadurch gewährt: schreibt die neue Person einen
geerbten Datensatz fort, weist `sync.service.ts: requireOwnClub()` das
Event mit fremder `clubId` zurück. Es ist ein reiner, aber vollständiger
**Lesezugriff auf lokal liegende personenbezogene Daten** — und damit
zugleich ein DSGVO-Thema (Art. 5 Abs. 1 lit. f, Art. 32).

**Fix.** Die lokale Ablage ist jetzt an **genau eine User-ID** gebunden.
`state.js` führt dafür einen `meta`-Eintrag `localStoreOwner` und eine
Funktion `ensureLocalStoreBelongsTo(userId)`, die vor jedem Setzen einer
Identität läuft — in `restoreSession()`, `login()`, `acceptInvitation()`
und `resetPassword()`. Stimmt der vermerkte Eigentümer nicht mit der
anmeldenden Person überein, wird `wipeAll()` ausgeführt, bevor irgendein
Modul lesen kann. `changePassword()`/`changeEmail()` brauchen den Wächter
bewusst nicht: dort ändern sich nur die Zugangsdaten, nicht die Identität.

Bewusst an der **User-ID** festgemacht, nicht an der `clubId` — die
zweite, näherliegende Ausprägung oben ist genau ein Rollenwechsel
*innerhalb* eines Vereins.

Ein **fehlender** Eigentümer-Vermerk bedeutet „Herkunft unbekannt": das
trifft ein fabrikneues Gerät (nichts zu verlieren) ebenso wie eine
Installation aus der Zeit vor dieser Korrektur (deren Bestand genau der
beschriebene Altbestand ist). Deshalb wird auch dann geleert — aber nur,
wenn tatsächlich fachliche Daten vorliegen (`countAll()` über
`CLUB_SCOPED_STORES`), sodass der Normalfall „frisches Gerät, leere
Ablage" nichts verliert und keinen unnötigen Vollabzug auslöst.

Der Preis ist derselbe, den `logout()` schon immer zahlt: noch nicht
hochgeladene Offline-Änderungen der **vorherigen** Person gehen verloren.
Das ist die richtige Wahl — die Alternative wäre, fremde personenbezogene
Daten sichtbar zu lassen, und die Warteschlange der vorherigen Person ist
ohnehin nur mit deren Zugangsdaten hochladbar.

**Test.** `apps/web/test/state.localStoreOwner.test.js` (5 Fälle: Wechsel
leert, gleiche Person leert nicht, leeres Erstgerät leert nicht,
Altbestand ohne Vermerk wird geleert, greift auch über
`restoreSession()`). Ohne die Korrektur schlagen 3 der 5 Fälle fehl —
empirisch geprüft, nicht angenommen.

---

## M1 — Ein `PrismaClient` je Aufruf in Produktion

**Ort.** `apps/api/src/db/prisma.ts`, aufgerufen aus `apps/api/src/app.ts`.

**Befund.** `getPrisma()` cachte die Instanz ausschließlich in
`globalThis.__prisma`, und diese Zuweisung stand hinter
`if (process.env.NODE_ENV !== 'production')`. Der Kommentar dort zielte
korrekt auf `tsx watch` (ein Neustart lädt die Modul-Registry neu und
sammelte sonst mit jedem Speichern einen weiteren Client an) — die
Einschränkung traf aber den **Cache selbst**, nicht nur die
Hot-Reload-Brücke. In Produktion lieferte jeder Aufruf daher eine frische
Instanz.

`buildApp()` ruft `getPrisma()` an **elf** Stellen auf — bewusst je
Repository/Gateway einzeln hinter dessen eigenem `??`, damit ein Test, der
alle Stellen überschreibt, gar keinen Prisma-Client braucht (der
dortige Kommentar begründet das ausführlich und richtig). Die Folge war
aber: elf `PrismaClient`-Instanzen, jede mit eigener Query-Engine und
eigenem Verbindungspool.

**Wirkung.** Prismas Standard-`connection_limit` für PostgreSQL ist
`num_cpus × 2 + 1`; `DATABASE_URL` setzt in keiner der vier
Deployment-Anleitungen einen abweichenden Wert. Auf einem Vier-Kern-Server
sind das 9 × 11 = **99 Verbindungen** gegen PostgreSQLs Standard-
`max_connections` von 100 (abzüglich `superuser_reserved_connections`
faktisch 97). Die API konnte sich unter Last selbst von der Datenbank
aussperren — und mit ihr jeden weiteren Client, unter anderem den
DSGVO-Purge-Cronjob und `prisma migrate deploy` beim nächsten Deploy.
Dazu der elffache Speicherbedarf der Query-Engine, was besonders die
dokumentierte Raspberry-Pi-Variante trifft.

Der Fehler ist im Normalbetrieb unsichtbar: Prisma füllt die Pools lazy,
das Problem tritt erst unter gleichzeitiger Last auf — also genau dann,
wenn es am teuersten ist. Reine Verfügbarkeit, keine Vertraulichkeits-
oder Integritätsfrage; für einen kommerziellen Betrieb dennoch relevant.

**Fix.** Der Cache liegt jetzt in einer normalen Modul-Variablen, die in
**jeder** Umgebung greift. `globalThis.__prisma` bleibt zusätzlich
erhalten, aber nur noch für seinen eigentlichen Zweck (`tsx watch`), und
wird deshalb wie bisher nur außerhalb von Produktion beschrieben.

**Test.** `apps/api/test/db/prisma.test.ts` prüft die **Identität** der
zurückgegebenen Instanz über mehrere Aufrufe bei
`NODE_ENV=production` — nicht die Zahl der Konstruktoraufrufe:
`getPrisma()` lädt `@prisma/client` bewusst über `createRequire()`, und
ein `vi.mock()` greift auf diesem CJS-Pfad nicht. Identität deckt den
Befund vollständig ab; ohne die Korrektur schlägt der Test fehl
(empirisch geprüft).

---

## M2 — E-Mail-Adressen werden nirgends normalisiert

**Ort.** `packages/shared-types/src/auth.ts` und `.../invitation.ts` (fünf
Eingabe-Schemas), `apps/api/src/modules/auth/auth.repository.ts`.

**Befund.** Keine Stelle des Systems normalisierte E-Mail-Adressen —
weder Groß-/Kleinschreibung noch umgebende Leerzeichen. `User.email` trägt
in PostgreSQL ein `@unique`, dessen Vergleich zeichengenau ist;
`findByEmail()` filterte ebenso zeichengenau. „Anna@verein.de" und
„anna@verein.de" waren damit systemweit zwei verschiedene Adressen.

**Wirkung.** Drei Ausprägungen, in aufsteigender Schwere:

1. **Anmelde-Sackgasse.** Wer bei der Einladung als „Anna@Verein.de"
   erfasst wurde und sich als „anna@verein.de" anmeldet, bekommt
   „E-Mail-Adresse oder Passwort ist ungültig" — bei korrekten
   Zugangsdaten, ohne jeden Hinweis auf die Ursache. Die generische
   Fehlermeldung ist an sich richtig (sie verhindert User-Enumeration),
   macht die Fehlersuche hier aber unmöglich.
2. **Stille Sackgasse beim Zurücksetzen.** `POST /auth/forgot-password`
   antwortet aus gutem Grund immer generisch. Eine
   Schreibweisen-Abweichung ist dadurch von „Konto existiert nicht" nicht
   unterscheidbar: es kommt schlicht nie eine E-Mail an, und die
   betroffene Person hat keinen Weg zurück ins Konto. Der letzte
   Wiederherstellungspfad ist damit unter genau der Bedingung blockiert,
   unter der er gebraucht wird.
3. **Umgehbare Duplikat-Prüfung.** Die Prüfungen in `acceptInvitation()`
   und `changeEmail()` laufen beide über `findByEmail()`. Mit abweichender
   Schreibweise ließen sich für **ein reales Postfach** zwei Konten
   anlegen — potenziell mit unterschiedlichen Rollen. Kein Weg zur
   Übernahme eines fremden Kontos (Reset-Links gehen weiterhin an das
   echte Postfach, das der rechtmäßigen Person gehört), aber ein Bruch der
   Identitäts-Eindeutigkeit, auf der Nutzerverwaltung und
   DSGVO-Auskunft/-Löschung aufsetzen.

**Fix.** Zwei Ebenen, bewusst beide:

* **Eingabe.** Neues `NormalizedEmailSchema` (`z.string().trim()
  .toLowerCase().email()` — die String-Checks laufen in dieser
  Reihenfolge, also vor der Formatprüfung) in `packages/shared-types/src/
  user.ts`, eingesetzt in `LoginRequestSchema`,
  `ForgotPasswordRequestSchema`, `ChangeEmailRequestSchema`,
  `CreateClubRequestSchema.adminEmail` und
  `CreateInvitationRequestSchema.email`. Bewusst **nur** in
  Eingabe-Schemas: die Ausgabe-Schemas (`UserSchema.email`,
  `InvitationSummarySchema`, …) beschreiben, was der Server liefert, und
  dürfen einen gespeicherten Wert nicht nachträglich umschreiben.
* **Abgleich.** `PrismaUserRepository.findByEmail()` vergleicht jetzt mit
  `mode: 'insensitive'` (das In-Memory-Double zieht nach, damit es nicht
  von der echten Implementierung abweicht). Ohne diesen zweiten Schritt
  wäre die Normalisierung eine **Regression** gewesen: bereits
  gespeicherte Adressen in gemischter Schreibweise wären ab sofort nicht
  mehr anmeldbar. Bewusst so gelöst statt per Datenmigration — ein
  `UPDATE … SET email = lower(email)` könnte am `@unique` scheitern, wenn
  auf einer bestehenden Instanz bereits zwei Konten nach Ausprägung (3)
  existieren.
* **Folgekorrektur in `changeEmail()`.** Der Vorab-Check verglich
  `newEmail !== user.email` zeichengenau und hätte mit dem
  case-insensitiven Abgleich die Normalisierung der **eigenen** Adresse
  fälschlich als „bereits vergeben" abgelehnt. Er schließt das eigene
  Konto jetzt explizit aus (`emailTaken.id !== userId`) — bei
  unveränderter Anzahl Abfragen.

Wachstumsgrenze, bewusst notiert: `mode: 'insensitive'` nutzt den
`email`-Unique-Index nicht. Für die Größenordnung dieser Tabelle
(Vereinsmitglieder) ist das unkritisch; wächst eine Instanz darüber
hinaus, ist ein Index auf `lower("email")` plus einmalige
Normalisierungs-Migration der nächste Schritt.

**Test.** `packages/shared-types/test/auth.test.ts` und
`.../invitation.test.ts` prüfen, dass die Normalisierung im **geparsten
Wert** ankommt (nicht nur `success: true`) und dass eine weiterhin
ungültige Adresse abgelehnt wird;
`apps/api/test/auth/auth.service.test.ts` prüft die zweite
Verteidigungslinie am Service vorbei am Schema: Login und Reset bei
abweichender Schreibweise, Doppelkonto-Abwehr beim Einlösen einer
Einladung, sowie beide Seiten des `changeEmail()`-Falls (fremde
Case-Variante abgelehnt, eigene Normalisierung erlaubt).

---

## N1 — Fehlende Sicherheits-Header auf der statischen Weboberfläche

**Ort.** `docs/deployment.md`, `docs/deployment-raspberry-pi.md`,
`docs/deployment-macos.md`, `docs/deployment-github-codespaces.md`,
`scripts/setup-codespace.sh`.

**Befund.** `apps/api` setzt über Helmet (`plugins/security.ts`) eine
sorgfältig begründete Header-Garnitur — aber nur auf seinen **eigenen**
JSON-Antworten. Die HTML-Anwendung wird von Nginx direkt aus dem
`root`-Verzeichnis ausgeliefert, läuft also nicht durch Fastify. Dort war
seit Befund S3 des Wartbarkeits-Reviews eine CSP gesetzt, aber sonst
nichts:

* **`Strict-Transport-Security`** fehlte. `certbot --nginx` legt eine
  80→443-Weiterleitung an, aber kein HSTS. Ohne den Header ist der erste
  Aufruf einer Sitzung (Domain ohne „https://" getippt) als
  Klartext-HTTP angreifbar — und genau diese Anfrage lädt die App, die
  unmittelbar danach das im `localStorage` liegende Refresh Token
  verwendet.
* **`X-Content-Type-Options: nosniff`** fehlte (MIME-Sniffing).
* **`Referrer-Policy`** fehlte. Praktisch entschärft, weil die
  Einladungs-/Reset-Tokens im URL-**Fragment** stehen und den Browser nie
  verlassen (siehe `invitations.service.ts: buildInviteUrl()`) — der
  Header hält zusätzlich Pfad und Query aus dem Referer heraus.

**Fix.** Alle drei Header in den vier Anleitungen und im
Codespaces-Skript ergänzt, als `set`-Variablen und in jedem
`location`-Block wiederholt (eine Location mit eigenem `add_header` erbt
keine `add_header`-Direktiven des umschließenden Blocks — dieselbe
Nginx-Eigenheit, die dort schon für die CSP dokumentiert ist). HSTS nur in
den beiden TLS-terminierenden Anleitungen; in den beiden Aufbauten ohne
eigenes TLS (Codespaces-Portweiterleitung, lokaler Mac) wäre er
wirkungslos und würde falsche Sicherheit suggerieren — dort steht
stattdessen ein Kommentar, der das begründet. `preload` bewusst **nicht**
gesetzt: eine praktisch unumkehrbare Eintragung in die Browser-Liste
gehört zu einer bewussten Betreiber-Entscheidung, nicht zum Nebeneffekt
einer Anleitung.

---

## N2 — `.env` und privater Schlüssel entstehen unter der geltenden `umask`

**Ort.** `scripts/setup-codespace.sh`.

**Befund.** Befund H2 des Vorreviews vom 28. August verengte die Rechte
von `apps/api/.env` korrekt per `chmod 600` — der `chmod` läuft aber
**nach** dem `cat >`. Zwischen Erzeugung und `chmod` existiert die Datei
mit den Rechten aus der geltenden `umask` (üblich 0022 → 0644,
weltlesbar), und sie enthält unter anderem das Datenbank-Passwort.
Dasselbe gilt für `openssl genpkey -out` beim RS256-Schlüsselpaar: der
private Schlüssel, mit dem sich beliebige Access Tokens signieren lassen
(`plugins/authenticate.ts` prüft nur die Signatur, nie die Datenbank),
lag kurz offen. Das Fenster ist klein und setzt einen weiteren lokalen
Benutzer auf demselben Host voraus — aber es ist vermeidbar.

Nebenbei aufgefallen und mit entfernt: `JWT_SIGNING_KEY` wurde erzeugt und
in die `.env` geschrieben, ist aber in `config/env.ts` gar nicht
definiert — toter, irreführender Konfigurationswert, der beim Lesen wie
ein zweites, unabhängig verwaltetes Geheimnis aussah.

**Fix.** Erzeugung von `.env` und Schlüsselpaar jeweils in einer Subshell
mit `umask 077`, sodass die Dateien von Anfang an nur für den Eigentümer
lesbar sind. Die expliziten `chmod`-Aufrufe bleiben zusätzlich stehen —
sie korrigieren auch eine bereits vorhandene Datei aus einem früheren
Lauf.

---

## B1 — Beobachtung: E-Mail-Wechsel ohne Bestätigung des neuen Postfachs

**Ort.** `apps/api/src/modules/auth/auth.service.ts: changeEmail()`.

**Kein Fix in diesem Review** — bewusst, siehe unten.

`POST /api/me/email` verlangt seit Befund H2 des Vorreviews vom
27. August das aktuelle Passwort und widerruft alle anderen Sitzungen.
Beides ist richtig und schließt den dort beschriebenen
Kontoübernahme-Pfad. Die **neue** Adresse wird aber ohne
Bestätigungsschritt übernommen: es geht keine Mail an das neue Postfach,
und der Wechsel gilt sofort.

Praktische Folgen, alle deutlich unterhalb der Befunde oben:

* Ein Tippfehler kostet den Zugang zur Kontowiederherstellung — künftige
  „Passwort vergessen"-Mails gehen an eine Adresse, die die Person nicht
  liest. Die aktuelle Sitzung läuft weiter, der Verlust fällt also erst
  später auf.
* Eine Person kann eine fremde, ihr nicht gehörende Adresse an ihrem
  eigenen Konto hinterlegen. Das führt zu keiner Übernahme (Reset-Links
  gingen dann an das fremde Postfach, nicht zurück an die Angreiferin),
  kann aber unerwünschte Mails an Dritte auslösen und die
  Nutzerverwaltung irreführen.
* Ebenso fehlt eine Benachrichtigung an die **alte** Adresse („Ihre
  E-Mail-Adresse wurde geändert") — der übliche zweite Kanal, über den
  eine betroffene Person einen unbefugten Wechsel bemerkt.

Nicht behoben, weil ein Double-Opt-in-Wechsel kein
Ein-Zeilen-Sicherheitsfix ist, sondern eine Funktionserweiterung mit
eigenem Datenmodell (Token-Tabelle für ausstehende Adresswechsel), eigenem
Endpunkt, eigenem Mail-Template in beiden Sprachen und eigener
Frontend-Strecke. Das gehört geplant, nicht im Rahmen eines Reviews
nebenbei eingebaut. **Empfehlung:** vor breiterem kommerziellem Ausrollen
einplanen; die günstige Teilmaßnahme (Benachrichtigung an die alte
Adresse) lässt sich schon vorher separat umsetzen.

---

## Was geprüft wurde und hielt

Damit die Aussage „kein weiterer Befund" nachvollziehbar bleibt — diese
Bereiche wurden gezielt angegriffen und haben gehalten:

**Mandantentrennung (Sync-API).** `requireOwnClub` prüft die `clubId` des
Top-Level-Datensatzes; `assertForeignKeysWithinClub` prüft jede
referenzierte ID (`athleteId`, `groupId`, `competitionId`, `planId`,
`assignedTrainerId` sowie die beliebig tief in Sets/Blöcken/Abschnitten
verschachtelten `exerciseId`) gegen den eigenen Verein; `findById()`,
`update()` und `softDelete()` tragen die `clubId` in der WHERE-Klausel,
sodass ein Datensatz eines fremden Vereins als nicht existent gilt —
inklusive des `serverVersion`-Felds im Konfliktergebnis, das sonst ein
Leseleck wäre. Die Reihenfolge der `PUSH_GUARDS` ist selbst
sicherheitsrelevant und als Array-Position kodiert statt als
Zeilenreihenfolge. Kein Weg gefunden, an Daten eines fremden Vereins zu
kommen oder sie zu verändern.

**Rollen-Scopierung.** `STORE_PERMISSIONS` ist eine Whitelist (eine nicht
eingetragene Rolle hat nirgends Zugriff) und über
`Record<EntityStoreName, …>` zur Compile-Zeit vollständigkeitsgeprüft.
Die feineren, datenabhängigen Regeln sitzen an der richtigen Stelle:
`results` auf die eigene `athleteId` verengt (Push, Zeilenebene),
`scopeChangeForAthlete()` beim Pull mit einer **Allowlist** statt einer
Blockliste für fremde Athletenprofile. Die Kommentar-Autorenschaft
(`sync.commentAuthorship.ts`) wird über einen verbrauchenden Abgleich des
**vollständigen** Kommentars geführt, nicht über die frei wählbare
Kommentar-`id` — die drei Umgehungen, die eine reine id-Zuordnung offen
ließ, sind damit tatsächlich geschlossen, und die verbleibende Grenze der
Zusicherung ist an Ort und Stelle dokumentiert statt stillschweigend
hingenommen.

**Authentifizierung.** argon2id mit OWASP-konformen Parametern;
RS256-Schlüsselpaar, in Produktion Pflicht aus der Umgebung; Refresh
Tokens opak und nur als SHA-256-Hash gespeichert, mit Rotation und
Reuse-Detection (die alle Sitzungen widerruft); Reset-Tokens kurzlebig,
einmalig, und ein Reset/Passwortwechsel invalidiert **alle** offenen
Reset-Links des Kontos; Login läuft bei unbekannter Adresse gegen einen
Dummy-Hash, sodass die Antwortzeit keine Enumeration erlaubt;
`/auth/forgot-password` sendet bewusst ohne `await`, damit die
SMTP-Latenz kein Orakel wird. Rate-Limits sind je Endpunkt differenziert
und der `keyGenerator` läuft in der `preHandler`-Stufe, weil er den Body
braucht — beides mit Begründung.

**Rechteausweitung.** `InvitationRoleSchema` schließt `superadmin` aus;
`assertCanIssueRole()` erlaubt Admin-Einladungen nur Superadmins; ein
Admin lädt immer in den eigenen Verein ein (eine mitgeschickte fremde
`clubId` wird ignoriert); eine mitgeschickte `athleteId` wird gegen den
Zielverein geprüft. Rolle, Verein und `athleteId` eines neuen Kontos
stammen ausschließlich aus der serverseitig gespeicherten Einladung, nie
aus dem Request.

**Injektion und XSS.** Alle rohen SQL-Stellen (`$queryRaw`/`$executeRaw`
in `profile.repository.ts` und `erasure.repository.ts`) sind Tagged
Templates, also parametrisiert. Das Frontend baut DOM ausschließlich über
`el()` (`textContent`/`setAttribute`); die drei `innerHTML`-Stellen sind
fest im Code stehende SVG-Konstanten bzw. Diagramm-Generatoren, deren
dynamische Anteile durch `esc()` laufen und deren Farbwerte
ausnahmslos Konstanten der Aufrufer sind (geprüft: kein Aufrufer setzt
`bar.color`). Kein `document.write`, kein `eval`, kein
`insertAdjacentHTML`. Die Mail-Templates escapen alle eingesetzten Werte.

**Eingabevalidierung.** Die Entity-Schemas sind durchgängig `.strict()`
mit Längen- und Array-Obergrenzen, und — entscheidend —
`ctx.validatedPayload` wird ab Stufe 5 für **alles** verwendet, auch für
die eigentlichen `create()`/`update()`-Aufrufe; der rohe `event.payload`
erreicht Prisma nie. Damit ist Mass Assignment tatsächlich geschlossen und
nicht nur formal geprüft. `createdAt`/`updatedAt` werden vor jeder
Verwendung entfernt, sodass die Client-Uhr nicht den Sync-Cursor bestimmt.

**Betrieb.** `TRUSTED_PROXY_IPS` ist in Produktion Pflicht und benennt nur
die tatsächlichen Hops (kein `trustProxy: true`); `HOST` bindet
standardmäßig den Loopback; `CORS_ORIGIN: '*'` wird in Produktion beim
Start abgelehnt; der Container läuft als `node`, nicht als root;
`SMTP` erzwingt STARTTLS über `requireTLS`; der Service Worker reicht
`/api/`, `/auth/` und `/admin` immer ans Netz durch und cacht sie nie.
Die Fehlerbehandlung gibt rohe Prisma-Meldungen nie an den Client weiter,
und „Referenz existiert nicht" ist von „Referenz gehört einem fremden
Verein" absichtlich ununterscheidbar formuliert.

**Bekannt und weiterhin akzeptiert (unverändert aus den Vorreviews).**
Das Refresh Token liegt im `localStorage` statt in einem
httpOnly-Cookie — dokumentiert in `apiClient.js`, abgefedert durch die
CSP der Auslieferung (und seit N1 zusätzlich durch HSTS). Access Tokens
werden nicht gegen die Datenbank geprüft, ein Soft-Delete oder eine
Rollenänderung wirkt daher erst nach Ablauf des Tokens (Standard: 15
Minuten) — der übliche Trade-off zustandsloser Tokens, in
`plugins/authenticate.ts` ausdrücklich dokumentiert.
