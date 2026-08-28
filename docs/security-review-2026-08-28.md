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

Schweregrade: **Hoch** = vor dem nächsten Produktivbetrieb beheben,
**Mittel** = einplanen, **Niedrig** = bei nächster Berührung mitnehmen.

---

## Übersicht

| # | Befund | Ort | Schwere |
|---|--------|-----|---------|
| H1 | Seed-Skript legt einen **Superadmin mit im Repository veröffentlichtem Passwort** an — ohne jede `NODE_ENV`-Absicherung, im README als auszuführender Befehl dokumentiert | `apps/api/prisma/seed.ts:59-62,156-197`, `README.md:215-223` | Hoch |
| H2 | `apps/api/.env` (enthält `JWT_PRIVATE_KEY`) wird ohne Dateirechte-Härtung angelegt → weltlesbar → **Fälschung beliebiger Access Tokens** | `scripts/setup-codespace.sh:123`, `docs/deployment.md:261-315` | Hoch |
| M1 | Superadmin-Passwort als Kommandozeilenargument (**offen aus Vorreview N2/N6**) | `apps/api/scripts/createSuperAdmin.ts:11,18-40`, `scripts/setup-codespace.sh:226` | Mittel |
| M2 | „Skript nach dem ersten Lauf löschen" ist keine wirksame Zugangskontrolle, entfernt aber den einzigen Wiederherstellungspfad | `apps/api/scripts/createSuperAdmin.ts:44-60` | Mittel |
| N1 | Anwendungsrolle `lane1_app` besitzt dauerhaft volle DDL-Rechte (`GRANT ALL`) | `docs/deployment.md:196-202`, `scripts/setup-codespace.sh:73-76` | Niedrig |
| N2 | Kein `.env`-Loader im Laufzeitpfad des Servers (weder `dotenv` noch `--env-file`) | `apps/api/src/index.ts:6`, `apps/api/package.json` | Niedrig |
| N3 | Port 5432 wird im Codespace mit fest im Repository stehendem Passwort weitergeleitet | `.devcontainer/devcontainer.json:22-27`, `docker-compose.yml:8-10` | Niedrig |

---

## Hoch

### H1 — Seed-Skript legt einen Superadmin mit veröffentlichtem Passwort an

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

### H2 — `apps/api/.env` mit `JWT_PRIVATE_KEY` wird weltlesbar angelegt

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

---

## Mittel

### M1 — Superadmin-Passwort als Kommandozeilenargument (offen aus Vorreview N2/N6)

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

### M2 — Löschen des Skripts nach dem ersten Lauf trägt als Sicherheitsmaßnahme nicht

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

---

## Niedrig

### N1 — Anwendungsrolle besitzt dauerhaft volle DDL-Rechte

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

### N2 — Kein `.env`-Loader im Laufzeitpfad des Servers

**Ort.** `apps/api/src/index.ts:6`, `apps/api/package.json`.

`loadEnv()` liest ausschließlich `process.env`
(`config/env.ts:112`). Im gesamten Repository findet sich weder eine
`dotenv`-Abhängigkeit noch ein `--env-file`-Aufruf; `apps/api/.env` wird
im dokumentierten Startbefehl (`pm2 start dist/index.js`,
`deployment.md`/`setup-codespace.sh:174`) von nichts eingelesen. Für die
Prisma-CLI-Schritte (`migrate deploy`, `db seed`) greift das eigene
`.env`-Laden der Prisma-CLI, für den Fastify-Einstiegspunkt jedoch nicht.

Dieser Punkt ließ sich in dieser Umgebung nicht empirisch verifizieren
(keine installierten `node_modules`) und ist daher als Beobachtung
festgehalten, nicht als bestätigter Fehler. Sicherheitsrelevant ist er
mittelbar: Weicht der real funktionierende Startweg von dem
dokumentierten ab, gelten die in `config/env.ts` bewusst als
Produktionspflicht erzwungenen Werte (`TRUSTED_PROXY_IPS`,
`JWT_PRIVATE_KEY`, `CORS_ORIGIN != "*"`) möglicherweise nicht für den
Prozess, der tatsächlich läuft.

**Empfehlung.** Den Startweg einmal am realen Deployment nachvollziehen
und das Ergebnis in der Dokumentation festhalten — entweder durch
`node --env-file=.env dist/index.js` bzw. eine PM2-Ecosystem-Datei, oder
durch eine ausdrückliche Notiz, wie die Variablen in die Prozessumgebung
gelangen.

### N3 — Codespace leitet Port 5432 mit repository-bekanntem Passwort weiter

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
