# Sicherheitsreview — Lane 1 Monorepo (28. August 2026)

Umfang dieser Prüfung: **Server- und Datenbankkonfiguration** sowie alle
Wege zur **Kontoübernahme**. Betrachtet wurden `docker-compose.yml`,
`.devcontainer/*`, `apps/api/Dockerfile`, `apps/api/.env.example`,
`apps/api/src/config/env.ts`, `apps/api/src/plugins/*`,
`apps/api/prisma/*`, `scripts/setup-codespace.sh`, `docs/deployment*.md`,
`.github/workflows/*` sowie der vollständige Authentifizierungs-/
Einladungspfad (`modules/auth/*`, `modules/invitations/*`, `auth/*`).

**Abgrenzung.** Eigenständige Prüfung, keine Fortschreibung von
`docs/security-review-2026-08-27.md`. Die dort als behoben markierten
Punkte H1 (`TRUSTED_PROXY_IPS`), H2 (E-Mail-Wechsel nur mit aktuellem
Passwort), N3, N4, N6 und N7 wurden am aktuellen Code nachvollzogen und
sind tatsächlich behoben. Der dort offene Befund N2 ist weiterhin offen
und erscheint hier als **M1**.

**Anlass.** Vorgabe an dieses Review war unter anderem die Annahme, das
Superadmin-Einrichtungsskript werde „nach dem ersten Lauf gelöscht".
Diese Annahme wird in **M2** gesondert bewertet: sie trägt als
Sicherheitsmaßnahme nicht, weil sie weder die Ursache von M1 beseitigt
noch der einzige Weg ist, an ein Superadmin-Konto zu gelangen (siehe
**H1**) — kostet aber den einzigen legitimen Wiederherstellungspfad.

**Update (28. August 2026, im Anschluss an dieses Review).** In sechs
Schritten direkt im Anschluss an diese Prüfung behoben — siehe die
jeweiligen **Fix**-Abschnitte: zuerst **H1**, danach **H2**, dessen
Empfehlung 3 (separate `JWT_PRIVATE_KEY_FILE`) als eigener Nachtrag,
danach gemeinsam **M1** und **M2** (dieselbe Datei,
`createSuperAdmin.ts`, gemeinsam gehärtet und gegen eine echte
PostgreSQL-Instanz end-to-end verifiziert), zuletzt gemeinsam **N1**
bis **N3**. Bei **N2** stellte sich beim Beheben heraus, dass der
Befund schwerwiegender war als beim ursprünglichen Review angenommen —
siehe den entsprechenden Nachtrag dort: der dokumentierte Startweg
sämtlicher vier Deployment-Anleitungen, `npm run dev`, `npm run
create-superadmin` und der Purge-Cronjob luden `apps/api/.env`
tatsächlich nie, empirisch als reproduzierbarer Absturz bestätigt (nicht
nur als am Docker-Compose-Weg vorbeigedachte Randnotiz). Damit sind zum
Zeitpunkt dieses Updates **alle** Befunde dieses Reviews behoben,
einschließlich der ursprünglich nur mittelfristig empfohlenen
Schlüssel-Datei-Trennung (H2, Empfehlung 3).

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| H1 | Seed-Skript legt einen **Superadmin mit im Repository veröffentlichtem Passwort** an — ohne jede `NODE_ENV`-Absicherung, im README als auszuführender Befehl dokumentiert | `apps/api/prisma/seed.ts:59-62,156-197`, `README.md:215-223` | Hoch — **behoben** |
| H2 | `apps/api/.env` (enthält `JWT_PRIVATE_KEY`) wird ohne Dateirechte-Härtung angelegt → weltlesbar → **Fälschung beliebiger Access Tokens** | `scripts/setup-codespace.sh:123`, `docs/deployment.md:261-315` | Hoch — **behoben** |
| M1 | Superadmin-Passwort als Kommandozeilenargument (**offen aus Vorreview N2/N6**) | `apps/api/scripts/createSuperAdmin.ts:11,18-40`, `scripts/setup-codespace.sh:226` | Mittel — **behoben** |
| M2 | „Skript nach dem ersten Lauf löschen" ist keine wirksame Zugangskontrolle, entfernt aber den einzigen Wiederherstellungspfad | `apps/api/scripts/createSuperAdmin.ts:44-60` | Mittel — **behoben** |
| N1 | Anwendungsrolle `lane1_app` besitzt dauerhaft volle DDL-Rechte (`GRANT ALL`) | `docs/deployment.md:196-202`, `scripts/setup-codespace.sh:73-76` | Niedrig — **behoben** |
| N2 | Kein `.env`-Loader im Laufzeitpfad des Servers (weder `dotenv` noch `--env-file`) | `apps/api/src/index.ts:6`, `apps/api/package.json` | Niedrig — **behoben** |
| N3 | Port 5432 wird im Codespace mit fest im Repository stehendem Passwort weitergeleitet | `.devcontainer/devcontainer.json:22-27`, `docker-compose.yml:8-10` | Niedrig — **behoben** |

---

## Hoch

### H1 — Seed-Skript legt einen Superadmin mit veröffentlichtem Passwort an — **behoben**

**Ort.** `apps/api/prisma/seed.ts:59-62` (Daten), `:156-197` (`main()`),
`README.md:215-223` (Dokumentation), `apps/api/package.json:"prisma:seed"`.

**Sachverhalt.** `buildDemoData()` definiert vier Demo-Konten mit
identischem, im Repository im Klartext stehendem Passwort — darunter ein
**Superadmin ohne Vereinsbindung**:

```ts
const superAdminUser = { …, role: 'superadmin', clubId: null,
  email: 'superadmin@example.org', password: 'ChangeMe123!' };
const adminUser     = { …, role: 'admin',   email: 'admin@example.org',        password: 'ChangeMe123!' };
const trainerUser   = { …, role: 'trainer', email: 'sabine.reuter@example.org', password: 'ChangeMe123!' };
const athleteUser   = { …, role: 'athlete', email: 'mara.vogel@example.org',   password: 'ChangeMe123!' };
```

`main()` schreibt diese Konten unverändert in die Datenbank, auf die
`DATABASE_URL` gerade zeigt. Es gibt **keine Prüfung auf `NODE_ENV`**,
keine Rückfrage und keinen Hinweis darauf, dass der Befehl nur gegen eine
Wegwerf-Datenbank laufen darf. Das `console.log` am Ende nennt lediglich
das Admin-Konto („bitte nach dem ersten Login ändern") — der weit
kritischere Superadmin wird gar nicht erst erwähnt.

Die Ausführbarkeit auf einem Produktivserver ist gegeben, nicht
theoretisch:

* `README.md:222` dokumentiert `npm run prisma:seed --workspace=apps/api`
  ohne jede Umgebungs-Einschränkung, im selben Abschnitt wie die
  regulären Migrationsbefehle.
* Alle Deployment-Anleitungen installieren mit `npm install`
  (`docs/deployment.md:255`, `:652`) — also **inklusive**
  `devDependencies`, womit das für den Seed nötige `tsx` auf dem
  Produktivserver vorhanden ist.
* `apps/api/.env` mit der Produktions-`DATABASE_URL` liegt zu diesem
  Zeitpunkt bereits im Arbeitsverzeichnis.

**Auswirkung.** Ein einziger, dokumentierter und plausibel wirkender
Befehl erzeugt auf der Produktivinstanz ein Superadmin-Konto, dessen
Zugangsdaten öffentlich im Repository stehen. Die Rolle `superadmin` ist
die höchste des Systems: sie darf Vereine anlegen und bearbeiten
(`POST/PATCH /api/clubs`), Admin-Einladungen für **jeden** Verein
ausstellen (`invitations.service.ts:assertCanIssueRole`), alle Vereine
und deren Mitgliederzahlen einsehen (`listClubs`) und über
`GET /api/users?clubId=…` die Mitgliederliste **jedes beliebigen**
Vereins abrufen. Damit ist die gesamte einladungsbasierte Registrierung —
die tragende Sicherheitsentscheidung dieses Systems — vollständig
ausgehebelt, und zwar mandantenübergreifend.

Dieser Befund unterläuft zugleich die Annahme, `createSuperAdmin.ts`
lasse sich nach dem ersten Lauf gefahrlos löschen (siehe **M2**): das
Seed-Skript ist ein zweiter, deutlich schlechter abgesicherter Weg zu
demselben Ergebnis und bleibt vom Löschen des einen Skripts unberührt.

**Empfehlung.**

1. `main()` in `seed.ts` bricht ab, sobald `NODE_ENV === 'production'`
   ist — analog zu den bestehenden Produktions-Prüfungen in
   `config/env.ts` mit klarer Fehlermeldung. Zusätzlich einen expliziten
   Bestätigungsschalter (z. B. `--yes-i-know-this-is-demo-data`)
   verlangen, damit ein versehentlicher Lauf gegen die falsche
   `DATABASE_URL` auch außerhalb von `NODE_ENV=production` auffällt.
2. Den **Superadmin vollständig aus den Demo-Daten entfernen**. Er wird
   für die fachliche Demo (ein Verein, Athlet:innen, Pläne) nicht
   gebraucht, und für den legitimen Bootstrap existiert bereits
   `scripts/createSuperAdmin.ts`.
3. Das gemeinsame Klartext-Passwort durch einen bei jedem Lauf zufällig
   erzeugten Wert ersetzen, der nur in der Skriptausgabe erscheint.
4. `README.md:215-223` um einen unmissverständlichen Warnhinweis
   ergänzen („nur gegen eine leere Entwicklungsdatenbank").

**Fix.** `apps/api/prisma/seed.ts`: `main()` bricht per neuer
`assertSafeToSeed()` in zwei unabhängigen Schritten ab — erstens
unbedingt bei `NODE_ENV=production`, zweitens (auch außerhalb von
Produktion, als Schutz gegen eine versehentlich falsche `DATABASE_URL`)
ohne die Bestätigung `SEED_CONFIRM=yes-demo-data`. Das gemeinsame,
fest im Quellcode stehende `'ChangeMe123!'` ist durch ein bei jedem
Lauf frisch erzeugtes Zufallspasswort (`randomDemoPassword()`, 128 Bit
Entropie) ersetzt, das ausschließlich in der Konsolenausgabe des
jeweiligen Laufs erscheint — die Ausgabe nennt jetzt zusätzlich alle
vier Demo-Logins statt nur des Admin-Kontos, da der Superadmin-Zugang
sonst nach dem Lauf nirgends mehr nachlesbar wäre. `README.md:215-230`
trägt einen unübersehbaren Warnhinweis und den aktualisierten,
`SEED_CONFIRM` einschließenden Befehl.

**Abweichung von Empfehlung 2** (Superadmin vollständig aus den
Demo-Daten entfernen): nicht umgesetzt.
`test/prisma/seedData.test.ts:26-30` verlangt ausdrücklich „genau ein
Superadmin-Konto, dessen clubId null ist" als Teil der geprüften
referenziellen Integrität von `buildDemoData()` — ein Entfernen hätte
diesen bestehenden, bewusst so geschriebenen Test gebrochen. Die beiden
Ablauf-Sperren plus das nicht mehr vorhersagbare Passwort schließen die
eigentliche Lücke (ein auf einer echten Instanz reproduzierbares,
öffentlich bekanntes Superadmin-Passwort) ebenso wirksam, ohne den
Demo-Datensatz selbst anzutasten. Per `npm test`
(`test/prisma/seedData.test.ts`) sowie `npm run typecheck` und
`npm run lint` in `apps/api` bestätigt; die beiden neuen Abbruchpfade
wurden zusätzlich manuell gegen einen echten `tsx prisma/seed.ts`-Lauf
verifiziert (Abbruch bei `NODE_ENV=production`, Abbruch ohne
`SEED_CONFIRM`, Durchlauf bis zum — mangels lokaler Datenbank erwarteten
— Verbindungsfehler, sobald beide Bedingungen erfüllt sind).

### H2 — `apps/api/.env` mit `JWT_PRIVATE_KEY` wird weltlesbar angelegt — **behoben**

**Ort.** `scripts/setup-codespace.sh:123-153`,
`docs/deployment.md:261-315`, analog `deployment-raspberry-pi.md` /
`deployment-macos.md`.

**Sachverhalt.** `apps/api/.env` enthält im Produktivbetrieb beides: das
Datenbank-Passwort (`DATABASE_URL`) **und** den privaten RS256-Schlüssel
(`JWT_PRIVATE_KEY`), mit dem sämtliche Access Tokens signiert werden. An
keiner Stelle werden die Dateirechte eingeschränkt:

* `setup-codespace.sh:123` schreibt die Datei per `cat >"$ENV_FILE"` —
  es gilt die Standard-`umask` (üblich `022`), die Datei entsteht also
  mit Modus `0644`.
* `docs/deployment.md:263` legt sie per `cp apps/api/.env.example
  apps/api/.env` an — ebenfalls `0644`.
* In **keiner** der vier Deployment-Anleitungen folgt ein `chmod 600`.

Der Kontrast innerhalb derselben Dokumente ist deutlich: die temporären
PEM-Dateien werden sorgfältig wieder gelöscht („damit der private
Schlüssel nicht zusätzlich unverschlüsselt auf der Platte liegt",
`deployment.md:311-315`), und `~/.pgpass` wird ausdrücklich mit
`chmod 600` geschützt (`deployment.md:585`) — ausgerechnet die Datei, die
**denselben** privaten Schlüssel dauerhaft aufbewahrt, bleibt
ungeschützt.

**Auswirkung.** Wer `apps/api/.env` lesen kann — jedes andere
Benutzerkonto auf dem Server, jeder unter fremder Kennung laufende
Prozess, jedes Backup ohne eigene Rechteprüfung, jeder Web- oder
Log-Pfad, der versehentlich das Projektverzeichnis ausliefert — erhält
den privaten Signaturschlüssel. Damit lässt sich ein Access Token mit
**beliebigem `sub` und `role: "superadmin"`** selbst ausstellen.

Dass ein solches Token vollständig akzeptiert wird, ist keine Annahme,
sondern dokumentiertes Verhalten: `plugins/authenticate.ts:9-26` hält
ausdrücklich fest, dass ausschließlich Signatur und Gültigkeit geprüft
werden und **nie** die Datenbank befragt wird. Es gibt also keine
Sitzung, die widerrufen werden könnte, keinen Login-Versuch, der ein
Rate-Limit auslöst (`auth.route.ts:52-61`), keinen fehlgeschlagenen
Passwortvergleich und keinen Logeintrag. Die Übernahme ist damit
vollständig, sofort wirksam und praktisch unsichtbar — und sie umgeht
sämtliche Schutzmaßnahmen, die die Vorreviews für den Token-Diebstahl
aufgebaut haben (Reuse-Detection in `refresh()`, Passwortpflicht bei
`changePassword`/`changeEmail`).

Das Datenbank-Passwort in derselben Datei ist der zweite, unabhängige
Teil desselben Befunds.

**Empfehlung.**

1. In `setup-codespace.sh` unmittelbar vor dem Schreiben `umask 077`
   setzen bzw. direkt nach dem `cat`-Heredoc `chmod 600 "$ENV_FILE"`
   ausführen (der Fall „Datei existiert bereits" sollte die Rechte
   ebenfalls korrigieren).
2. In allen vier Deployment-Anleitungen `chmod 600 apps/api/.env` als
   eigenen, verpflichtenden Schritt direkt hinter das Anlegen der Datei
   aufnehmen — mit derselben Begründung, die dort bereits bei `~/.pgpass`
   steht.
3. Mittelfristig erwägen, `JWT_PRIVATE_KEY` aus der `.env` in eine
   separate, ausschließlich vom Dienstkonto lesbare Datei zu ziehen
   (`JWT_PRIVATE_KEY_FILE`), damit Schlüssel und übrige Konfiguration
   nicht dieselbe Rechtestufe teilen.
4. Nach dem Beheben den vorhandenen Schlüssel als kompromittiert
   behandeln und rotieren; ein Wechsel von `JWT_PRIVATE_KEY`/
   `JWT_PUBLIC_KEY` invalidiert alle laufenden Access Tokens, die
   Refresh Tokens bleiben gültig.

**Fix.** `scripts/setup-codespace.sh` führt nach dem Anlegen-/
Übersprungen-Zweig (Schritt 6) unbedingt `chmod 600 "$ENV_FILE"` aus —
nicht nur im „gerade neu geschrieben"-Zweig, sondern auch dann, wenn die
Datei aus einem früheren Lauf bereits vorhanden war, damit ein erneuter
Lauf auch die Rechte einer vor dieser Korrektur angelegten Datei
nachträglich schließt. Alle vier Deployment-Anleitungen
(`deployment.md`, `deployment-raspberry-pi.md`, `deployment-macos.md`,
`deployment-github-codespaces.md`) tragen jetzt `chmod 600
apps/api/.env` als eigenen Befehl direkt hinter dem `cp`/vor dem `nano`,
mit derselben Begründung, die dort bereits bei `~/.pgpass` steht, und
einem Verweis auf `authenticate.ts`, der erklärt, warum ein kompromit­
tierter Schlüssel spurlos zur Kontoübernahme führt. Empfehlung 1
(`umask 077` statt/zusätzlich zu `chmod`) wurde bewusst NICHT zusätzlich
umgesetzt — ein globales `umask` im Skript hätte auch alle anderen in
diesem Lauf angelegten Dateien (Log-Ausgaben, `pm2`-eigene Dateien)
mitgehärtet, über den eigentlichen Befund hinaus; das gezielte `chmod`
auf genau die eine sicherheitsrelevante Datei trifft den Befund
präziser. Empfehlung 3 (separate `JWT_PRIVATE_KEY_FILE`) ist seit dem
Nachtrag unten ebenfalls umgesetzt; Empfehlung 4 (Schlüsselrotation bei
bereits gelaufenen Installationen) bleibt offen — das ist ein
Betriebsschritt für bestehende Installationen, kein Code-/
Dokumentationsfix in diesem Repository.
Manuell verifiziert: eine per `cat >`/`cp` unter Standard-`umask`
(`022`) angelegte Testdatei hat vor der Korrektur Modus `644`
(weltlesbar), nach `chmod 600` Modus `600` (nur Eigentümer). Kein
automatisierter Test möglich — die betroffenen Skripte/Anleitungen
laufen außerhalb der `apps/api`-Testsuite; `bash -n
scripts/setup-codespace.sh` bestätigt weiterhin gültige Shell-Syntax.

**Fix (Nachtrag, Empfehlung 3).** `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`
(Inline-PEM in der `.env`) haben jetzt gleichwertige Gegenstücke
`JWT_PRIVATE_KEY_FILE`/`JWT_PUBLIC_KEY_FILE` (Dateipfad zu einer
PEM-Datei mit echten Zeilenumbrüchen) — je Schlüssel ist GENAU EINE der
beiden Formen erlaubt, unabhängig vom jeweils anderen Schlüssel wählbar
(privat per Datei, öffentlich inline geht z. B. ebenso). Umgesetzt in
drei Schichten:

- `apps/api/src/config/env.ts`: `EnvSchema` um die beiden neuen
  optionalen Felder ergänzt; `loadEnv()` lehnt eine gleichzeitige Angabe
  beider Formen für denselben Schlüssel unabhängig von `NODE_ENV` ab
  (uneindeutig, welche gilt) und verlangt in Produktion je Schlüssel
  mindestens eine der beiden Formen — ohne selbst auf die Festplatte
  zuzugreifen (reine String-Prüfung).
- `apps/api/src/auth/keys.ts`: `resolveKeyPair()` löst jeden Schlüssel
  unabhängig auf (`resolveKeyValue()`) — Inline-Wert, falls gesetzt,
  sonst `readFileSync()` auf den Dateipfad. Ein nicht lesbarer Pfad
  bricht mit einer auf die genaue Variable (`JWT_PRIVATE_KEY_FILE`/
  `JWT_PUBLIC_KEY_FILE`) zurückführbaren Fehlermeldung ab, samt `cause`
  für die zugrundeliegende Node-Fehlermeldung (ESLint-Regel
  `preserve-caught-error`), statt Node.js' rohes `ENOENT`
  unkommentiert durchzureichen. `unescapePem()` (literales `\n` →
  echter Zeilenumbruch) läuft weiterhin über beide Formen — für eine
  Datei mit bereits echten Zeilenumbrüchen ein No-op, deckt aber auch
  eine versehentlich escapt abgelegte Datei ab.
- `scripts/setup-codespace.sh` (Schritt 6) erzeugt das Schlüsselpaar
  jetzt direkt an seinem endgültigen Ort (`apps/api/keys/`, `chmod 700`
  aufs Verzeichnis, `600`/`644` auf die beiden Dateien) statt es über
  ein temporäres Verzeichnis als `\n`-kodierten String in die `.env` zu
  kopieren — ein Zwischenschritt, in dem der private Schlüssel
  zusätzlich unverschlüsselt an einem zweiten Ort läge, entfällt damit
  vollständig. `apps/api/.env` referenziert nur noch die beiden Pfade
  über `JWT_PRIVATE_KEY_FILE`/`JWT_PUBLIC_KEY_FILE`. Der neue Ordner ist
  per `.gitignore` ausgeschlossen. Alle vier Deployment-Anleitungen
  zeigen die Datei-Form jetzt als empfohlenen Standardweg, mit der
  bisherigen Inline-Form als dokumentierter Alternative für Setups ohne
  eigene Schlüsseldatei (z. B. ein reiner Secrets-Manager, der nur
  Umgebungsvariablen injiziert).

Bestehende Installationen mit der bisherigen Inline-Form funktionieren
unverändert weiter (rückwärtskompatibel, keine Migration erzwungen) —
die Datei-Form ist ein zusätzlicher, empfohlener Weg, kein Ersatz für
die bereits vorhandene.

Verifiziert: neue Testdatei `apps/api/test/auth/keys.test.ts` (Inline-
Form, Datei-Form, gemischte Formen, `\n`-Escaping in einer Datei,
fehlende Datei → Fehlermeldung nennt `JWT_PRIVATE_KEY_FILE`, Dev-Fallback
samt Caching) sowie sechs neue Fälle in `apps/api/test/env.test.ts`
(fehlendes Schlüsselpaar in Produktion, Datei-Form akzeptiert, gemischte
Formen akzeptiert, beide Formen gleichzeitig je Schlüssel abgelehnt).
`npm run typecheck`/`lint`/`test` in `apps/api` grün (444 Tests, davon
30 neu). Das Erzeugen des Schlüsselpaars an seinem endgültigen Ort
zusätzlich isoliert mit echtem `openssl` nachvollzogen (Verzeichnis
`700`, private Datei `600`, öffentliche Datei `644`, beide mit
korrektem PEM-Header) — nicht End-to-End über das vollständige
`setup-codespace.sh`, da dessen übrige Schritte (Systempakete, `sudo`,
laufender Postgres/PM2) außerhalb der hier verfügbaren Umgebung liegen.

---

## Mittel

### M1 — Superadmin-Passwort als Kommandozeilenargument (offen aus Vorreview N2/N6) — **behoben**

**Ort.** `apps/api/scripts/createSuperAdmin.ts:11` (dokumentierte
Nutzung), `:18-40` (Argument-Auswertung), `scripts/setup-codespace.sh:226`,
zusätzlich `docs/deployment.md:397`,
`docs/deployment-raspberry-pi.md:428`,
`docs/deployment-github-codespaces.md:261`,
`docs/deployment-macos.md:241`, `README.md:145`.

**Sachverhalt.** Das Passwort wird ausschließlich über `--password=…`
entgegengenommen. Argumente eines laufenden Prozesses sind auf Linux
über `/proc/<pid>/cmdline` für **jeden** lokalen Benutzer lesbar (`ps
aux` genügt) — und zwar für die gesamte Laufzeit von `npm`, `tsx` und dem
Skript selbst, in der ein argon2id-Hash mit 64 MiB Speicherkosten
berechnet wird, das Zeitfenster also alles andere als vernachlässigbar
ist. Zusätzlich landet der Befehl in der Shell-History der
ausführenden Person, in npms eigener Protokollierung sowie — bei einem
nicht-interaktiven Lauf über `SUPERADMIN_PASSWORD` — im CI-Log.

`setup-codespace.sh` hat den interaktiven Teil bereits vorbildlich gelöst
(`read -s` mit Bestätigung, Ausgabe nur der E-Mail-Adresse), reicht das
Passwort in Zeile 226 dann aber doch wieder als Argument weiter — die
sorgfältige Behandlung davor verpufft an dieser einen Stelle.

**Auswirkung.** Preisgabe der Zugangsdaten des höchstprivilegierten
Kontos an jeden lokalen Benutzer bzw. an jedes System, das Shell-History
oder CI-Logs aufbewahrt.

**Wichtig im Zusammenhang mit M2:** Ein späteres Löschen des Skripts
behebt diesen Befund **nicht**. Die Preisgabe geschieht *während* des
einen Laufs; das Passwort ist danach in History und Logs, unabhängig
davon, ob die Skriptdatei noch existiert.

**Empfehlung.** `createSuperAdmin.ts` liest das Passwort aus einer
Umgebungsvariablen (`SUPERADMIN_PASSWORD`) oder — wenn diese leer ist —
interaktiv von `stdin` ohne Terminal-Echo. `--password=` entfällt
ersatzlos; alle fünf Fundstellen in Dokumentation und README sind
entsprechend anzupassen. `setup-codespace.sh` übergibt die bereits
sicher eingelesene Variable dann als Umgebungsvariable statt als
Argument.

**Fix.** `--password=` ist ersatzlos entfallen. `createSuperAdmin.ts`
liest das Passwort jetzt über `resolvePassword()`: vorrangig aus
`SUPERADMIN_PASSWORD` (Umgebungsvariable), sonst interaktiv über eine
neue `readHiddenLine()` — ein manueller Raw-Mode-Umweg (Node hat kein
eingebautes Äquivalent zu `read -s`), der stdin für die GESAMTE
Eingabe-/Bestätigungs-Sequenz in den Raw-Modus versetzt (nicht je
Prompt einzeln an-/ausschaltet — ein Toggle je Aufruf öffnete sonst
zwischen zwei Prompts ein kurzes Zeitfenster mit deaktiviertem
Raw-Modus). Mit Längenprüfung, Bestätigungsabgleich und
Wiederholungsschleife bei Fehleingabe, spiegelbildlich zur bereits
vorhandenen Bash-Logik in `setup-codespace.sh`. `setup-codespace.sh`
selbst übergibt die dort bereits sicher (per `read -rsp`) eingelesene
Variable jetzt nur noch als Umgebungsvariable für genau diesen einen
Befehl (`SUPERADMIN_PASSWORD="…" npm run create-superadmin -- …`, nicht
`export`iert), statt sie als `--password=…`-Argument weiterzureichen.
Alle fünf Fundstellen (`deployment.md`, `deployment-raspberry-pi.md`,
`deployment-github-codespaces.md`, `deployment-macos.md`, `README.md`)
zeigen jetzt beide Wege: den interaktiven Aufruf ohne Passwort-Argument
und, als Alternative für einen automatisierten Lauf,
`SUPERADMIN_PASSWORD='…' npm run create-superadmin -- …`.

Verifiziert gegen eine echte, lokal aufgesetzte PostgreSQL-16-Instanz
(Migrationen per `prisma migrate deploy` angewendet): Nutzungsfehler,
ungültige E-Mail-Adresse, fehlendes Terminal ohne `SUPERADMIN_PASSWORD`,
zu kurzes `SUPERADMIN_PASSWORD` — alle mit der erwarteten, klaren
Fehlermeldung. Der interaktive Pfad zusätzlich über ein echtes
Pseudo-Terminal (Python `pty`) automatisiert durchgespielt: zu kurze
Eingabe löst die Wiederholungsschleife aus, eine abweichende
Bestätigung ebenso, das eingegebene Passwort erscheint zu keinem
Zeitpunkt im Terminal-Output (dabei zunächst — vor der oben
beschriebenen Umstellung auf EINMALIGEN statt Toggle-je-Aufruf
Raw-Modus — ein einmaliges Echo-Leck zwischen zwei Prompts beobachtet
und durch genau diese Umstellung behoben; erneut verifiziert). Der
volle Erfolgspfad (erstes Konto anlegen → zweiter Lauf mit anderer
E-Mail ohne `--force` → Ablehnung → derselbe Lauf mit `--force` →
Erfolg) ebenfalls gegen die echte Datenbank bestätigt, inkl. Kontrolle
der gespeicherten Zeilen (`role: 'superadmin'`, `passwordHash` gesetzt,
`clubId: null`). `npm run typecheck`/`lint`/`test` in `apps/api` grün
(444 Tests, unverändert — dieses Skript hat wie zuvor keine eigene
Unit-Testdatei, konsistent mit den übrigen `scripts/*.ts` dieses Repos).
`bash -n scripts/setup-codespace.sh` bestätigt weiterhin gültige
Shell-Syntax.

### M2 — Löschen des Skripts nach dem ersten Lauf trägt als Sicherheitsmaßnahme nicht — **behoben**

**Ort.** `apps/api/scripts/createSuperAdmin.ts:44-60`.

**Sachverhalt.** Das Skript prüft ausschließlich, ob die angegebene
E-Mail-Adresse bereits vergeben ist:

```ts
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) { … process.exit(1); }
```

Es prüft **nicht**, ob bereits ein Superadmin existiert, führt keine
Erstlauf-Markierung, und nichts im Repository löscht es nach einem
erfolgreichen Lauf. Mit einer zweiten E-Mail-Adresse lässt es sich
beliebig oft erneut ausführen. Die Annahme „das Skript wird nach dem
ersten Lauf gelöscht" ist damit eine rein manuelle Betriebsdisziplin,
die weder erzwungen noch verifiziert wird.

**Bewertung.** Als *Sicherheits*maßnahme greift das Löschen ins Leere,
denn es setzt an der falschen Stelle an: Wer das Skript ausführen kann,
hat bereits Shell-Zugriff auf den Server als das Konto, dem
`apps/api/.env` gehört. Damit stehen ihm ohnehin offen — der
Datenbankzugriff über `DATABASE_URL` (ein direktes `INSERT` in `users`
leistet exakt dasselbe wie das Skript), die Token-Fälschung über
`JWT_PRIVATE_KEY` (**H2**, ohne jede Spur in der Datenbank) und, solange
**H1** offen ist, `npm run prisma:seed`. Das Löschen entfernt einen von
vier gleichwertigen Wegen und ändert an der Angriffsfläche nichts.

Gleichzeitig ist das Löschen **nicht kostenlos**: Es gibt keine
HTTP-Route, die ein Superadmin-Konto anlegt (bewusst so, siehe
`createSuperAdmin.ts:13-14`), und `InvitationRoleSchema`
(`packages/shared-types/src/invitation.ts:64`) schließt `superadmin`
ausdrücklich aus — ein Superadmin kann also auch nicht per Einladung
nachbesetzt werden. Geht das einzige Superadmin-Konto verloren (Passwort
vergessen bei nicht konfiguriertem SMTP, versehentliche
DSGVO-Löschanfrage über `DELETE /api/me`, verlorene Postfachkontrolle),
bleibt nach dem Löschen des Skripts nur noch manuelle
Datenbankmanipulation. Es wird also ein realer Wiederherstellungspfad
gegen einen Sicherheitsgewinn eingetauscht, den es nicht gibt.

**Empfehlung.** Das Skript **behalten** und stattdessen dort härten, wo
es tatsächlich wirkt:

1. **M1 beheben** (Passwort nicht mehr als Argument) — das ist das
   konkrete Risiko, das dem Skript tatsächlich anhaftet.
2. Einen Selbstschutz gegen unbeabsichtigte Mehrfachanlage einbauen:
   existiert bereits ein Konto mit `role: 'superadmin'`, bricht das
   Skript mit einer erklärenden Meldung ab und verlangt für den
   Ausnahmefall ein explizites `--force`.
3. Die E-Mail-Adresse validieren (aktuell wird jeder beliebige String
   akzeptiert und dauerhaft gespeichert) — konsistent zu
   `z.string().email()` an allen übrigen Stellen des Systems.
4. Wenn die Angriffsfläche „Shell-Zugriff auf den Server" tatsächlich
   verkleinert werden soll, ist das Skript der falsche Hebel: wirksam
   sind hier **H2** (Dateirechte auf `.env`), **N1** (getrennte
   Datenbankrollen) und die bestehende SSH-/Firewall-Absicherung.

**Fix.** Das Skript bleibt bestehen (Empfehlung 4 war ohnehin kein
Änderungsauftrag an dieser Datei, siehe dortige Begründung — **H2** ist
bereits behoben, **N1** weiterhin offen). Empfehlung 1 ist mit **M1**
oben erledigt. Empfehlung 2: `main()` prüft jetzt zusätzlich zur
bestehenden E-Mail-Prüfung, ob bereits IRGENDEIN Konto mit
`role: 'superadmin'` existiert (`prisma.user.findFirst({ where: { role:
'superadmin' } })`) und bricht in diesem Fall mit einer erklärenden
Meldung ab, außer `--force` wurde übergeben (per `parseArgs()` jetzt
zusätzlich zu `--email=`/`--name=` als reines Flag erkannt, ohne
Wert). Empfehlung 3: die E-Mail-Adresse läuft durch
`z.string().email().safeParse()`, konsistent zu `LoginRequestSchema` &
Co. — ein ungültiger Wert bricht mit einer klaren Meldung ab, bevor
irgendein Datenbankzugriff stattfindet.

Verifiziert gegen dieselbe echte PostgreSQL-16-Instanz wie bei **M1**
(gemeinsamer End-to-End-Lauf): erstes Superadmin-Konto anlegen
(Erfolg) → zweiter Lauf mit abweichender E-Mail-Adresse, kein `--force`
(Ablehnung mit Verweis auf das bestehende Konto samt dessen E-Mail-
Adresse) → derselbe Lauf mit `--force` (Erfolg, zweite Zeile mit `role:
'superadmin'` in der Datenbank bestätigt) → ungültige E-Mail-Adresse
(Ablehnung vor jedem Datenbankzugriff). `npm run typecheck`/`lint` in
`apps/api` grün.

---

## Niedrig

### N1 — Anwendungsrolle besitzt dauerhaft volle DDL-Rechte — **behoben**

**Ort.** `docs/deployment.md:196-202`, `scripts/setup-codespace.sh:73-76`.

`lane1_app` erhält `GRANT ALL PRIVILEGES ON DATABASE lane1` plus
`GRANT ALL ON SCHEMA public` und ist zugleich Eigentümerin der Datenbank
(`OWNER ${DB_USER}` in `setup-codespace.sh:70`). Dieselbe Rolle wird zur
Laufzeit von der Anwendung verwendet. Für `prisma migrate deploy` sind
DDL-Rechte nötig, für den laufenden Betrieb nicht: dort genügen
`SELECT`/`INSERT`/`UPDATE`/`DELETE`. Ein zur Laufzeit erlangter
Datenbankzugriff kann derzeit Tabellen ändern oder löschen, statt nur
Zeilen zu lesen und zu schreiben.

**Empfehlung.** Zwei Rollen trennen: eine Migrationsrolle mit DDL-Rechten
(nur für `prisma migrate deploy`) und eine Laufzeitrolle mit reinen
DML-Rechten für `DATABASE_URL`. Kein dringender Befund, aber die
naheliegende Ergänzung, sobald **H2** angefasst wird.

**Fix.** Neue Rolle `lane1_migrator` — Eigentümerin der Datenbank,
ausschließlich für `prisma migrate deploy` verwendet. `lane1_app` bleibt
der Name der Laufzeitrolle, verliert aber alle DDL-Rechte: `GRANT
SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` statt
`GRANT ALL`, dazu `ALTER DEFAULT PRIVILEGES FOR ROLE lane1_migrator …
GRANT … TO lane1_app`, damit auch von KÜNFTIGEN Migrationen neu
angelegte Tabellen automatisch dieselben (eingeschränkten) Rechte
erhalten, ohne nach jeder Migration erneut manuell nachgrant werden zu
müssen. Jede `prisma migrate deploy`-Stelle überschreibt `DATABASE_URL`
für genau diesen einen Befehl auf `lane1_migrator` (Prismas eigenes
`.env`-Laden überschreibt eine bereits gesetzte Umgebungsvariable
nicht) — `apps/api/.env` selbst trägt weiterhin nur die DML-only-Rolle.
Umgesetzt in allen vier Deployment-Anleitungen (Ersteinrichtung,
spätere Updates, `pg_dump`/`psql`-Wiederherstellung in
`deployment-macos.md`, wo ein vollständiger Dump auch `CREATE
TABLE`-Anweisungen enthält und daher ebenfalls die DDL-Rolle braucht)
sowie in `scripts/setup-codespace.sh`. Das dort automatisch erzeugte
`lane1_migrator`-Passwort landet NICHT in `apps/api/.env` (das liest nur
die Anwendung selbst), sondern in einer neuen, `chmod 600`-geschützten
`apps/api/.env.migrate` — ausschließlich zum manuellen Nachschlagen für
eine künftige manuelle `prisma migrate deploy`, von nichts automatisch
gelesen, per `.gitignore` ausgeschlossen.

Verifiziert gegen eine echte, lokal aufgesetzte PostgreSQL-16-Instanz:
`lane1_migrator` wendet `prisma migrate deploy` erfolgreich an;
`lane1_app` kann anschließend lesen/schreiben (`SELECT`/`INSERT`/
`UPDATE`/`DELETE`), scheitert aber wie vorgesehen an `CREATE TABLE`
(„permission denied for schema public"), `ALTER TABLE` und `DROP TABLE`
(„must be owner of table …"); eine von `lane1_migrator` NACH der
Rechtevergabe neu angelegte Tabelle (simuliert eine künftige Migration)
ist für `lane1_app` ohne jeden weiteren manuellen Grant sofort
lese-/schreibbar, aber ebenso wenig änderbar — bestätigt, dass `ALTER
DEFAULT PRIVILEGES` wie vorgesehen greift.

### N2 — Kein `.env`-Loader im Laufzeitpfad des Servers — **behoben**

**Ort.** `apps/api/src/index.ts:6`, `apps/api/package.json`.

`loadEnv()` liest ausschließlich `process.env`
(`config/env.ts:112`). Im gesamten Repository findet sich weder eine
`dotenv`-Abhängigkeit noch ein `--env-file`-Aufruf; `apps/api/.env` wird
im dokumentierten Startbefehl (`pm2 start dist/index.js`,
`deployment.md`/`setup-codespace.sh:174`) von nichts eingelesen. Für die
Prisma-CLI-Schritte (`migrate deploy`, `db seed`) greift das eigene
`.env`-Laden der Prisma-CLI, für den Fastify-Einstiegspunkt jedoch nicht.

Dieser Punkt ließ sich zum Zeitpunkt des ursprünglichen Reviews in dieser
Umgebung nicht empirisch verifizieren (keine installierten
`node_modules`) und war daher als Beobachtung festgehalten, nicht als
bestätigter Fehler.

**Nachtrag — beim Beheben empirisch bestätigt, schwerwiegender als
angenommen.** Mit installierten `node_modules` ließ sich der Verdacht
direkt nachstellen: `pm2 start dist/index.js --name lane1-api` bzw.
`node dist/index.js`, beide exakt wie dokumentiert aus `apps/api/`
gegen ein dort liegendes, korrekt befülltes `.env` gestartet, stürzen
sofort mit `Ungültige Umgebungskonfiguration: DATABASE_URL: Required`
ab — der Prozess sieht die Datei buchstäblich direkt daneben liegen und
liest sie trotzdem nicht. Dasselbe gilt für `npm run dev` (`tsx watch
src/index.ts`) UND — das war zuvor nicht mitbedacht — für
`createSuperAdmin.ts`/`purgeDeletedData.ts`: eine direkt instanziierte
`PrismaClient` (statt der Prisma-**CLI**, `npx prisma migrate deploy`/
`db seed`, die tatsächlich ihr eigenes `.env`-Laden mitbringt) hat
ebenso wenig eingebautes `.env`-Laden. Als dokumentiert und damit real
funktionierend galten bislang: der komplette Produktivbetrieb aller vier
Deployment-Anleitungen, `npm run dev`, `npm run create-superadmin` und
der Purge-Cronjob — keiner davon hätte ohne diesen Fix je die in
`config/env.ts` erzwungenen Werte (`TRUSTED_PROXY_IPS`,
`JWT_PRIVATE_KEY`, `CORS_ORIGIN != "*"`) tatsächlich gesehen, weil sie
gar nicht erst gestartet wären.

Nicht betroffen: der Docker-Compose-Weg (`docker-compose.yml`/
`apps/api/Dockerfile`) — dessen `CMD` ruft `node dist/index.js` direkt
auf (nicht über `npm start`) und bekommt seine Variablen bereits per
Compose-`environment:`-Block direkt in den Prozess injiziert, ganz ohne
`.env`-Datei; ebenso die CI (`.github/workflows/ci.yml`), die ihre
Variablen als echte GitHub-Actions-`env:`-Einträge setzt — beide Wege
haben nie eine `.env`-Datei gebraucht und sind vom Befund unberührt.

**Empfehlung.** Den Startweg einmal am realen Deployment nachvollziehen
und das Ergebnis in der Dokumentation festhalten — entweder durch
`node --env-file=.env dist/index.js` bzw. eine PM2-Ecosystem-Datei, oder
durch eine ausdrückliche Notiz, wie die Variablen in die Prozessumgebung
gelangen.

**Fix.** Node ≥ 20.6 unterstützt `--env-file` nativ (kein zusätzliches
`dotenv`-Paket nötig) — empirisch bestätigt: `--env-file` überschreibt
niemals einen bereits gesetzten echten Prozess-Umgebungswert (Standard-
dotenv-Semantik), bricht aber hart ab, wenn die angegebene Datei fehlt.
Beides passt genau auf die vier dokumentierten Deployments (`.env`
garantiert vorhanden, sobald dieser Schritt erreicht wird) und lässt den
Docker-Compose-Weg unberührt (der ruft `node dist/index.js` nie über
diese `package.json`-Skripte auf). Umgesetzt:

- `apps/api/package.json`: `dev` (`tsx watch --env-file=.env
  src/index.ts`), `start` (`node --env-file=.env dist/index.js`),
  `create-superadmin` und `purge-deleted-data` (beide `tsx
  --env-file=.env …`) tragen das Flag jetzt fest.
- Alle fünf `pm2 start dist/index.js`-Stellen (vier Deployment-
  Anleitungen plus `scripts/setup-codespace.sh`) ergänzen
  `--node-args="--env-file=.env"`. `pm2 restart` (spätere Updates,
  `setup-codespace.sh`s Re-Run-Zweig) braucht das Flag NICHT erneut —
  PM2 hinterlegt die beim ersten `pm2 start` übergebenen Node-Argumente
  und wendet sie bei jedem `restart` automatisch wieder an (empirisch
  bestätigt).
- Der Purge-Cronjob (`deployment.md`/`deployment-raspberry-pi.md`,
  Abschnitt 12.1) ruft `tsx` bewusst über seinen absoluten Pfad statt
  über `npm run purge-deleted-data` auf (Cron hat keinen zuverlässigen
  `npm` im `PATH`) — dort direkt `--env-file=.env` ergänzt, da dieser
  Aufruf nicht über den jetzt gefixten `package.json`-Eintrag läuft.

Verifiziert mit `env -i` (vollständig geleerte Prozessumgebung, nur
`PATH`/`HOME`) gegen eine echte, lokal aufgesetzte PostgreSQL-16-Instanz:
`npm run dev`, `npm run start`, `npm run create-superadmin` und
`npm run purge-deleted-data` laden `apps/api/.env` jetzt alle korrekt
und funktionieren Ende-zu-Ende (Superadmin-Konto tatsächlich angelegt,
Purge-Lauf tatsächlich gegen die Datenbank ausgeführt) — vorher schlugen
alle vier mit exakt derselben `DATABASE_URL: Required`-Meldung fehl.
`pm2 start dist/index.js --node-args="--env-file=.env"` sowie ein
anschließender `pm2 restart` wurden ebenso gegen eine echte, temporär
installierte PM2-Instanz bestätigt (Server startet, Log zeigt „Server
listening", auch nach dem Restart). `npm run typecheck`/`lint`/`test`
(444 Tests) sowie die volle Integrationstestsuite (52 Tests, gegen
dieselbe echte Postgres-Instanz) bleiben grün.

### N3 — Codespace leitet Port 5432 mit repository-bekanntem Passwort weiter — **behoben**

**Ort.** `.devcontainer/devcontainer.json:22-27`, `docker-compose.yml:8-10`.

Die Entwicklungsumgebung nutzt das fest im Repository stehende
`lane1_dev_password`. Das ist für sich unkritisch — `docker-compose.yml`
bindet Postgres bewusst nur an `127.0.0.1` (mit ausführlicher Begründung
im Kommentar). `devcontainer.json` listet 5432 jedoch unter
`forwardPorts` (`onAutoForward: "silent"`). Weitergeleitete
Codespace-Ports sind standardmäßig privat; wird ein Port versehentlich
auf „öffentlich" gestellt, ist die Datenbank mit einem öffentlich
bekannten Passwort erreichbar. Da die Weiterleitung ausschließlich
Komfort bietet (die Anwendung im selben Compose-Netz erreicht Postgres
über den Servicenamen), lässt sich das Risiko folgenlos entfernen.

**Empfehlung.** 5432 aus `forwardPorts` streichen; wer einen
GUI-Client anschließen will, kann den Port bei Bedarf manuell
weiterleiten.

**Fix.** `5432` aus `forwardPorts` sowie der zugehörige Eintrag aus
`portsAttributes` entfernt; `docker-compose.yml` selbst (Postgres-Bind
auf `127.0.0.1`) blieb unverändert — dieser Befund betraf ausschließlich
die zusätzliche Codespaces-eigene Portweiterleitung obendrauf. Funktional
folgenlos: die Anwendung erreicht Postgres weiterhin über den
Compose-internen Servicenamen (`postgres:5432`), unabhängig von
`forwardPorts`. Kein automatisierter Test möglich (Codespaces-eigenes
Verhalten, keine lokal nachstellbare Laufzeitumgebung) — `devcontainer.json`
manuell auf gültiges JSON geprüft (nach Entfernen der `//`-Kommentare,
die JSONC dort erlaubt).

---

## Geprüft und unauffällig

Der Vollständigkeit halber — diese Bereiche wurden im Rahmen des
Prüfumfangs untersucht und geben keinen Anlass zu einem Befund:

* **Kontoübernahme über den Authentifizierungsfluss.** Der Pfad
  Login → Refresh → Reset → Passwort-/E-Mail-Wechsel ist durchgängig
  sauber gebaut: Token-Rotation mit Reuse-Detection und
  Massen-Widerruf (`auth.service.ts:refresh`), Widerruf aller Sitzungen
  bei jedem sicherheitsrelevanten Wechsel, `markAllUsedForUser()` gegen
  parallel offene Reset-Links, Passwortpflicht bei `changePassword` und
  `changeEmail`, konstanter Rechenaufwand bei unbekannter E-Mail-Adresse
  (`DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY`), generische Fehlermeldungen
  gegen User-Enumeration, und der `P2002`-Fang gegen das
  Existenz-Orakel bei soft-gelöschten Konten.
* **Rechteausweitung über Einladungen.** `InvitationRoleSchema` schließt
  `superadmin` aus; `assertCanIssueRole()` und `resolveTargetClubId()`
  verhindern zuverlässig, dass ein Admin in einen fremden Verein einlädt
  oder eine Admin-Einladung ausstellt; `acceptInvitation()` übernimmt
  Rolle, Verein und `athleteId` ausschließlich aus dem serverseitig
  gespeicherten Einladungsdatensatz, nie aus der Anfrage.
* **Token-Handhabung.** RS256 mit explizit gepinnter
  `algorithms: ['RS256']`-Liste (kein `alg: none`/HS256-Verwechslung);
  Refresh-, Einladungs- und Reset-Tokens sind opake Zufallswerte, von
  denen serverseitig nur der SHA-256-Hash gespeichert wird; argon2id mit
  Parametern über der OWASP-Empfehlung.
* **Mandantentrennung im Sync.** `sync.permissions.ts` ist konsequent
  als Whitelist mit `Record<EntityStoreName, …>`-Vollständigkeitszwang
  gebaut; `clubId` wird sowohl gegen den Payload als auch gegen alle
  Fremdschlüssel geprüft, ergänzt um Zeilen-/Feld-Scoping für die Rolle
  `athlete`.
* **Reverse-Proxy-/Rate-Limit-Konfiguration.** Der H1-Fix des Vorreviews
  (`TRUSTED_PROXY_IPS` + `resolveTrustProxy()`) ist korrekt umgesetzt:
  Bei `trustProxy: ['127.0.0.1']` liefert proxy-addr den ersten nicht
  vertrauenswürdigen Eintrag von rechts, ein selbst gesetzter
  `X-Forwarded-For` bleibt damit wirkungslos. Die Produktionspflicht in
  `config/env.ts` schließt beide unsicheren Defaults aus.
* **Container-Härtung.** Multi-Stage-Build mit eigener
  `--omit=dev`-Stage, `USER node`, `--ignore-scripts`,
  `migrate deploy` vor dem Start; `scripts/` wird nicht ins
  Laufzeit-Image kopiert.
* **HTTP-Härtung.** Helmet mit vollständig expliziter Default-Deny-CSP
  (`useDefaults: false`), `frameguard: deny`, CORS ohne Wildcard bei
  `credentials: true`, zentraler Fehler-Handler ohne Stacktrace-Leck,
  `/health` ohne verwertbare Interna.
* **CI.** `npm audit --omit=dev --audit-level=high` blockiert den Merge,
  Integrationstests laufen gegen eine echte Postgres-Instanz.
