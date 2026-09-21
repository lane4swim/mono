# Plan: Rechtliche Vereinsangaben (Impressum & Datenschutzhinweis) je Verein

Ziel: Die bislang statische, generische Platzhaltertext-Seite "Rechtliches &
Datenschutz" (`apps/web/js/modules/info.js`, wiederverwendet vor dem Login in
`authScreens.js`) durch tatsächliche, **pro Verein gepflegte** Angaben ersetzen.
Hintergrund: Lane 1 ist mandantenfähig (mehrere Vereine auf derselben Instanz),
und datenschutzrechtlich Verantwortlicher ist laut eigenem Datenschutzhinweis
("`legal.gdprResponsibleText`") **jeweils der einzelne Verein**, nicht der
Betreiber der Software — eine einzige, für alle Vereine identische
Platzhalterseite ist für jeden Verein außer dem allerersten falsch.

Stand: Implementiert (Iteration 1, siehe Abschnitt 3). Kein Greenfield-Feature —
die bestehenden Selbstauskunfts-/Löschungs-Endpunkte für personenbezogene Daten
(Art. 15/17 DSGVO, `apps/api/src/modules/profile/`) bleiben unverändert; dieser
Plan ergänzt ausschließlich die Anbieterkennzeichnung/Kontaktangaben, die bisher
als `[Platzhalter]`-Text im Frontend hinterlegt waren.

## 1. Entscheidung: Geltungsbereich

Mit dem Auftraggeber abgestimmt (2026-09-21):

- **Nur deutsches Recht** (DDG § 5 — Nachfolgeregelung des zum 14.05.2024
  aufgehobenen TMG § 5 — sowie BDSG § 38/Art. 37 DSGVO für die
  Datenschutzbeauftragten-Pflicht) wird in dieser Iteration abgebildet. Kein
  `country`-Feld, keine Rechtsordnungs-Umschaltung.
- Die **Vorab-Anzeige ohne Login** (`authScreens.js`: `buildLegalContent()` ohne
  Argument) bleibt bewusst **generisch** — dort ist der Verein der
  besuchenden Person noch nicht bekannt (kein `clubId` vor der Anmeldung). Ein
  „Standardhinweis" für diesen Fall wird zu einem späteren Zeitpunkt separat
  nachgereicht (siehe `legal.imprintNote`/Platzhaltertexte, die dafür bereits
  vorhanden sind).
- Der Abrufendpunkt (`GET /api/clubs/:id/legal-info`) verlangt **volle
  Authentifizierung** und liefert nur den eigenen Verein (oder, für
  Superadmin, einen explizit angegebenen) — kein unauthentifizierter
  Zugriff, auch nicht auf die eigenen, bereits gepflegten Angaben.

## 2. Weitere Rechtsordnungen (dokumentierter Folgeaufwand, NICHT umgesetzt)

Sobald Vereine außerhalb Deutschlands hinzukommen, reicht das aktuelle Modell
nicht mehr aus — hier der bereits umrissene Fahrplan für diesen Fall:

- **Österreich**: Kennzeichnungspflicht nach ECG § 5 (inhaltlich nah an
  DDG § 5, aber eigene Norm), zusätzlich ggf. Offenlegungspflicht nach dem
  Mediengesetz, falls die Vereinsinstanz auch periodische Medien (z. B. einen
  öffentlichen Blog/Newsletter) über die App verbreitet — bei einem reinen
  Trainingsmanagement-Tool im Regelfall nicht einschlägig.
- **Schweiz**: kein GDPR, sondern revFADP/revDSG — keine so strikte
  Impressumspflicht wie in Deutschland, aber UWG Art. 3 verlangt
  Basis-Anbieterangaben; der Datenschutzhinweis braucht dennoch
  Verantwortlichen-Name/Kontakt.
- **Umsetzungsvorschlag, wenn benötigt**: ein `country`-Feld auf `Club`
  (Default `"DE"`), das steuert, welche Formularfelder/Pflichtangaben
  `renderClubLegalInfoSection()` (`apps/web/js/modules/userManagement.js`)
  anzeigt und welcher Rechtstext-Baustein in `buildImprintSection()`/
  `buildGdprBody()` (`apps/web/js/modules/info.js`) gerendert wird. Die
  bestehenden Felder (`addressLine1`, `contactEmail`, `representativeName`, …)
  sind länderunabhängig weiterverwendbar; DE-spezifisch sind aktuell nur
  `registerNumber`/`registerCourt` (Vereinsregister) und die feste Referenz
  auf § 5 DDG / § 18 Abs. 2 MStV im UI-Text.
- Bewusst **nicht jetzt schon vorgebaut** (kein ungenutztes `country`-Feld,
  keine tote Fallunterscheidung) — YAGNI, bis der erste nicht-deutsche Verein
  tatsächlich ansteht.

## 3. Umsetzung (Iteration 1)

- **Datenmodell**: `Club` (`apps/api/prisma/schema.prisma`) um
  `addressLine1`, `postalCode`, `city`, `representativeName`, `contactEmail`,
  `contactPhone`, `registerNumber`, `registerCourt`, `vatId`,
  `privacyContactEmail`, `supervisoryAuthority`, `dpoRequired`, `dpoName`,
  `dpoContact` erweitert (Migration
  `20260921120000_add_club_legal_info`) — alle nullable, kein Backfill nötig
  (echte Neuerfassung, keine bisherige Quelle).
- **Schema/DTO**: `ClubLegalInfoSchema`/`UpdateClubLegalInfoRequestSchema`
  in `packages/shared-types/src/invitation.ts` — bewusst ein **eigenständiges**
  Schema statt einer Erweiterung von `ClubSchema`: die Felder sind
  sensibler (Adresse, Telefon, DPO-Kontakt) als die übrigen, bereits breiter
  exponierten Club-Felder (`enabledModules`, `nationalID`) und sollen nicht
  automatisch bei jeder bestehenden Club-Abfrage mitgeschickt werden.
- **Backend**: neues Modul `apps/api/src/modules/clubLegalInfo/` (Repository/
  Service/Route, Prisma- und In-Memory-Implementierung), analog zum
  bestehenden `auditLog`-Modul aufgebaut. Endpunkte:
  - `GET /api/clubs/:id/legal-info` — jede Rolle des **eigenen** Vereins,
    Superadmin für jeden Verein (`clubLegalInfo.service.ts`).
  - `PATCH /api/clubs/:id/legal-info` — nur admin (eigener Verein) oder
    superadmin, exakt dieselbe Zugriffsprüfung wie das bestehende
    `PATCH /api/clubs/:id/identity` (`invitations.service.ts`:
    `updateClubIdentity()`).
- **Frontend**:
  - `apps/web/js/modules/info.js`: `buildLegalContent(legalInfo?)` zeigt bei
    vorhandenen Angaben die echten Werte, sonst (Feld für Feld) weiterhin die
    bisherigen Platzhaltertexte. Post-Login-Ansicht lädt die Daten per
    `GET .../legal-info` nach; `authScreens.js` ruft die Funktion weiterhin
    ohne Argument auf (siehe Abschnitt 1).
  - `apps/web/js/modules/userManagement.js`:
    `renderClubLegalInfoSection()` — Bearbeitungsformular für Admins,
    neben der bestehenden `renderClubIdentitySection()`.
- **Tests**: `apps/api/test/clubLegalInfo/` (Service- und Route-Tests,
  Zugriffsmatrix inkl. fremder Verein/Superadmin/fehlende Rolle).

## 4. Bewusst nicht umgesetzt

- Kein Verlauf/Historie der rechtlichen Angaben (ein Satz Werte je Verein,
  wie bei `nationalID`/`nationalIDType`).
- Keine serverseitige Pflichtfeld-Validierung ("Impressum vollständig?") —
  ein Verein kann die Seite unvollständig lassen; das Frontend zeigt dann
  Feld für Feld weiterhin den erkennbaren Platzhaltertext.
- Keine automatische Vorbefüllung aus `Club.name`/`nationalID` über die
  Anzeige des Vereinsnamens hinaus (`ClubLegalInfoSchema.name`, nur lesend).
