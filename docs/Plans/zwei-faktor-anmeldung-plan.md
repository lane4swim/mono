# Zwei-Faktor-Anmeldung per TOTP (Issue #97)

Ergänzt die Passwortregeln aus Issue #97 (mind. 12 Zeichen für Admins und
Superadmins, Abgleich gegen Leak-Passwörter) um einen zweiten Faktor:
Einmalcodes aus einer Authenticator-App (TOTP nach RFC 6238).

## Umsetzungsstand

| Ausbaustufe | Inhalt | Stand |
|---|---|---|
| PR 1 — Backend | Datenmodell, TOTP und Verschlüsselung, Einrichtung, zweiter Anmeldeschritt, Wiederherstellungscodes, Zurücksetzen, Vereinseinstellung, Audit-Log, Konfiguration | **umgesetzt** |
| PR 2 — Oberfläche | Anmeldeschritt, Profilbereich, erzwungene Einrichtung, Vereinseinstellung, Status und Zurücksetzen in der Mitgliederliste, i18n, Hilfe | offen |
| PR 3 — Pflicht | erzwungene Einrichtung für Pflicht-Rollen, Abschalten bei Pflicht verweigern, Abfrage in den Setup-Skripten, `reset-mfa`-Skript, Deployment-Doku | offen |

Die Pflicht wird bewusst erst mit PR 3 erzwungen: ohne Oberfläche würden
Superadmins sonst ausgesperrt.

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
  SHA-256-Hash gespeichert (`MfaRecoveryCode`), einmal verwendbar
  (bedingtes UPDATE).
- **Nie nach außen:** `toPublicUser()` und der Datenexport entfernen
  `totpSecretEnc` und `totpLastUsedStep`; nach außen geht nur `mfaEnabled`.

## Anmeldung

1. `POST /auth/login` prüft das Passwort. Mit aktivem TOTP antwortet der
   Server statt mit Tokens mit `{ mfaRequired: true, mfaToken }`. Das
   `mfaToken` ist ein RS256-JWT mit `purpose: 'mfa'`, 5 Minuten gültig, und
   wird von der normalen Authentifizierung abgelehnt.
2. `POST /auth/login/mfa { mfaToken, code | recoveryCode }` liefert die
   Sitzung. Nach 5 falschen Codes ist das `mfaToken` gesperrt
   (`modules/mfa/mfaChallenges.ts`, im Prozessspeicher — jedes Deployment
   betreibt genau eine API-Instanz), zusätzlich 10 Versuche je Minute und IP.
3. Passwort zurücksetzen meldet bei aktivem TOTP nicht direkt an, sondern
   antwortet ebenfalls mit `mfaRequired` — der Reset-Link belegt nur den
   Zugriff auf das Postfach.

## Endpunkte

| Endpunkt | Wer | Zweck |
|---|---|---|
| `GET /api/me/mfa` | selbst | Status: verfügbar, aktiv, Pflicht, verbleibende Wiederherstellungscodes |
| `POST /api/me/mfa/totp/setup` | selbst | unbestätigtes Secret, `otpauthUri`, `qrSvg`, Schlüssel |
| `POST /api/me/mfa/totp/confirm { code }` | selbst | aktivieren; liefert 10 Wiederherstellungscodes und eine frische Sitzung |
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

## Audit-Log

`mfa.enabled`, `mfa.disabled`, `mfa.reset`, `mfa.recoveryCodesRegenerated`,
`club.mfaPolicyChanged`, `auth.mfaFailed` (ohne `await`, wie
`auth.loginFailed`), `auth.recoveryCodeUsed`. Anzeigetexte im Frontend
folgen mit PR 2.

## Bekannte Grenzen von PR 1

- Die Weboberfläche kennt die MFA-Antwort von `POST /auth/login` noch nicht:
  wer TOTP per API einrichtet, kann sich erst mit PR 2 wieder über die
  Oberfläche anmelden.
- Die Pflicht wird nur angezeigt (`required` im Status), nicht erzwungen.
