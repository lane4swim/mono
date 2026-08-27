# Sicherheitsreview — Lane 1 Monorepo (27. August 2026)

Umfang: `apps/api`, `apps/web`, `packages/*`, Deployment-/CI-Konfiguration.
Schwerpunkt: Authentifizierung/Autorisierung, Mandantentrennung (`clubId`),
das neu hinzugekommene Modul-Gating pro Verein, Datenminimierung/DSGVO,
Injection, Secrets-Handling, Abhängigkeiten.

**Abgrenzung zum Vorreview.** Dieses Dokument ist eine eigenständige,
unabhängige Prüfung — keine Fortschreibung von
`docs/security-review-2026-08.md`. Dessen Befunde wurden nicht ungeprüft
übernommen, sondern jeder als „behoben" markierte Punkt am aktuellen Code
nachvollzogen. Ergebnis dieser Nachprüfung:

* **Tatsächlich behoben** und stichprobenartig bestätigt: H1 (keine
  Default-Zugangsdaten mehr), M1 (`trainerNote` redigiert), M2
  (`TEAM_VISIBLE_ATHLETE_FIELDS`-Allowlist, eigentümerschaftsbewusst),
  M3 (Preview per POST, `ConsoleMailSender` ohne Token), M4
  (`requireTLS: !secure`), M5 (drei neue Endpunkte, sauber gebaut), N1
  (Zeilenscoping für `results`), N2/N7 (`.max(200)` durchgängig), N3
  (Origin-Gating des API-Base-URL-Overrides), N5
  (`Comment.authorName`-Anonymisierung).
* **Weiterhin offen:** N6 (Superadmin-Passwort als CLI-Argument) — siehe
  N2 unten.
* **Nicht sauber behoben:** H2. Die Korrektur (`trustProxy: true`) hat den
  ursprünglichen Befund beseitigt, dabei aber eine neue, gravierendere
  Lücke geöffnet — siehe **H1** unten. Der zugehörige Regressionstest
  zementiert genau das verwundbare Verhalten als „korrekt".

**Update (27. August 2026, im Anschluss an dieses Review).** In fünf
Schritten direkt im Anschluss an diese Prüfung behoben (siehe die
jeweiligen **Fix**-Abschnitte unten): zuerst **H1** und **N7** — beide
betreffen dieselbe Betriebsannahme (ein vorgeschalteter, co-lokalisierter
Reverse Proxy) und wurden bewusst gemeinsam umgesetzt —, danach **H2**
zusammen mit **N3** (N3s Fix wandert wie in dessen ursprünglicher
Empfehlung vorgesehen direkt in den für H2 neu geschaffenen Endpunkt) und
**N4**, danach **M1**, danach **M2** zusammen mit **N6**, zuletzt **N1**
und **N5**. Damit sind beide Hoch-Befunde, beide Mittel-Befunde sowie
sechs der sieben Niedrig-Befunde behoben; lediglich **N2** ist zum
Zeitpunkt dieses Updates weiterhin offen.

**Vorbemerkung.** Der Gesamteindruck des Vorreviews bestätigt sich: die
Kernlogik ist überdurchschnittlich sorgfältig gebaut. argon2id mit
OWASP-Parametern, RS256 mit opaken, gehashten Refresh-Tokens inkl. Rotation
und Reuse-Detection, Timing-Angleichung im Login, durchgängiges
`clubId`-Scoping bis in die Transaktion hinein (`where: { id, clubId }`),
Whitelist-basierte Rechte-Matrix, `.strict()`-Schemas mit durchgängigen
Längenbegrenzungen, ausschließlich parametrisiertes SQL, `npm audit` als
blockierender CI-Schritt. Das neue Modul-Gating ist serverseitig
tatsächlich durchgesetzt (nicht nur eine UI-Kosmetik) und fällt in jeder
geprüften Fehlerkonstellation zu (`enabledModules: []`), nicht auf.

Die beiden hoch eingestuften Befunde liegen dementsprechend nicht in der
Kernlogik, sondern an ihren Rändern: einer in der Betriebs-/Proxy-Ebene,
einer in einem Endpunkt (`PATCH /api/me`), der bei den Härtungen rund um
Passwörter schlicht nicht mitbetrachtet wurde.

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| H1 | `trustProxy: true`: `X-Forwarded-For` ist vollständig client-kontrolliert — alle IP-Rate-Limits umgehbar | `apps/api/src/app.ts:80` | Hoch — **behoben** |
| H2 | `PATCH /api/me` erlaubt unverifizierten E-Mail-Wechsel ohne Passwortprüfung → dauerhafte Kontoübernahme | `auth.route.ts:204`, `auth.service.ts:482` | Hoch — **behoben** |
| M1 | Art.-17-Hard-Purge lässt die E-Mail-Adresse in `invitations` stehen | `jobs/erasure.repository.ts:43-217` | Mittel — **behoben** |
| M2 | `Comment.authorName` ist reine Client-Angabe — Identitätsvortäuschung im Verein | `entities.ts:47`, `sync.permissions.ts:91` | Mittel — **behoben** |
| N1 | Frisch erzeugtes DB-Passwort landet im Klartext im Terminal/CI-Log | `scripts/setup-codespace.sh:296` | Niedrig — **behoben** |
| N2 | Superadmin-Passwort als Kommandozeilenargument (**offen aus Vorreview N6**) | `scripts/createSuperAdmin.ts`, `setup-codespace.sh:221` | Niedrig |
| N3 | E-Mail-Wechsel auf die Adresse eines soft-gelöschten Kontos → 500 statt 409 (Existenz-Orakel) | `auth.service.ts:486-488` | Niedrig — **behoben** |
| N4 | `resetPassword()` invalidiert weitere offene Reset-Tokens desselben Kontos nicht | `auth.service.ts:427-445` | Niedrig — **behoben** |
| N5 | Abbestelltes Modul entfernt bereits synchronisierte Daten nicht vom Gerät | `sync.service.ts:439`, `syncClient.js` | Niedrig — **behoben** |
| N6 | `GET /api/users/trainers` liefert vollständige Nutzerdatensätze an jede Rolle `trainer` | `auth.service.ts:545` | Niedrig — **behoben** |
| N7 | API lauscht fest auf `0.0.0.0:3000`, nicht konfigurierbar | `apps/api/src/index.ts:10` | Niedrig — **behoben** |

---

## Hoch

### H1 — `trustProxy: true`: `X-Forwarded-For` ist vollständig client-kontrolliert — **behoben**

**Fix.** Neue Umgebungsvariable `TRUSTED_PROXY_IPS`
(`apps/api/src/config/env.ts`) — kommagetrennte Liste der tatsächlich
vertrauenswürdigen Reverse-Proxy-Adressen (bei jedem dokumentierten
Deployment: `127.0.0.1`, da Nginx auf demselben Host läuft). `app.ts:
resolveTrustProxy()` wandelt sie in Fastifys `trustProxy`-Option um (Array
statt `true`) — leer bedeutet "kein Proxy vertrauenswürdig" (Fastifys
sicherer Default), korrekt für lokale Entwicklung und den
docker-compose-Aufbau ohne vorgeschalteten Proxy. In Produktion ist die
Variable jetzt **Pflicht**: `loadEnv()` bricht ohne sie sofort mit einer
klaren Fehlermeldung ab, analog zum bestehenden JWT-Schlüsselpaar-Zwang —
bewusst kein stiller Default, da sowohl "leer" (kollabiert zurück auf
Befund H2 des Vorreviews) als auch "alles vertrauen" (reproduziert diesen
Befund) sicherheitsrelevant falsch wären.

Empirisch gegen Fastify 5 verifiziert (siehe Regressionstests unten): eine
Anfrage von der konfigurierten Proxy-Adresse liefert weiterhin die
tatsächliche Client-Adresse aus `X-Forwarded-For`; eine Anfrage von einer
NICHT vertrauenswürdigen Adresse ignoriert einen mitgeschickten
Fälschungs-Header vollständig und liefert die echte Peer-Adresse.

Regressionstests: `apps/api/test/plugins/security.test.ts` (Testblock
„trustProxy — nur die konfigurierte Proxy-Adresse wird vertraut" — ein
Test bestätigt, dass zwei echte Clients HINTER der vertrauenswürdigen
Proxy-Adresse weiterhin getrennte Rate-Limit-Budgets bekommen, deckt also
weiterhin Befund H2 des Vorreviews ab; ein zweiter simuliert den
H1-Angriff selbst — ein Client hängt bei jedem Versuch einen anderen,
frei erfundenen Wert vor die von Nginx angehängte echte Adresse und
erschöpft trotzdem nur EIN gemeinsames Budget. Beide Tests wurden vor dem
Fix gegen den alten Code — `trustProxy: true` — gegengeprüft: der
H1-Angriffstest schlägt dort erwartungsgemäß fehl, was bestätigt, dass er
die Regression tatsächlich erkennt.) sowie `apps/api/test/env.test.ts`
(Pflicht in Produktion, Default außerhalb).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/app.ts:80`

```ts
const app = Fastify({
  logger: env.NODE_ENV !== 'test',
  trustProxy: true,
});
```

Diese Zeile ist die Korrektur für Befund H2 des Vorreviews (ohne
`trustProxy` kollabierten alle IP-Rate-Limits auf einen einzigen Zähler).
Sie behebt das ursprüngliche Problem — aber `true` bedeutet für Fastify
bzw. das darunterliegende `proxy-addr`: **jede** Adresse in der Kette gilt
als vertrauenswürdiger Proxy, also wird der **am weitesten links stehende**
Eintrag aus `X-Forwarded-For` als `request.ip` übernommen. Genau dieser
Eintrag stammt vom Client.

Jede der vier Deployment-Anleitungen sowie das Setup-Skript konfigurieren
Nginx mit `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`
(`docs/deployment.md:454` und `:471`, `deployment-raspberry-pi.md:463`,
`deployment-macos.md:287`, `scripts/setup-codespace.sh:260`) — das
**hängt** die echte Client-Adresse an einen vom Client mitgeschickten Wert
an, statt ihn zu ersetzen. Ein Client, der `X-Forwarded-For: 203.0.113.99`
sendet, erzeugt damit `X-Forwarded-For: 203.0.113.99, <echte IP>` — und
Fastify nimmt den ersten Wert. Der ebenfalls gesetzte, **nicht**
fälschbare Header `X-Real-IP $remote_addr` (`deployment.md:453`) wird von
Fastify nicht ausgewertet; ein `set_real_ip_from`/`real_ip_header`-Block,
der den XFF-Wert serverseitig bereinigen würde, existiert in keiner der
Konfigurationen. Der Befund betrifft damit den dokumentierten
Produktivbetrieb (Hetzner, Raspberry Pi) genauso wie das Testsetup.

**Empirisch verifiziert** (Fastify 5, `app.inject()` mit
`remoteAddress: '127.0.0.1'` als simuliertem Nginx,
`x-forwarded-for: '203.0.113.99, 198.51.100.7'`):

```
trustProxy: true (aktueller Code)    -> request.ip = 203.0.113.99   <- Client-Wert
trustProxy: '127.0.0.1'              -> request.ip = 198.51.100.7   <- echte Client-IP
```

Folgen — `request.ip` ist der Schlüssel **jedes** Rate-Limits der
Anwendung, ein Angreifer kann ihn pro Anfrage frei wählen und damit für
jede Anfrage einen frischen Zähler bekommen:

* **`/auth/login` (5/min, Key `IP:E-Mail`, `auth.route.ts:55`):** der
  Brute-Force-Schutz auf ein einzelnes Konto ist vollständig aufgehoben —
  die E-Mail-Komponente ist konstant, die IP-Komponente frei wählbar. Mit
  argon2id (64 MiB, 3 Iterationen) je Versuch ist das zugleich ein
  wirksamer Ressourcen-Erschöpfungsvektor.
* **`/auth/forgot-password` (3/15 min, `auth.route.ts:130`):** das Limit
  soll laut Kommentar ausdrücklich „das Fluten EINER Person mit
  Reset-E-Mails" verhindern. Es tut das nicht mehr — beliebig viele
  Reset-Mails an eine beliebige Adresse, auf Kosten der
  SMTP-Reputation der Installation.
* **`/auth/refresh`, `/auth/logout`, `/auth/register`,
  `/api/invitations/preview` (je 10 bzw. 20/min):** das automatisierte
  Durchprobieren von Einladungs-Tokens, gegen das das Preview-Limit
  ausdrücklich eingeführt wurde (M3 des Vorreviews), ist wieder
  unbegrenzt möglich.
* **Globales Limit (100/min, `plugins/security.ts:79`):** ebenfalls
  wirkungslos. In Verbindung mit `SyncPushRequestSchema` (bis zu 500
  Events pro Request, `syncEvent.ts:50`), von denen jedes eigene
  DB-Abfragen und eine Transaktion auslöst, ist das ein ergiebiger
  DoS-Vektor.
* **Log-Fälschung:** Fastify protokolliert `request.ip` bei jeder Anfrage.
  Sämtliche IP-Angaben in den Anwendungslogs sind damit angreiferbestimmt
  — jede spätere forensische Auswertung oder ein darauf aufgesetztes
  IP-Blocking (fail2ban o. Ä.) arbeitet mit gefälschten Daten.

Verschärfend: der Regressionstest `test/plugins/security.test.ts:160-181`
schickt zwei unterschiedliche `X-Forwarded-For`-Werte und prüft, dass
beide **getrennte** Rate-Limit-Budgets erhalten. Der Test ist fachlich
korrekt gemeint (verschiedene echte Clients sollen sich nicht behindern),
demonstriert aber unbeabsichtigt exakt den Angriff und würde bei einer
Korrektur fehlschlagen — die Lücke ist damit als Soll-Verhalten
festgeschrieben.

Der Vorreview hatte diese Möglichkeit übrigens bereits benannt
(„bzw. gezielter: die konkrete Proxy-Adresse/CIDR statt `true` …"), sie
wurde bei der Umsetzung aber nicht mitgenommen.

**Empfehlung.** `trustProxy` auf die konkrete Proxy-Adresse setzen statt
auf `true`:

```ts
trustProxy: env.TRUSTED_PROXY_IPS,   // z. B. '127.0.0.1' bzw. '127.0.0.1,::1'
```

Damit überspringt `proxy-addr` nur tatsächlich vertrauenswürdige Hops und
liefert den ersten **nicht** vertrauenswürdigen Eintrag von rechts — also
die echte Client-Adresse (oben empirisch bestätigt). Ein neuer,
verpflichtender Env-Wert (Default `127.0.0.1`, in Produktion explizit zu
setzen) hält die Konfiguration an der Stelle, an der auch das
Deployment über den Proxy entscheidet. Der Regressionstest muss dabei
angepasst werden: Er sollte zwei Anfragen mit unterschiedlichen
`remoteAddress`-Werten (bzw. unterschiedlichem *rechtestem*
XFF-Eintrag) trennen — und zusätzlich nachweisen, dass ein
**vorangestellter, selbst gesetzter** XFF-Wert das Budget **nicht**
zurücksetzt.

---

### H2 — `PATCH /api/me` erlaubt unverifizierten E-Mail-Wechsel ohne Passwortprüfung — **behoben**

**Fix.** Umgesetzt wie in **Empfehlung** Punkt 1 beschrieben, plus N3 (siehe
dort) direkt mitbehoben — bewusst **ohne** Punkt 2 (Double-Opt-In) und
Punkt 3 (Benachrichtigung der alten Adresse), da Punkt 4 der ursprünglichen
Empfehlung diese beiden explizit als optionale Verstärkung einordnet und
Punkt 1 allein bereits als „die entscheidende Sperre" benannt ist:

* `email` aus `UpdateMeRequestSchema` entfernt (`packages/shared-types/src/
  auth.ts`) — `PATCH /api/me` akzeptiert nur noch `name`/`locale`; ein
  trotzdem mitgeschicktes `email`-Feld wird von Zod stillschweigend
  entfernt, bevor `authService.updateMe()` es zu Gesicht bekäme.
* Neues `ChangeEmailRequestSchema` (`currentPassword` + `newEmail`, analog
  zu `ChangePasswordRequestSchema`) und neuer Endpunkt
  `POST /api/me/email` (`auth.route.ts`), rate-limitiert wie
  `/api/me/password` (5/min, nur nach IP — der globale Rate-Limit-Hook
  läuft vor `app.authenticate`, `request.user` ist im `keyGenerator` noch
  nicht gesetzt).
* Neue Methode `authService.changeEmail()`: verifiziert das aktuelle
  Passwort (`InvalidCurrentPasswordError` bei Fehlschlag), prüft die neue
  Adresse gegen `findByEmail()`, aktualisiert sie, widerruft anschließend
  — wie `changePassword()` — alle bestehenden Sitzungen und stellt sofort
  ein frisches Token-Paar für die aktuelle Sitzung aus (jede künftige
  „Passwort vergessen"-Anfrage geht ab sofort an die neue Adresse; jedes
  andere Gerät wird abgemeldet).
* Frontend (`apps/web/js/modules/profile.js`): die E-Mail-Adresse im
  Kontodaten-Formular ist jetzt eine reine Anzeige; ein neues, eigenes
  „E-Mail-Adresse ändern"-Formular (aktuelles Passwort + neue Adresse,
  analog zum bestehenden Passwortwechsel-Formular) übernimmt den
  eigentlichen Wechsel.

Regressionstests: `apps/api/test/auth/auth.service.test.ts`
(`describe('authService.changeEmail …')` — korrektes Passwort ändert die
Adresse und liefert ein frisches Token-Paar, falsches Passwort lehnt ab
ohne zu ändern, andere Sitzungen werden widerrufen/aktuelle bleibt gültig,
unveränderte eigene Adresse ist kein Konflikt, bereits von einem aktiven
Konto verwendete Adresse wird abgelehnt); `apps/api/test/auth/
auth.route.test.ts` (Route end-to-end inkl. 401/400/409 und Rate-Limit,
plus ein Test, dass `PATCH /api/me` ein mitgeschicktes `email`-Feld
ignoriert); `packages/shared-types/test/auth.test.ts` (Schema-Ebene).

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`apps/api/src/modules/auth/auth.route.ts:204-210`,
`apps/api/src/modules/auth/auth.service.ts:482-498`,
`packages/shared-types/src/auth.ts:79-88`

`UpdateMeRequestSchema` erlaubte `{ name, email, locale }`; die Route war
nur mit `app.authenticate` geschützt:

```ts
app.patch('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
  const body = parseInput(UpdateMeRequestSchema, request.body, reply);
  ...
  const user = await authService.updateMe(request.user!.sub, body);
```

`updateMe()` prüft lediglich, ob die neue Adresse bereits vergeben ist —
**kein aktuelles Passwort, keine Bestätigung der neuen Adresse per
Double-Opt-In, keine Benachrichtigung an die bisherige Adresse, kein
Widerruf anderer Sitzungen.**

Das steht in direktem Widerspruch zu der Begründung, mit der die
Passwortwechsel-Funktion aus M5 des Vorreviews bewusst das aktuelle
Passwort verlangt (`auth.service.ts:447-453`):

> „verlangt zusätzlich das aktuelle Passwort (verhindert, dass ein
> kurzzeitig entwendeter Access Token allein zur dauerhaften
> Kontoübernahme reicht: ohne diese Prüfung könnte ein gestohlenes, noch
> gültiges Access Token genutzt werden, um die eigentliche Besitzerin/den
> eigentlichen Besitzer per neuem Passwort dauerhaft auszusperren)."

Genau dieses Ziel wird über `PATCH /api/me` erreicht — nur einen Schritt
länger:

1. `PATCH /api/me` mit `{ "email": "angreifer@example.org" }` → 200.
2. `POST /auth/forgot-password` mit `angreifer@example.org` → der
   Reset-Link geht an den Angreifer.
3. `POST /auth/reset-password` → neues Passwort. `resetPassword()` ruft
   dabei `revokeAllForUser()` auf (`auth.service.ts:440`) und stellt der
   anfragenden Seite ein frisches Token-Paar aus.

Ergebnis: Der Angreifer besitzt das Konto dauerhaft, die rechtmäßige
Person ist **abgemeldet und ausgesperrt** — sie kennt weder die neue
E-Mail-Adresse noch das neue Passwort, und ihr eigener
„Passwort vergessen"-Versuch läuft auf die alte, nicht mehr hinterlegte
Adresse und liefert (korrekterweise) die generische Antwort, ohne dass je
eine Mail ankommt. Sitzungswiderruf hilft nicht, weil derselbe Schritt ihn
bereits ausgelöst hat. Betrifft jede Rolle, einschließlich `admin`
(Vollzugriff auf den Verein) und `superadmin` (Vollzugriff auf alle
Mandanten).

Vorbedingung ist eine bestehende Sitzung — aber genau dafür ist die
Angriffsfläche in dieser App bewusst breit angelegt: das Refresh-Token
liegt als dokumentierte Vereinfachung bis zu 30 Tage im `localStorage`
(N3 des Vorreviews, bewusst akzeptiert), und die Anwendung ist als PWA für
geteilte Vereinsgeräte (Tablet am Beckenrand) ausgelegt. Kurzer physischer
Zugriff auf ein entsperrtes, eingeloggtes Gerät genügt; ein XSS ebenso.
Das Zeitfenster ist mit dem Access Token nicht auf 15 Minuten begrenzt —
der Angreifer nimmt schlicht das Refresh-Token mit.

**Empfehlung.** Den E-Mail-Wechsel wie den Passwortwechsel behandeln,
statt wie eine Profilnotiz:

1. `email` aus `UpdateMeRequestSchema` herausnehmen und über einen eigenen
   Endpunkt führen (`POST /api/me/email`), der — analog zu
   `ChangePasswordRequestSchema` — `currentPassword` verlangt und über
   `verifyPassword()` prüft.
2. Die Änderung erst nach Bestätigung der **neuen** Adresse wirksam
   werden lassen (Double-Opt-In). Die Infrastruktur dafür liegt komplett
   bereit: `generateOpaqueToken()` / gehashte Speicherung / TTL wie bei
   `PasswordResetToken`, plus ein weiterer Builder in `mail/mailer.ts`.
3. Eine Benachrichtigung an die **bisherige** Adresse senden („Ihre
   E-Mail-Adresse wurde geändert") — das ist der Kanal, über den eine
   betroffene Person eine Übernahme überhaupt bemerken kann.
4. Falls (2) als zu aufwendig verworfen wird, ist (1) allein bereits die
   entscheidende Sperre: sie stellt den E-Mail-Wechsel exakt auf dieselbe
   Hürde wie den Passwortwechsel und schließt den oben gezeigten Pfad.

Ohne konfiguriertes SMTP ist der Pfad übrigens nicht ausnutzbar
(`ConsoleMailSender.sendPasswordResetEmail()` versendet und protokolliert
bewusst nichts, `mailer.ts:325`) — der dokumentierte mailserverlose
Betrieb ist also nicht betroffen. Das ist ein glücklicher Nebeneffekt,
keine Absicherung.

---

## Mittel

### M1 — Art.-17-Hard-Purge lässt die E-Mail-Adresse in `invitations` stehen — **behoben**

**Fix.** Umgesetzt wie in der Empfehlung beschrieben: `purgeUserAndDependents()`
setzt jetzt, im selben Transaktionsblock und vor `tx.user.delete()`, für
jede Einladung mit `email === user.email` sowohl `email` auf einen neuen
Platzhalter (`ANONYMIZED_INVITATION_EMAIL = 'geloeschtes-konto@geloescht.invalid'`,
analog zu `ANONYMIZED_COMMENT_AUTHOR` in `commentAnonymization.ts`, aber
als eigene Konstante in `erasure.repository.ts` — kein freier
Namensabgleich wie bei N5 nötig, da `email` selbst der exakte, eindeutige
Abgleichswert ist) als auch `athleteId` auf `null`. Bewusst **nicht** auf
`user.clubId` gescoped (anders als die Kommentar-Anonymisierung) — dieselbe
Adresse kann über mehrere Vereine hinweg eingeladen worden sein.
`Invitation.invitedById` (Einladungen, die diese Person selbst ausgestellt
hat) bleibt unverändert, wie in der Empfehlung vorgesehen — das ist eine
andere Beziehung und bereits über `onDelete: SetNull` als gewollter
historischer Datensatz behandelt.

Regressionstests: `apps/api/test/jobs/purgeExpiredDeletions.test.ts`
(InMemory — mehrere Einladungen an dieselbe Adresse werden alle erfasst,
eine Einladung an eine andere Adresse bzw. eine von der gelöschten Person
selbst ausgestellte Einladung bleibt unangetastet, funktioniert auch ohne
verknüpftes Athletenprofil) sowie ein Integrationstest in
`test-integration/profileErasure.integration.test.ts` gegen eine echte
Postgres-Instanz (bestätigt die tatsächliche Prisma-Modell-/
Tabellenzuordnung und das korrekte Zusammenspiel mit der bereits
bestehenden `onDelete: SetNull`-Beziehung auf derselben Tabelle).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/jobs/erasure.repository.ts:43-217`

`purgeUserAndDependents()` ist beeindruckend gründlich: Refresh-Tokens,
Athletenprofil, Ergebnisse, Startlisteneinträge, Handlungsfelder,
Anwesenheitszeilen aus dem `attendance`-JSONB, `Comment.authorName` in
`plans`/`exercises`/`templates` (der N5-Fix des Vorreviews), Tombstones
für die Sync-API — und zuletzt der `User` selbst.

Nicht erfasst wird die Tabelle `invitations`. Deren Spalte `email`
(`schema.prisma:166`) enthält die E-Mail-Adresse der eingeladenen Person
im Klartext; der Datensatz überlebt den Purge unverändert, denn:

* Es gibt keine `deleteMany`/`updateMany` auf `invitation` im Purge-Pfad.
* `Invitation.invitedById` ist `onDelete: SetNull` (`schema.prisma:179`),
  d. h. die Zeile bleibt bewusst als historischer Datensatz bestehen — was
  für die *versendeten* Einladungen richtig ist, aber die *empfangene*
  Einladung derselben Person mit einschließt.

Damit bleibt nach einem vollständigen, unwiderruflichen Art.-17-Purge die
personenbezogene E-Mail-Adresse dauerhaft in der Datenbank. Sie ist
zusätzlich weiterhin über die API abrufbar: `GET /api/invitations` liefert
jedem `admin` des Vereins alle Einladungen inklusive `email`
(`invitations.service.ts:308-312`, `toPublicInvitation()` entfernt nur
`tokenHash`).

Das ist exakt dieselbe Befundklasse wie N5 des Vorreviews
(`Comment.authorName` blieb stehen) — dort wurde sie sorgfältig behoben,
hier ist sie übersehen worden. Anders als bei `Comment.authorName` (freier
Anzeigename, daher die dort dokumentierte Unschärfe) gibt es hier einen
**eindeutigen, stabilen Abgleichsschlüssel** — `Invitation.email` gegen
`User.email`, das laut `schema.prisma:63` `@unique` ist, ergänzt um
`Invitation.athleteId`. Die Umsetzung ist damit einfacher und
zuverlässiger als der bereits geleistete N5-Fix.

**Empfehlung.** Im selben Transaktionsblock, vor `tx.user.delete()`:
`Invitation.email` für alle Einladungen an die Adresse der gelöschten
Person auf einen Platzhalter setzen (analog zum bereits eingeführten
`ANONYMIZED_COMMENT_AUTHOR` in `jobs/commentAnonymization.ts`) und
`athleteId` auf `null`. Anonymisieren statt löschen hält den fachlichen
Nachweis („wann wurde wer mit welcher Rolle eingeladen") intakt, so wie
der N5-Fix den Kommentartext erhält. Regressionstest analog zu
`test-integration/profileErasure.integration.test.ts`.

Der Vollständigkeit halber ebenfalls prüfen — hier bewusst **nicht** als
Befund geführt, da es sich um freie Textfelder ohne strukturelle Zuordnung
handelt und die Grenze bereits in `commentAnonymization.ts` dokumentiert
ist: `TrainingSession.trainerNote` und `Athlete.notes` (Letzteres wird mit
dem Athletenprofil ohnehin gelöscht) können den Klarnamen enthalten.

---

### M2 — `Comment.authorName` ist reine Client-Angabe — **behoben**

**Fix.** Umgesetzt wie in der Empfehlung beschrieben, mit einer bewussten
Erweiterung über den ursprünglichen Vorschlag hinaus:

* `CommentSchema` (`packages/shared-types/src/entities.ts`) trägt jetzt
  zusätzlich `authorId: z.string().uuid()`.
* `SyncRequester` (`sync.service.ts`) führt ein neues Feld `userId`
  (`request.user.sub`, durchgereicht über `requesterFrom()` in
  `sync.route.ts`).
* Neue Datei `apps/api/src/modules/sync/sync.commentAuthorship.ts`:
  `assertCommentAuthorship()` durchsucht für die drei Stores mit
  eingebetteten Kommentar-Arrays (`exercises`, `plans`, `templates`,
  inklusive der verschachtelten `days[].sets[].comments`/`sets[].comments`
  bis in Wiederholungsblöcke hinein) alle Kommentar-Gruppen eines
  validierten Payloads und erzwingt zwei Regeln, analog zur bestehenden
  `results`-Zeilenprüfung inline in `push()` (nachdem `existing` geladen
  wurde, da beide Regeln den bisherigen Datensatz zum Vergleich brauchen):
  * ein **neuer** Kommentar (dessen `id` im bisherigen Datensatz noch nicht
    vorkam) muss `authorId === requester.sub` tragen;
  * ein **bestehender** Kommentar (die `id` existierte bereits) behält
    seine ursprüngliche `authorId`-Zuordnung unveränderlich — unabhängig
    davon, wer den umgebenden Datensatz gerade bearbeitet.

  Die zweite Regel geht bewusst über die ursprüngliche Empfehlung hinaus
  (die nur „neue/geänderte Kommentare" nannte): `plans` steht in
  `STORE_PERMISSIONS` als `shared` — ohne diese zweite Regel könnte jedes
  Vereinsmitglied beim Bearbeiten eines geteilten Plans die
  Autor:innen-Zuordnung eines fremden, bereits bestehenden Kommentars
  nachträglich umschreiben, ohne selbst einen neuen Kommentar anzulegen.
* `jobs/commentAnonymization.ts` (N5-Fix des Vorreviews) gleicht jetzt auf
  `authorId` statt auf `authorName` ab — die dort zuvor dokumentierte
  Grenze (Namensgleichheit/-änderung als Unschärfequelle) entfällt damit
  vollständig, ebenso in `erasure.repository.ts`/`.memory.ts` (Art.-17-Purge
  übergibt jetzt `user.id` statt `user.name`).
* Frontend (`apps/web/js/modules/comments.js`): `addComment()` setzt
  `authorId: user?.id` beim Anlegen eines neuen Kommentars.

Regressionstests: `packages/shared-types/test/entities.test.ts`
(`authorId` als Pflichtfeld, lehnt fehlenden/ungültigen Wert ab);
`apps/api/test/jobs/commentAnonymization.test.ts` (Abgleich erfolgt über
`authorId`, ein abweichender `authorName` bei gleicher `authorId` umgeht
die Anonymisierung nicht mehr — direkte Regression des vormals
dokumentierten N5-Umgehungswegs); `apps/api/test/sync/sync.service.test.ts`
(neuer Block „Kommentar-Autor:innen-Prüfung" — akzeptiert eigene neue
Kommentare, lehnt fremd zugeordnete neue Kommentare in allen drei Stores
ab inklusive verschachtelter Plan-Sets/-Blöcke, lehnt den nachträglichen
`authorId`-Wechsel eines bestehenden Kommentars durch eine andere Person
ab, erlaubt weiterhin das Hinzufügen eines eigenen neuen Kommentars neben
einem fremden bestehenden im selben Datensatz, Stores ohne Kommentare
bleiben unbeeinflusst).

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`packages/shared-types/src/entities.ts:41-50`,
`apps/web/js/modules/comments.js:72`,
`apps/api/src/modules/sync/sync.permissions.ts:91`

```ts
export const CommentSchema = z.object({
  id: z.string().min(1),
  authorName: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
  ...
}).strict();
```

`authorName` wird laut Kommentar „vom Frontend beim Anlegen aus dem
eingeloggten Konto übernommen" (`comments.js:72`: `user?.name || …`) — und
genau dort endet die Prüfung. Serverseitig gibt es weder ein `authorId`
noch einen Abgleich gegen die anfragende Person: `push()` validiert den
Payload gegen `ENTITY_SCHEMAS[store]` und schreibt ihn.

Zwei Konsequenzen:

1. **Identitätsvortäuschung innerhalb des Vereins.** Jedes Vereinsmitglied
   kann per direktem `POST /api/sync/push` einen Kommentar unter einem
   beliebigen Namen hinterlassen. Das betrifft ausdrücklich auch die Rolle
   `athlete`: `plans` steht in `STORE_PERMISSIONS` als `shared`
   (`sync.permissions.ts:91`), also lesend **und schreibend** für alle drei
   Rollen — und Plan-Kommentare (`PlanSchema.comments`, sowie
   `PlainSetSchema.comments` je Satz) leben im selben Datensatz. Ein
   Athletenkonto kann damit einen Trainings-Kommentar im Namen einer
   Trainerin platzieren. Ein Audit-Log, das die tatsächliche Herkunft
   festhielte, existiert nicht (bereits im Vorreview unter N1 als
   Rahmenbedingung benannt).
2. **Die N5-Anonymisierung ist dadurch unzuverlässig.** Das ist in
   `jobs/commentAnonymization.ts` als bekannte Grenze dokumentiert
   (Namensgleichheit, zwischenzeitliche Namensänderung), aber die
   Bewertung dort geht von *versehentlicher* Ungenauigkeit aus. Tatsächlich
   ist der Abgleichsschlüssel **frei wählbar**: wer den eigenen Kommentaren
   einen abweichenden `authorName` gibt, entzieht sie damit dauerhaft der
   eigenen Art.-17-Anonymisierung.

**Empfehlung.** `authorName` serverseitig setzen statt entgegennehmen.
Konkret umsetzbar, ohne das Datenmodell umzubauen:

* `CommentSchema` um ein `authorId: z.string().uuid()` ergänzen und in
  `push()` — analog zur bestehenden `results`-Zeilenprüfung
  (`sync.service.ts:293-307`) — durchsetzen, dass neue/geänderte Kommentare
  `authorId === requester.sub` tragen. Dafür müsste `SyncRequester` um
  die User-ID erweitert werden (steht in `request.user.sub` bereits zur
  Verfügung, wird bislang nur nicht durchgereicht).
* Die Anonymisierung in `commentAnonymization.ts` danach auf `authorId`
  statt auf `authorName` umstellen — damit entfällt zugleich die dort
  dokumentierte Grenze.

Falls das als zu großer Eingriff bewertet wird, ist die Entscheidung
mindestens **explizit zu dokumentieren** — an `CommentSchema` selbst, nicht
nur als Purge-Nebenbemerkung —, damit sie wie N4 des Vorreviews als
bewusster Trade-off erkennbar ist statt als Lücke.

---

## Niedrig

### N1 — Frisch erzeugtes DB-Passwort im Klartext im Terminal/CI-Log — **behoben**

**Fix.** Umgesetzt exakt wie in der Empfehlung beschrieben: Zeile 301
(`scripts/setup-codespace.sh`) gibt jetzt nur noch einen Verweis auf
`apps/api/.env` aus, statt das Passwort selbst zu wiederholen — analog zur
bereits im Vorreview (H1) korrigierten Behandlung des
Superadmin-Passworts direkt darüber.

Kein dedizierter Regressionstest — das Skript läuft nur interaktiv/in CI
gegen eine echte Codespaces-Umgebung und wird nirgends automatisiert
getestet (wie auch der Rest von `setup-codespace.sh`).

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`scripts/setup-codespace.sh:44`, `:296`

```bash
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
...
echo "DB-Passwort (lane1_app, frisch erzeugt): ${DB_PASSWORD}"
```

Für das Superadmin-Passwort wurde genau diese Ausgabe im Vorreview (H1)
entfernt, mit der Begründung, sie lande „in Terminal-Scrollback und
CI-Logs" — für das Datenbank-Passwort steht sie unverändert im selben
Skript. Der Wert steht ohnehin in `apps/api/.env` (dort ist er nötig); die
zusätzliche Ausgabe bringt keinen Nutzen, den ein Hinweis auf die
`.env`-Datei nicht auch böte.

**Empfehlung.** Zeile 296 durch einen Verweis ersetzen („Das erzeugte
DB-Passwort steht in `apps/api/.env` unter `DATABASE_URL`.").

### N2 — Superadmin-Passwort als Kommandozeilenargument (**offen aus Vorreview N6**)

`apps/api/scripts/createSuperAdmin.ts:18-40`, `scripts/setup-codespace.sh:221`

Unverändert offen. `--password=...` landet in `process.argv` und ist für
jeden Prozess auf demselben Host über `ps aux` sichtbar. Neu hinzugekommen
ist, dass `setup-codespace.sh` das interaktiv (und korrekt verdeckt)
eingelesene Passwort anschließend genau so weiterreicht:

```bash
npm run create-superadmin -- --email="${SUPERADMIN_EMAIL}" --password="${SUPERADMIN_PASSWORD}" ...
```

Die sorgfältige `read -s`-Eingabe wird dadurch am letzten Meter wieder
entwertet. Zusätzlich schiebt `npm run -- …` das Argument durch eine
weitere Prozessebene, die es ebenfalls in ihrer Argumentliste trägt.

**Empfehlung.** `createSuperAdmin.ts` das Passwort aus einer
Umgebungsvariablen (`SUPERADMIN_PASSWORD`) oder von `stdin` lesen lassen —
beides ist in `ps aux` unsichtbar — und `--password=` als Fallback mit
einer Warnung beibehalten oder ganz entfernen. Im Skript entsprechend
`SUPERADMIN_PASSWORD="…" npm run create-superadmin -- --email=… --name=…`
aufrufen.

### N3 — E-Mail-Wechsel auf die Adresse eines soft-gelöschten Kontos → 500 statt 409 — **behoben**

**Fix.** Zusammen mit H2 umgesetzt (die Empfehlung dort traf bereits zu:
„wandert diese Prüfung in den neuen E-Mail-Endpunkt"). Der neue
`authService.changeEmail()` (siehe H2) fängt `P2002` beim eigentlichen
`update()`-Aufruf ab und wirft dafür `EmailAlreadyRegisteredError` (409)
— exakt derselbe Fang, den `acceptInvitation()` bereits für denselben
Fall (`athleteId`/`email` eines soft-gelöschten Kontos) verwendet.
`findByEmail()` bleibt zusätzlich als schneller Vorab-Check für den
häufigen Fall (Adresse gehört zu einem aktiven Konto) erhalten — beide
Fänge zusammen decken sowohl den einfachen als auch den hier
ursprünglich gemeldeten Fall ab.

Regressionstests: Der einfache Fall (aktives Konto) unit-getestet in
`apps/api/test/auth/auth.service.test.ts`
(`describe('authService.changeEmail …')`). Der eigentliche N3-Fall
(Adresse gehört einem soft-gelöschten Konto) lässt sich — wie beim
analogen `acceptInvitation()`-Fall — nur gegen einen echten
Unique-Constraint auslösen; neuer Integrationstest in
`apps/api/test-integration/authService.integration.test.ts`
(`describe('authService.changeEmail() — P2002-Regression …')`) gegen eine
echte Postgres-Instanz.

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`apps/api/src/modules/auth/auth.service.ts:486-488`,
`auth.repository.ts:105-107`, `schema.prisma:63`

```ts
if (patch.email && patch.email !== current.email) {
  const emailTaken = await deps.users.findByEmail(patch.email);
  if (emailTaken) throw new EmailAlreadyRegisteredError();
}
```

`findByEmail()` filtert bewusst auf `deletedAt: null` — für eine Adresse,
die einem soft-gelöschten (noch nicht gepurgten) Konto gehört, liefert sie
`null`. Die Prüfung greift also nicht, `User.email` ist in der Datenbank
aber weiterhin `@unique`: Prisma wirft `P2002`, die Fehler-Registry
(`plugins/httpErrorHandler.ts`) kennt diesen Code nicht, die Antwort ist
ein generischer **HTTP 500**.

Dieselbe Konstellation ist in `acceptInvitation()` bereits erkannt und
sauber abgefangen (`auth.service.ts:253-265`, mit ausführlichem Kommentar
zu genau diesem Fall) — in `updateMe()` fehlt der entsprechende Fang.

Nebeneffekt: Die unterscheidbare Antwort (500 vs. 200 vs. 409) ist ein
Orakel dafür, ob eine Adresse zu einem gelöschten Konto gehört. Gering
eingestuft, weil dafür ein gültiges Konto nötig ist und die Auskunft
begrenzt ist.

**Empfehlung.** `updateMe()` denselben `P2002`-Fang wie
`acceptInvitation()` geben (→ `EmailAlreadyRegisteredError`, HTTP 409).
Wird H2 wie empfohlen umgesetzt, wandert diese Prüfung in den neuen
E-Mail-Endpunkt — der Fang gehört dann dorthin.

### N4 — `resetPassword()` invalidiert weitere offene Reset-Tokens nicht — **behoben**

**Fix.** Neue Methode `markAllUsedForUser(userId)` auf
`PasswordResetTokenRepository` (`updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })`
in der Prisma-Implementierung; äquivalente Iteration im In-Memory-Double).
`resetPassword()` ruft sie jetzt anstelle von `markUsed(existing.id)` auf
— deckt das gerade eingelöste Token mit ab (dessen `usedAt` ist an dieser
Stelle noch `null`) UND invalidiert zusätzlich jeden anderen, noch
offenen Reset-Link desselben Kontos. Zusätzlich (wie in der Empfehlung
vorgeschlagen) ruft auch `changePassword()` dieselbe Methode auf: ein
regulärer Passwortwechsel mit Kenntnis des aktuellen Passworts soll einen
zuvor angeforderten, noch offenen „Passwort vergessen"-Link ebenso nicht
überleben lassen.

Regressionstests: `apps/api/test/auth/auth.service.test.ts` — ein Test in
`describe('authService.resetPassword …')` (ein zweiter, noch offener
Reset-Link wird beim Einlösen des ersten ungültig) sowie ein Test in
`describe('authService.changePassword …')` (ein offener Reset-Link wird
durch einen regulären Passwortwechsel invalidiert, inkl. Prüfung, dass
das Token tatsächlich `usedAt` trägt statt nur zufällig fehlzuschlagen).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/modules/auth/auth.service.ts:427-445`

`resetPassword()` markiert das eingelöste Token als verwendet
(`markUsed()`) und widerruft alle Refresh-Tokens — lässt aber **andere,
noch gültige** `PasswordResetToken`-Zeilen desselben Kontos unberührt. Bei
drei angeforderten Resets innerhalb der TTL (`/auth/forgot-password`
erlaubt 3 pro 15 Minuten) bleiben nach dem ersten Einlösen zwei weitere
Links bis zu 60 Minuten lang gültig und führen jeweils erneut zu einem
Passwortwechsel samt Auto-Login.

Das untergräbt den Zweck des Massen-Widerrufs an derselben Stelle: Wer den
Reset gerade wegen eines vermuteten Kompromisses durchführt, hat danach
weiterhin gültige Übernahme-Links im Umlauf.

**Empfehlung.** In `resetPassword()` zusätzlich alle offenen Reset-Tokens
des Kontos als verwendet markieren (analog zu
`refreshTokens.revokeAllForUser()`, eine neue Methode
`markAllUsedForUser(userId)` auf `PasswordResetTokenRepository`).
Naheliegend zusätzlich: dasselbe in `changePassword()`, damit ein
vergessener Reset-Link nach einem regulären Passwortwechsel nicht
weiterlebt.

### N5 — Abbestelltes Modul entfernt bereits synchronisierte Daten nicht vom Gerät — **behoben**

**Fix.** Umgesetzt wie in der Empfehlung beschrieben. `state.js` hält jetzt
zusätzlich zum In-Memory-`current` den zuletzt bekannten
`enabledModules`-Stand dauerhaft in IndexedDB (`meta`-Store) — bewusst
nicht nur im Speicher, da sonst ein Seiten-Reload NACH einer Abbestellung
den Vergleich fälschlich als „erste Sitzung auf diesem Gerät" behandeln
würde, obwohl der volle Altbestand des abbestellten Pakets weiterhin in
der IndexedDB liegt. Eine neue, interne `applyEnabledModules()`-Funktion
läuft an jeder Stelle, an der `enabledModules` vom Server hereinkommt
(`login()`, `restoreSession()`, `resetPassword()`, `changePassword()`,
`changeEmail()`, `setUserLocale()`/`updateProfile()` — Letztere über
`PATCH /api/me`, dessen Antwort laut `MeResponseSchema` ebenfalls
`enabledModules` mitführt): für jedes Paket, das im neuen Stand fehlt,
aber im letzten bekannten noch enthalten war, werden die zugehörigen
lokalen Stores geleert (`db.js: clearStore()`) und der globale Sync-Cursor
zurückgesetzt (neue Funktion `syncClient.js: resetCursor()`) — Letzteres,
weil der Cursor EIN gemeinsamer Wasserstand für alle Stores ist, kein
Reset also ein späteres Wieder-Zubuchen desselben Pakets nicht zuverlässig
erneut befüllen würde (`pull()` liefert ab dem gespeicherten Cursor nur
noch Änderungen, unveränderten Altbestand nie wieder).

`apps/web` lädt ohne Build-Schritt direkt als Browser-ES-Module und kann
`MODULE_PACKAGES` aus `packages/shared-types/src/modules.ts` daher nicht
importieren (dieselbe bereits bestehende Einschränkung wie bei
`router.js: ROUTE_TO_PACKAGE`) — die Paket-zu-Store-Zuordnung ist deshalb
als eigene, im selben Muster kommentierte `MODULE_STORES`-Konstante in
`state.js` dupliziert, inhaltlich deckungsgleich mit
`MODULE_PACKAGES[*].stores`.

Bewusst nicht mit angefasst: bereits in die lokale Sync-Warteschlange
eingereihte, noch nicht übertragene Änderungen an einem soeben
abbestellten Store werden von `clearStore()` mit entfernt (kein
gesonderter Fang für `syncQueue`-Einträge dieses Stores) — sie würden vom
Server ohnehin abgelehnt (`canWrite()` sperrt den Store bereits), laufen
also so oder so ins Leere. Ein seltener Grenzfall (Abbestellung fällt
exakt mit einer noch unsynchronisierten Offline-Änderung genau dieses
Stores zusammen), passend zur „Niedrig"-Einstufung nicht weiter vertieft.

Regressionstests: `apps/web/test/state.moduleDeprovisioning.test.js` — der
allererste Login auf einem Gerät räumt nichts weg (kein bekannter
vorheriger Stand), eine erkannte Abbestellung leert genau die Stores des
entfernten Pakets und setzt den Cursor genau einmal zurück, eine
Erweiterung/unveränderte Paketliste rührt nichts an, dieselbe Erkennung
funktioniert auch über `restoreSession()` (Seiten-Reload) hinweg statt nur
innerhalb derselben Sitzung, und ein Paket ohne eigene Stores (`stats`)
setzt zwar den Cursor zurück, ruft aber `clearStore()` nicht auf.

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`apps/api/src/modules/sync/sync.service.ts:439`, `apps/web/js/syncClient.js`

Das Modul-Gating ist serverseitig korrekt durchgesetzt: `canRead()` filtert
beim Pull, `canWrite()` blockiert beim Push, `requesterFrom()`
(`sync.route.ts:44-51`) lädt `enabledModules` bei **jedem** Request frisch
aus der Datenbank statt aus dem JWT — eine Abbestellung wirkt also sofort
und nicht erst nach Token-Ablauf. Das ist sauber gelöst.

Was fehlt: Deaktiviert ein Superadmin ein Paket, werden die **bereits
gepullten** Daten auf den Geräten nicht entfernt. Der Filter unterdrückt
nur künftige Changes; es entsteht kein Tombstone, und `wipeAll()` läuft
ausschließlich beim Logout (`state.js:131`). Ein Verein, der z. B. das
`athletes`-Paket abbestellt, hat den vollständigen Athletenstamm
(inkl. `birthdate` Minderjähriger auf Trainer:innen-Geräten, siehe M2 des
Vorreviews) unbefristet weiter in der IndexedDB jedes Geräts liegen —
über die UI nicht mehr erreichbar, über die DevTools sehr wohl.

Sowohl als Lizenzdurchsetzung („zubuchbare Module", `docs/todo.md`) als
auch unter Datenminimierung ist das die schwächere Hälfte des Features.
Niedrig eingestuft, weil kein neuer Zugriff entsteht — die Daten waren zum
Zeitpunkt der Buchung legitim auf dem Gerät.

**Empfehlung.** Beim Erkennen einer Modul-Abbestellung (das Frontend
bekommt `enabledModules` bei Login/Refresh/`getMe` ohnehin geliefert und
kann sie gegen den letzten bekannten Stand vergleichen) die lokalen Stores
der betroffenen Pakete leeren — `MODULE_PACKAGES[key].stores` benennt sie
bereits eindeutig, und `db.js` hat mit `wipeAll()` die passende Mechanik in
gröberer Form. Den Sync-Cursor dabei zurücksetzen, damit ein späteres
Wieder-Zubuchen den Bestand erneut vollständig zieht.

### N6 — `GET /api/users/trainers` liefert vollständige Nutzerdatensätze — **behoben**

**Fix.** Umgesetzt wie in der Empfehlung beschrieben: `listMembers()`
(`auth.service.ts`) nimmt jetzt zusätzlich einen verpflichtenden
`project`-Parameter entgegen und wendet ihn nach Filter/Sortierung auf
jeden Datensatz an, statt intern immer `toPublicUser()` zu fest zu
verdrahten. `listClubMembers()` (bedient `GET /api/users`, braucht
weiterhin die vollständige Ansicht) übergibt `project: toPublicUser`;
`listAssignableTrainers()` (bedient `GET /api/users/trainers`) übergibt
stattdessen `project: (u) => ({ id: u.id, name: u.name, role: u.role })`
— exakt die drei Felder, die das Dropdown in `modules/actionItems.js`
braucht, ohne E-Mail-Adresse, Einwilligungs-Metadaten oder sonstige
DSGVO-Nachweisdaten.

Regressionstests: `apps/api/test/auth/auth.route.test.ts` — ein Test
bestätigt, dass `GET /api/users/trainers` ausschließlich `id`/`name`/`role`
liefert und insbesondere kein `email`-Feld enthält.

Ursprünglicher Befund, Fundstellen zum Zeitpunkt der Analyse:
`apps/api/src/modules/auth/auth.service.ts:545-552`, `auth.route.ts:190-197`

Der Endpunkt bedient laut Kommentar ausschließlich ein Dropdown zur
Auswahl der zuständigen Person für ein Handlungsfeld
(`modules/actionItems.js`) — es werden also `id` und `name` gebraucht.
Geliefert wird `toPublicUser()`, also der komplette `UserRecord` minus
`passwordHash`: E-Mail-Adresse, `athleteId`, `consentGivenAt`,
`consentVersion`, `deletedAt`, `locale`, `clubId`. Zugänglich für jede
Rolle `trainer` (nicht nur `admin`).

Kein Mandantenbruch — alles bleibt innerhalb des eigenen Vereins, und
`listByClub()` filtert `deletedAt: null` — aber die Einwilligungs-Metadaten
(DSGVO-Nachweisdaten) haben in einem Dropdown-Endpunkt nichts verloren.
Dieselbe Beobachtung gilt abgeschwächt für `GET /api/users`, das
allerdings tatsächlich eine Mitgliederverwaltung bedient und dort mehr
Felder braucht.

**Empfehlung.** Für `/api/users/trainers` eine eigene Projektion
(`{ id, name, role }`) statt `toPublicUser()`. `listMembers()`
(`auth.service.ts:187-195`) nimmt bereits `filter`/`compare` entgegen —
ein optionaler `project`-Parameter fügt sich dort natürlich ein.

### N7 — API lauscht fest auf `0.0.0.0:3000`, nicht konfigurierbar — **behoben**

**Fix.** Neue Umgebungsvariable `HOST` (`apps/api/src/config/env.ts`,
Default `127.0.0.1`) — `index.ts` verwendet jetzt `env.HOST` statt des
fest verdrahteten `'0.0.0.0'`. Der Default passt zu jedem dokumentierten,
nicht-containerisierten Deployment (Nginx co-lokalisiert, siehe H1).
Container-Betrieb setzt `HOST=0.0.0.0` explizit dort, wo es korrekt ist —
sowohl als `ENV HOST=0.0.0.0` im `Dockerfile` (Laufzeit-Stage, wirkt auch
bei einem einfachen `docker run` ohne Compose) als auch redundant/
dokumentierend in `docker-compose.yml`. Gemeinsam mit **H1** umgesetzt, da
beide dieselbe Betriebsannahme (co-lokalisierter Reverse Proxy)
betreffen — in Produktion ohne gesetztes `TRUSTED_PROXY_IPS` bricht der
Start jetzt ohnehin ab (siehe dortiger **Fix**-Abschnitt), ein zusätzlicher
Zwang für `HOST` wäre daher redundant; ein sicherer Default genügt hier.

Regressionstests: `apps/api/test/env.test.ts` (Default `127.0.0.1`,
überschreibbar z. B. auf `0.0.0.0`).

Ursprünglicher Befund, Fundstelle zum Zeitpunkt der Analyse:
`apps/api/src/index.ts:10`

```ts
await app.listen({ host: '0.0.0.0', port: env.PORT });
```

Der Host ist fest verdrahtet und **nicht** über `env.ts` konfigurierbar,
obwohl jedes andere Betriebsdetail dort liegt. In allen dokumentierten
Aufbauten steht Nginx davor und spricht die API ausschließlich über
`127.0.0.1:3000` an — auf allen übrigen Interfaces wird der Port also
geöffnet, ohne dass ihn dort jemand braucht.

**Ausdrücklich mitigiert**, deshalb niedrig eingestuft: Alle vier
Deployment-Anleitungen sperren den Port zuverlässig ab — `deployment.md`
mit Hetzner-Cloud-Firewall **plus** `ufw allow OpenSSH/80/443`
(Abschnitte 2.2 und 4.3), `deployment-raspberry-pi.md` mit demselben
`ufw`-Regelsatz und ohne Portweiterleitung im Router (Abschnitt 4.2),
`deployment-macos.md` exponiert grundsätzlich nichts nach außen, und in
`deployment-github-codespaces.md` wird ausschließlich Port **8080**
(Nginx) im Ports-Tab weitergeleitet, nie 3000. Der `0.0.0.0`-Bind ist
damit in keinem dokumentierten Aufbau von außen erreichbar.

Es bleibt eine reine Tiefenverteidigungs-Lücke: Sie trägt erst, wenn eine
Firewall-Regel einmal fehlt oder ein anderer Aufbau gewählt wird. Wer die
API dann direkt erreicht, umgeht die Frontend-CSP (`script-src 'self'`,
`connect-src 'self'`, ausschließlich von Nginx gesetzt und im Vorreview
mehrfach als mildernder Faktor herangezogen) sowie die TLS-Terminierung —
Access- und Refresh-Tokens gingen im Klartext über das Netz.
`docker-compose.yml:54-55` veröffentlicht den Port ebenfalls ungebunden
(`"3000:3000"`) — anders als der Postgres-Dienst direkt darüber, der mit
`"127.0.0.1:5432:5432"` und ausdrücklicher Begründung korrekt
eingeschränkt ist; für einen reinen Entwicklungsaufbau ist das
vertretbar, die Inkonsistenz zwischen beiden Diensten fällt aber auf.

**Empfehlung.** `HOST` als Env-Variable ergänzen (Default `127.0.0.1`,
nicht `0.0.0.0`) und in `index.ts` verwenden; im Container-Betrieb
(`Dockerfile`/`docker-compose.yml`) `HOST=0.0.0.0` explizit setzen, wo es
korrekt ist. Das macht die heute rein dokumentarisch abgesicherte
Annahme („davor steht immer ein Reverse Proxy") im Code selbst
durchsetzbar. Sinnvoll gemeinsam mit dem `TRUSTED_PROXY_IPS`-Wert aus
**H1** umzusetzen — beide beschreiben dieselbe Betriebsannahme.

---

## Geprüft und ohne Befund

Folgende Bereiche wurden gezielt und unabhängig vom Vorreview untersucht
und sind sauber:

* **Mandantentrennung (`clubId`).** Erneut vollständig nachvollzogen:
  `findById()` scoped (`sync.gateway.ts:156`), `update()`/`softDelete()`
  mit `where: { id, clubId }` — auch innerhalb der Transaktion in
  `applyAndMarkProcessed()`. Das Payload-Nachladen in Schritt 3 von
  `listChangedSince()` filtert bewusst nicht selbst auf `clubId`, bezieht
  seine IDs aber ausschließlich aus der bereits gescopten
  Wasserstands-Abfrage (Schritt 1) — kein Leck. `SyncTombstone` ebenfalls
  clubId-gescoped.
* **Modul-Gating (neu).** `canRead()`/`canWrite()` verlangen **zusätzlich**
  zur Rollenprüfung ein gebuchtes Paket; `STORE_MODULE_MAP` wird aus
  `MODULE_PACKAGES` invertiert statt doppelt gepflegt; ein Verein ohne
  Eintrag bzw. ein fehlgeschlagener Club-Lookup ergibt
  `enabledModules: []` und damit **kein** Zugriff (`sync.route.ts:50`) —
  fail-closed. Frontend-seitig übergeben alle drei Aufrufer in `shell.js`
  konsequent `getEnabledModules()`, das ohne Sitzung `[]` liefert; der
  permissive Default `MODULE_KEYS` in `router.js:51` ist nur für Demo/Tests
  erreichbar. `PATCH /api/clubs/:id` ist auf `superadmin` beschränkt
  (Route **und** `ACTION_ROLES.updateClub`), `UpdateClubRequestSchema`
  akzeptiert ausschließlich bekannte Modul-Keys.
* **Rollen-/Zeilen-Scoping für `athlete`.** `scopeChangeForAthlete()`
  verhält sich in allen geprüften Konstellationen korrekt, einschließlich
  `athleteId === null` (fremder Zweig bzw. Ausfiltern) und der
  Eigentümer-Unterscheidung beim Store `athletes`. Die
  `results`-Zeilenprüfung in `push()` deckt CREATE, UPDATE und DELETE ab
  und prüft sowohl den bestehenden Datensatz als auch den Payload.
* **Fremdschlüssel über Vereinsgrenzen.** `assertForeignKeysWithinClub()`
  deckt alle Referenzfelder inkl. der rekursiv verschachtelten
  `exerciseId` in `templates.sets`/`plans.days[].sets` ab und liefert für
  „existiert nicht" und „gehört fremdem Verein" bewusst dieselbe Meldung.
  Die Reihenfolge der `PUSH_GUARDS` ist korrekt (FK-Prüfung nach der
  clubId-Prüfung, vor jedem Schreibzugriff).
* **Mass Assignment.** Alle Entity-Schemas `.strict()`; `push()` verwendet
  durchgängig `ctx.validatedPayload`, nie den Rohwert;
  `createdAt`/`updatedAt` werden vor jeder Verwendung entfernt.
  `UpdateMeRequestSchema` kann weder `role` noch `clubId` setzen. (Dass es
  zum Analysezeitpunkt zusätzlich `email` setzen konnte, war Befund
  **H2** — kein Mass Assignment, sondern eine bewusst vorgesehene
  Funktion ohne ausreichende Absicherung, inzwischen behoben und `email`
  seither kein Feld dieses Schemas mehr.)
* **Privilege Escalation über Einladungen.** `InvitationRoleSchema`
  schließt `superadmin` aus; `assertCanIssueRole()` erlaubt
  Admin-Einladungen nur `superadmin`; `resolveTargetClubId()` ignoriert
  eine mitgeschickte fremde `clubId` für Rolle `admin`; `athleteId` wird
  gegen den Zielverein geprüft. Rolle/Verein stammen bei
  `acceptInvitation()` ausschließlich aus dem serverseitigen
  Einladungsdatensatz.
* **SQL Injection.** Alle fünf `$queryRaw`/`$executeRaw`-Stellen
  (`profile.repository.ts:96`, `erasure.repository.ts:126/172/190/202`)
  sind Tagged Templates mit parametrisierten Werten — auch die
  `jsonb_path_exists()`-Aufrufe übergeben den Namen korrekt als
  `$name`-Variable über einen gebundenen `vars`-Parameter statt per
  String-Konkatenation in den Pfadausdruck.
* **XSS im Frontend.** Alle `innerHTML`-Stellen erneut einzeln geprüft:
  `dom.js:icon()` ist ausdrücklich auf konstante SVG-Icons beschränkt,
  `ui.js:37` und `authScreens.js` (fünfmal `= ''`, reines Leeren) sind
  harmlos, `charts.js` escapt Element-Inhalte über `esc()` und
  interpoliert in **Attribute** ausschließlich intern erzeugte Zahlen und
  Farbkonstanten (`b.color` wird von keinem Aufrufer aus Daten gespeist —
  `stats.js`/`times.js` übergeben durchgängig `var(--…)`-Literale). Alles
  Übrige läuft über `el()` (`createTextNode()`/`setAttribute()`). Kein
  `eval`, kein `new Function`, kein `document.write`, kein
  `insertAdjacentHTML`.
* **Prototype Pollution.** `isKnownStore()` nutzt `in`, wird aber nur mit
  Zod-validierten Enum-Werten aufgerufen. Der Bibliotheks-Import
  (`libraryTransfer.js`) baut jeden Datensatz aus explizit aufgezählten
  Feldern neu auf und setzt `clubId` aus der eigenen Sitzung statt aus der
  Datei; der Server validiert zusätzlich `.strict()`.
* **Service Worker.** `/api/`, `/auth/` und `/admin` sind vom Caching
  ausgenommen, jeweils relativ zum tatsächlichen Registrierungs-Scope;
  `fetchAndCache()` speichert nur `res.type === 'basic'`.
* **CORS/Header.** `CORS_ORIGIN='*'` wird in Produktion beim Start
  abgelehnt; Helmet mit vollständig expliziter Default-Deny-CSP und
  `useDefaults: false`; `frameguard: deny`.
* **Token-Handling.** RS256 mit prozessweit gecachten Schlüsseln;
  Refresh-/Einladungs-/Reset-Tokens sind opak (48 bzw. 32 Byte aus
  `randomBytes`), serverseitig nur als SHA-256-Hash gespeichert;
  Rotation mit Reuse-Detection und Massen-Widerruf; clientseitiges
  Single-Flight verhindert, dass die App diesen Widerruf selbst auslöst.
  Die Reset-TTL (60 min) ist angemessen kurz gewählt.
* **User-Enumeration.** `login()` gleicht die Laufzeit über einen
  Dummy-argon2id-Hash an; `/auth/forgot-password` antwortet immer generisch
  und stößt den Mailversand bewusst ohne `await` an, damit die
  SMTP-Latenz kein Seitenkanal wird; die vier Einladungs-Fehlerzustände
  laufen in der Vorschau in eine gemeinsame 410-Antwort.
* **Abhängigkeiten/CI.** `npm audit --omit=dev --audit-level=high` ist als
  blockierender Schritt vorhanden und korrekt begründet; der Dev-Audit
  läuft informativ daneben. Typecheck deckt `test/`, `test-integration/`,
  `scripts/` und `prisma/` mit ab; Integrationstests laufen gegen echtes
  Postgres, wo das clubId-Scoping tatsächlich als SQL-`WHERE` greift.
* **Container.** Multi-Stage-Build, Laufzeit-Image ohne
  Dev-Abhängigkeiten, `USER node`.

---

## Empfohlene Reihenfolge

1. ~~**H1** — `trustProxy` auf die konkrete Proxy-Adresse setzen und den
   Regressionstest um den Spoofing-Fall erweitern.~~ **Behoben**
   (`TRUSTED_PROXY_IPS`, siehe dortiger **Fix**-Abschnitt) — zusammen mit
   **N7** umgesetzt, da beide dieselbe Betriebsannahme betreffen.
2. ~~**H2** — E-Mail-Wechsel hinter `currentPassword` legen (Schritt 1 der
   Empfehlung).~~ **Behoben** (`POST /api/me/email`, siehe dortiger
   **Fix**-Abschnitt) — bewusst ohne Double-Opt-In und Benachrichtigung
   der alten Adresse (Schritte 2/3 der ursprünglichen Empfehlung), da
   Schritt 4 dort Schritt 1 allein bereits als „die entscheidende Sperre"
   benannt hatte. **N3** direkt mitbehoben (wandert wie empfohlen in den
   neuen Endpunkt).
3. ~~**M1** — `Invitation.email` in den Hard-Purge aufnehmen; direkte
   Analogie zum bereits geleisteten N5-Fix, mit stabilerer Zuordnung.~~
   **Behoben** (`ANONYMIZED_INVITATION_EMAIL`, siehe dortiger
   **Fix**-Abschnitt).
4. ~~**M2** — `authorId` einführen oder die Entscheidung an `CommentSchema`
   explizit dokumentieren.~~ **Behoben** (`CommentSchema.authorId` +
   `sync.commentAuthorship.ts`, siehe dortiger **Fix**-Abschnitt) —
   zusammen mit **N6** umgesetzt.
5. ~~**N6** — eigene Projektion für `/api/users/trainers`.~~ **Behoben**
   (`listMembers()`-Parameter `project`, siehe dortiger **Fix**-Abschnitt).
6. ~~**N1** — Verweis auf `apps/api/.env` statt DB-Passwort-Ausgabe.~~
   **Behoben** (siehe dortiger **Fix**-Abschnitt).
7. ~~**N5** — lokale Stores eines abbestellten Pakets leeren, Sync-Cursor
   zurücksetzen.~~ **Behoben** (`applyEnabledModules()` in `state.js`,
   siehe dortiger **Fix**-Abschnitt).
8. **N2** bei nächster Berührung — letzter verbleibender Befund.
   ~~**N3**~~/~~**N4**~~/~~**N7**~~ **Behoben** (siehe jeweiliger
   **Fix**-Abschnitt).
