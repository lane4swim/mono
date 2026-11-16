# Wichtig
## Impressum
- [x] Impressum auf Login und Nutzerseiten
- [x] DSGVO Hinweise
  - [x] Löschfunktion implementieren

# Sekundär
- [x] Kommentare bei Trainingsplänen
- [x] Import/Export von Übungen via JSON
- [x] Einladungen als kopierfähigen Link
- [x] Kommentare bei Übungen anzeigen
- [X] Module zubuchbar gestalten
- [X] Kann Nutzer Sprache anfragen für Fehlermeldungen?
- [X] Gelöschter Autor wird auf Deutsch bezeichnet (Konstante in commentAnonymization.ts)
- [X] Super-Admin Interface als Demo
- [ ] ~Neue Super-Admin einladen~
- [ ] Review-Verweise aus Code-Kommentaren entfernen („Code-Review, Befund X",
  „Sicherheitsreview …", „vormals …"): Kommentar so umschreiben, dass er die
  heute gültige Regel erklärt; die Herkunft steht in `git log`. Restarbeit aus
  `docs/reviews-handled/code-review-doku-kommentare-2026-09-06.md` (D5),
  `code-review-wartbarkeit-2026-08.md` (W3) und `code-review-2026-08.md` (W1).
  Stand 27.09.2026: 172 Zeilen in 74 Dateien (ohne Tests), dazu 262 in Tests.
  Erledigt: setup-codespace.sh, setup-netcup.sh, shared-types/src/auth.ts,
  auth.route.ts, mailer.ts, state.js, apiClient.js.
  Neue Verweise blockiert CI (`scripts/check-review-markers.sh`).

# Zukünftige Entwicklungen
- [ ] CD-fähig je Verein (Logo, Farben)
- [x] Nutzer-Qualifikationen (Erwerbsdatum, Art, Ablaufdatum) — siehe
  `docs/Plans/nutzer-qualifikationen-plan.md`; umgesetzt als zubuchbares Modul
  inkl. Ablauf-Erinnerungsjob. Der Job läuft im integrierten Scheduler des
  Servers, ein Cron-Eintrag ist nicht mehr nötig (siehe README,
  „Hintergrundjobs").

## Push Nachrichten
- [x] Erinnerungen an Trainingseinheiten und ablaufende Qualifikationen, Push bei neuen Ankündigungen
- [ ] Push bei neuen Kommentaren und neuen Startlisten (bewusst zurückgestellt, siehe `docs/Plans/phase2-plan.md` Abschnitt 5.1)

## Import von DSV7 Dateien
- [x] DSV7-/DSV8-Ergebnisimport und Wettkampfdefinitionen mit Pflichtzeiten
- [ ] Ergänzen um Lenex