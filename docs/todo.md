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

# Zukünftige Entwicklungen
- [ ] CD-fähig je Verein (Logo, Farben)
- [x] Nutzer-Qualifikationen (Erwerbsdatum, Art, Ablaufdatum) — siehe
  `docs/nutzer-qualifikationen-plan.md`; umgesetzt als zubuchbares Modul
  inkl. Ablauf-Erinnerungsjob. Offen: `npx prisma migrate dev` gegen eine
  echte Datenbank ausführen (Migration liegt vor, aber ungeprüft gegen
  Postgres — in dieser Sandbox ohne Docker-Zugriff nicht testbar), sowie
  ein Cron-Eintrag für `npm run notify-expiring-qualifications` gemäß
  Skript-Kommentar.

## Push Nachrichten

## Import von DSV7 Dateien
- [ ] Ergänzen um Lenex