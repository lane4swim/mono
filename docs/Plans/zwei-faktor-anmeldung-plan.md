# Zwei-Faktor-Anmeldung per TOTP (Issue #97)

Ergänzt die Passwortregeln aus Issue #97 (mind. 12 Zeichen für Admins und
Superadmins, Abgleich gegen Leak-Passwörter) um einen zweiten Faktor:
Einmalcodes aus einer Authenticator-App (TOTP nach RFC 6238).

## Umsetzungsstand

| Ausbaustufe | Inhalt | Stand |
|---|---|---|
| PR 1 — Backend | Datenmodell, TOTP und Verschlüsselung, Einrichtung, zweiter Anmeldeschritt, Wiederherstellungscodes, Zurücksetzen, Vereinseinstellung, Audit-Log, Konfiguration | **umgesetzt** |
| PR 2 — Oberfläche | Anmeldeschritt (auch nach Passwort-Reset), Profilbereich, Vereinseinstellung, Status und Zurücksetzen in der Mitgliederliste, Audit-Log-Texte, i18n, Hilfe | **umgesetzt** |
| PR 3 — Pflicht | erzwungene Einrichtung für Pflicht-Rollen (Backend `setupToken` **und** Einrichtungsbildschirm), keine verlängerte Sitzung ohne Pflicht-TOTP, Abschalten bei Pflicht verweigern, Startprüfung, Abfrage in den Setup-Skripten, `reset-mfa`-Skript, Deployment-Doku | **umgesetzt** |

Die Pflicht wird seit PR 3 erzwungen (vorher hätte die Oberfläche gefehlt,
Superadmins wären ausgesperrt gewesen).

## Wer TOTP nutzen muss

| Rolle | Pflicht |
|---|---|
| superadmin | ja, solange `MFA_ENFORCE` nicht `false` ist |
| admin | nur in Vereinen mit „TOTP für Admins verlangen“ (`Club.mfaRequiredForAdmins`, Standard aus) und nur bei `MFA_ENFORCE` |
| alle anderen | nie Pflicht |

TOTP ist in jeder Konfiguration freiwillig nutzbar. `MFA_ENFORCE=false`
hebt jede Pflicht auf, auch die der Vereine (gedacht z. B. für GitHub
Codespaces). Fehlt der Wert, gilt `true`.

## Technik

- **Codes:** RFC 6238 mit SHA-1, 6 Stellen, 30 Sekunden; akzeptiert werden
  der aktuelle Zeitschritt sowie je einer davor und danach
  (`apps/api/src/auth/totp.ts`, geprüft gegen die Testvektoren aus RFC 6238
  Anhang B). Keine Fremdbibliothek.
- **Keine Wiederverwendung:** `User.totpLastUsedStep` speichert den
  Zeitschritt des zuletzt angenommenen Codes; angenommen wird nur ein
  späterer Schritt, per bedingtem UPDATE atomar.
- **Secret im Ruhezustand:** AES-256-GCM mit `TOTP_ENCRYPTION_KEY`
  (`apps/api/src/auth/secretBox.ts`, Format `v1:iv:tag:ciphertext`). Ohne
  Schlüssel ist TOTP in Produktion nicht einrichtbar; in development/test gilt
  ein Wegwerf-Schlüssel je Prozess.
- **QR-Code:** serverseitig als SVG (npm `qrcode`), zusammen mit dem
  manuell eingebbaren Schlüssel.
- **Wiederherstellungscodes:** 10 Stück, Format `xxxxx-xxxxx`, nur als
  HMAC-SHA256 über `userId:code` gespeichert (`MfaRecoveryCode`); der
  HMAC-Schlüssel wird per HKDF aus `TOTP_ENCRYPTION_KEY` abgeleitet. Ein
  Datenbankabzug allein reicht so nicht zum Durchprobieren. Einmal
  verwendbar (bedingtes UPDATE).
- **Schlüsselwechsel:** Nach einem geänderten `TOTP_ENCRYPTION_KEY` sind
  Secrets **und** Wiederherstellungscodes unbrauchbar. Die API antwortet
  dann mit 503 `mfa_secret_unreadable`; Abhilfe ist das Zurücksetzen durch
  einen Admin.
- **Nie nach außen:** `toPublicUser()` und der Datenexport entfernen
  `totpSecretEnc` und `totpLastUsedStep`; nach außen geht nur `mfaEnabled`.

## Anmeldung

1. `POST /auth/login` prüft das Passwort. Mit aktivem TOTP antwortet der
   Server statt mit Tokens mit `{ mfaRequired: true, mfaToken }`. Das
   `mfaToken` ist ein RS256-JWT mit `purpose: 'mfa'`, 5 Minuten gültig, und
   wird von der normalen Authentifizierung abgelehnt.
2. `POST /auth/login/mfa { mfaToken, code | recoveryCode }` liefert die
   Sitzung. Nach 5 Versuchen ist das `mfaToken` gesperrt — gezählt wird vor
   der Prüfung, parallele Anfragen umgehen die Grenze also nicht
   (`modules/mfa/mfaChallenges.ts`, im Prozessspeicher — jedes Deployment
   betreibt genau eine API-Instanz), zusätzlich 10 Versuche je Minute und IP.
3. Passwort zurücksetzen meldet bei aktivem TOTP nicht direkt an, sondern
   antwortet ebenfalls mit `mfaRequired` — der Reset-Link belegt nur den
   Zugriff auf das Postfach.

## Pflicht (PR 3)

- **Erzwungene Einrichtung:** Ist TOTP Pflicht, aber nicht eingerichtet,
  antworten `POST /auth/login` und `POST /auth/reset-password` mit
  `{ mfaSetupRequired: true, setupToken }`. Das `setupToken` ist ein
  RS256-JWT mit `purpose: 'mfa-setup'`, 15 Minuten gültig und taugt weder
  als Access Token noch als `mfaToken`. Damit:
  `POST /auth/mfa-setup { setupToken }` (QR-Code, Schlüssel) und
  `POST /auth/mfa-setup/confirm { setupToken, code }`
  (Wiederherstellungscodes und Sitzung). Das Passwort wird dabei nicht
  erneut verlangt — das Token belegt es. Begrenzt je IP wie
  `/auth/login/mfa`.
- **Bestehende Sitzungen:** `POST /auth/refresh` verlängert keine Sitzung
  einer Person, für die TOTP Pflicht, aber nicht eingerichtet ist
  (401 `mfa_setup_required`; das Refresh Token wird dabei eingelöst). Nach
  einem Deployment, dem Einschalten der Vereinspflicht, einem Zurücksetzen
  oder einer neuen Admin-Rolle endet die Sitzung also spätestens mit dem
  Access Token (15 Minuten); die Weboberfläche nennt den Grund auf dem
  Anmeldebildschirm.
- **Abschalten** bei Pflicht: 409 `mfa_required`; das Profil zeigt den
  Knopf dann nicht.
- **Startprüfung:** mit `NODE_ENV=production`, `MFA_ENFORCE` aktiv und ohne
  `TOTP_ENCRYPTION_KEY` bricht der Start ab (sonst wäre jeder Superadmin
  ausgesperrt). `MFA_ENFORCE=false` in Produktion erzeugt eine Warnung im
  Log.
- **Setup-Skripte** (`scripts/lib/mfa-env.sh`): erzeugen
  `TOTP_ENCRYPTION_KEY`, wenn er fehlt, und fragen nach `MFA_ENFORCE` —
  Codespace mit Standard „nein“, netcup mit „ja“. Eine vorgegebene
  Umgebungsvariable ersetzt die Frage, ohne Terminal gilt der Standard,
  vorhandene Werte bleiben. Auch eine bestehende `.env` bekommt so beim
  erneuten Lauf die fehlenden Werte.
- **Notweg:** `npm run reset-mfa -- --email=…` (apps/api) setzt TOTP eines
  Kontos zurück, beendet dessen Sitzungen, schreibt `mfa.reset` mit
  Akteur „System“ ins Audit-Log und schickt den Sicherheitshinweis — für
  Superadmins, die sonst niemand zurücksetzen kann.
- **Vereinseinstellung:** der Verein-Reiter zeigt, wie viele Admins TOTP
  noch einrichten müssen, und weist darauf hin, wenn der Server
  (`MFA_ENFORCE=false`) die Pflicht gerade nicht durchsetzt.

## Endpunkte

| Endpunkt | Wer | Zweck |
|---|---|---|
| `GET /api/me/mfa` | selbst | Status: verfügbar, aktiv, Pflicht, verbleibende Wiederherstellungscodes |
| `POST /api/me/mfa/totp/setup` | selbst | unbestätigtes Secret, `otpauthUri`, `qrSvg`, Schlüssel |
| `POST /api/me/mfa/totp/confirm { code, currentPassword }` | selbst | aktivieren; liefert 10 Wiederherstellungscodes und eine frische Sitzung |
| `DELETE /api/me/mfa/totp { currentPassword, code \| recoveryCode }` | selbst | abschalten; frische Sitzung |
| `POST /api/me/mfa/recovery-codes { code \| recoveryCode }` | selbst | neue Wiederherstellungscodes, die alten verfallen |
| `POST /api/users/:userId/mfa/reset { currentPassword, code? }` | superadmin: alle; admin: eigener Verein außer Superadmins | Zurücksetzen bei verlorenem Gerät; nie das eigene Konto |
| `PATCH /api/clubs/:id/mfa { requiredForAdmins, currentPassword, code? }` | superadmin; admin des Vereins | Pflicht für die Admins des Vereins |

- Heikle Aktionen (Zurücksetzen, Vereinseinstellung) bestätigt die
  handelnde Person mit ihrem Passwort und — falls sie selbst TOTP nutzt —
  mit einem Code.
- Einschalten der Vereinspflicht setzt eigenes, aktives TOTP voraus.
- Einrichten, Abschalten und Zurücksetzen beenden alle Sitzungen der
  betroffenen Person und lösen einen Sicherheitshinweis per E-Mail aus.
  Einrichten verlangt das Passwort, damit eine übernommene Sitzung kein
  eigenes TOTP unterschieben kann.
- Eine Anmeldung mit Wiederherstellungscode und neue
  Wiederherstellungscodes lösen ebenfalls einen Sicherheitshinweis aus.

## Audit-Log

`mfa.enabled`, `mfa.disabled`, `mfa.reset`, `mfa.recoveryCodesRegenerated`,
`club.mfaPolicyChanged`, `auth.mfaFailed` (ohne `await`, wie
`auth.loginFailed`), `auth.recoveryCodeUsed`. Anzeigetexte im Frontend
folgen mit PR 2.

## Oberfläche (PR 2)

- `js/modules/mfa.js` bündelt alle Bausteine; eingebunden von
  `authScreens.js` (Codeschritt nach Anmeldung und Passwort-Reset),
  `profile.js` (Reiter „Sicherheit“) und `userManagement.js`
  (2FA-Badge, „2FA zurücksetzen“, Vereinseinstellung im Reiter „Verein“,
  Spalte in der Superadmin-Vereinsliste).
- **QR-Code:** die CSP erlaubt nur Bilder vom eigenen Origin, und
  Servertext wird nie als Markup eingefügt (siehe `dom.js: icon()`). Das SVG
  wird deshalb geparst und nur aus erlaubten Elementen (`svg`, `path`,
  `rect`) und Attributen nachgebaut (`buildQrSvg()`).
- Der Verein-Reiter liest die Vereinseinstellung aus `GET /api/me/mfa`
  (`clubRequiresAdminMfa`), weil die Sitzung sie nicht trägt.
- Die erzwungene Einrichtung kam mit PR 3 (`renderForcedMfaSetup()`):
  QR-Code, erster Code, dann die Wiederherstellungscodes — die Sitzung
  beginnt erst, wenn die Person bestätigt, sie gesichert zu haben.

## Bekannte Grenzen von PR 1

- ~~Die Weboberfläche kennt die MFA-Antwort von `POST /auth/login` noch
  nicht~~ — mit PR 2 behoben.
- ~~Die Pflicht wird nur angezeigt (`required` im Status), nicht
  erzwungen~~ — mit PR 3 behoben.
