# Brainstorm: Mögliche zukünftige Features

Dieses Dokument sammelt und beschreibt mögliche künftige Erweiterungen von
Lane 1, ausgehend vom aktuellen Funktionsumfang (siehe `README.md` und
`docs/Plans/backend-plan.md`) sowie den bereits vorgemerkten, aber noch offenen
Punkten in `docs/todo.md` (Abschnitt „Zukünftige Entwicklungen"). Die Ideen
sind nach Themenbereich gruppiert; keine ist bereits entschieden oder
geplant — dies ist eine Ideensammlung als Diskussionsgrundlage, kein
Umsetzungsplan wie `docs/Plans/kampfrichter-modul-plan.md` oder
`docs/Plans/nutzer-qualifikationen-plan.md` es für ihre jeweiligen Themen sind.

Zu jedem Feature: kurze Beschreibung, Nutzen, grobe Einschätzung zum Bezug
zur bestehenden Architektur (Sync-API, Rollen-/Mandantenmodell, zubuchbare
Module).

## 1. Bereits in `docs/todo.md` vorgemerkt (hier vertieft)

### 1.1 CD-fähig je Verein (Vereins-Branding)
Jeder Verein kann eigenes Logo und eigene Farben hinterlegen, die in der
PWA (Header, Login-Bildschirm, ggf. exportierte PDFs) angezeigt werden.
- **Nutzen:** Vereine wirken professioneller nach außen; wichtig, sobald
  Lane 1 nicht nur intern, sondern z. B. für Wettkampf-Aushänge oder von
  Eltern eingesehen wird.
- **Bezug zur Architektur:** Neues Feld `Club.branding` (Json: Logo-URL
  oder Base64, Primärfarbe, ggf. Sekundärfarbe); Logo-Upload braucht einen
  Datei-Endpunkt (bisher gibt es keinen — alles ist JSON/Sync-basiert), da
  reicht **kein** generisches Sync-Store-Muster mehr, sondern ein
  dedizierter `POST /api/clubs/:id/logo`-Upload mit Größen-/Typ-Validierung.
  CSS-Farben lassen sich einfach als CSS-Variablen zur Laufzeit setzen.

### 1.2 Push-Benachrichtigungen
Web-Push (Service Worker ist bereits vorhanden) für Ereignisse wie: neue
Kommentare, bevorstehende Trainingseinheiten, ablaufende Qualifikationen
(ergänzt den bestehenden E-Mail-Erinnerungsjob aus
`docs/Plans/nutzer-qualifikationen-plan.md`), neue Wettkampf-Startlisten.
- **Nutzen:** Aktive Rückholung von Nutzer:innen in die App, ohne dass sie
  aktiv nachschauen müssen — gerade für Athlet:innen/Eltern relevant.
- **Bezug zur Architektur:** `sw.js` registriert bereits einen Service
  Worker; Web-Push braucht zusätzlich einen Push-Subscription-Endpunkt
  (`PushSubscription`-Modell je User, analog zu `RefreshToken`), einen
  VAPID-Schlüssel serverseitig sowie einen Versand-Trigger je Ereignistyp.
  Passt gut neben den bestehenden Cron-Jobs (Purge, Qualifikations-
  Erinnerung) für die zeitgesteuerten Fälle; ereignisgesteuerte Fälle
  (neuer Kommentar) lassen sich an die bestehenden Sync-Push-Handler
  anhängen.

### 1.3 Lenex-Import ergänzen
`docs/Plans/dsv7-lenex-import-plan.md` stellt Lenex bewusst zurück (Abschnitt
1.5) und implementiert zunächst nur DSV7. Lenex ist das international
verbreitete XML-Format (auch für FINA/LEN-Wettkämpfe und viele
europäische Verbände), DSV7 ist DSV-spezifisch.
- **Nutzen:** Ergebnisimport auch für nicht-DSV-Wettkämpfe (internationale
  Vergleichswettkämpfe, andere Landesverbände) sowie für Meldungen (Lenex
  kann auch Meldedaten/Startlisten transportieren, nicht nur Ergebnisse).
- **Bezug zur Architektur:** Das in Abschnitt 4 des DSV7-Plans definierte
  „gemeinsame Zwischenformat" (Parser-Output) ist bereits so geschnitten,
  dass ein zweiter Parser (`lenexParser.js` statt `dsv7Parser.js`) auf
  dasselbe Matching/Overwrite/UI aus `resultsImportUI.js` aufsetzen kann,
  ohne dort etwas zu duplizieren.

## 2. Wettkampf & Ergebnisse

### 2.1 Startlisten-Export (Lenex/DSV7 ausgehend)
Bisher wird nur importiert. Ein Export der eigenen Meldungen/Startliste
im Lenex- oder DSV7-Format würde die Meldung bei fremden Wettkämpfen
(über deren Meldeportale) erleichtern.
- **Nutzen:** Schließt den Kreis „Meldung raus, Ergebnis rein" komplett
  innerhalb der App statt in einer externen Tabelle.
- **Bezug zur Architektur:** Reine Export-Logik auf Basis der bestehenden
  `StartlistEntry`/`Competition`-Modelle; kein neuer Speicherbedarf.

### 2.2 Automatische Bestenlisten / Vereinsrekorde
Laufende Auswertung: pro Athlet:in und Strecke die persönliche Bestzeit,
pro Verein die Vereinsrekorde je Jahrgang/Strecke, mit Historie
(„Rekord gebrochen am …").
- **Nutzen:** Motivation für Athlet:innen, Vereins-Öffentlichkeitsarbeit
  (Aushänge, Homepage).
- **Bezug zur Architektur:** Reine Auswertung über bestehende `Result`-
  Daten, ähnlich `stats.js`/`charts.js`; keine neuen Schreibpfade nötig,
  ggf. ein neues (zubuchbares) Modul „Bestenliste".

### 2.3 Wettkampfplanung/-meldung als eigener Workflow
Bisher werden Wettkämpfe und Startlisteneinträge verwaltet, aber der
Ablauf „wer meldet sich wann für welchen Wettkampf an, Trainer:in
bestätigt/wählt aus" ist nicht abgebildet.
- **Nutzen:** Athlet:innen können sich selbst für Wettkämpfe interessieren/
  melden, Trainer:innen behalten die Auswahlhoheit — reduziert
  WhatsApp-/Zuruf-Koordination.
- **Bezug zur Architektur:** Neuer Status auf `StartlistEntry` (z. B.
  `requested` → `confirmed`) oder ein leichtgewichtiges neues Modell;
  Rollenrechte analog zum bestehenden Muster (athlete: eigene Anfrage
  anlegen, trainer/admin: bestätigen).

## 3. Trainingsplanung

### 3.1 Wiederkehrende Trainingspläne / Vorlagen-Zyklen
Ein mehrwöchiger Trainingszyklus (z. B. Aufbau → Taper → Wettkampf) als
Vorlage, die sich automatisch über mehrere Wochen auf `Plan`/`Session`
anwenden lässt, statt jede Woche einzeln aus Vorlagen zusammenzusetzen.
- **Nutzen:** Spart Trainer:innen wiederkehrende manuelle Arbeit,
  besonders in der Saisonvorbereitung.
- **Bezug zur Architektur:** Baut auf dem bestehenden `templates`/`plans`-
  Modell auf; „Zyklus" wäre eine Sequenz von Template-Referenzen mit
  Versatz in Wochen — passt ins bestehende Json-Feld-Muster.

### 3.2 Belastungssteuerung / Trainingsumfang-Auswertung
Aggregation von Streckenlänge/Intensität je Trainingseinheit und Zeitraum
(z. B. Wochenkilometer je Athlet:in/Gruppe), optional mit RPE-Erfassung
(subjektives Belastungsempfinden) durch Athlet:innen nach der Einheit.
- **Nutzen:** Trainingssteuerung auf Datenbasis statt Bauchgefühl,
  Übertrainings-Frühwarnung.
- **Bezug zur Architektur:** RPE bräuchte ein neues, kleines
  athletenseitiges Eingabefeld je Session-Teilnahme; die
  Umfangs-Auswertung ist reine Aggregation über bestehende `sessions`/
  `templates`-Daten (Sätze × Distanz), ähnlich `stats.js`.

### 3.3 Anwesenheitsstatistik & -prognose
Auswertung der bestehenden Anwesenheitsdaten (`sessions.attendance`) über
Zeit: Trends je Athlet:in/Gruppe, Auffälligkeiten (z. B. sinkende
Anwesenheit als Frühindikator für Drop-out).
- **Nutzen:** Trainer:innen erkennen frühzeitig, wer den Anschluss
  verliert.
- **Bezug zur Architektur:** Reine Auswertung, keine neuen Modelle.

## 4. Kommunikation

### 4.1 Vereinsinterne Nachrichten/Ankündigungen
Ein einfaches Ankündigungs-Modul (Trainer:in/Admin → Gruppe/Verein), z. B.
„Training fällt aus", getrennt von den bestehenden Kommentarfäden an
Übungen/Plänen, die themengebunden sind statt allgemein.
- **Nutzen:** Ein Ort für organisatorische Kommunikation statt externer
  Kanäle (WhatsApp-Gruppen etc.), inkl. Offline-Zustellung über die
  bestehende Sync-Warteschlange.
- **Bezug zur Architektur:** Neues, einfaches Modell `Announcement`
  (clubId/groupId-gescoped, ähnlich `ActionItem`), zubuchbares Modul nach
  bestehendem Muster; kombinierbar mit 1.2 (Push) für echte Zustellung.

### 4.2 Eltern-/Erziehungsberechtigten-Zugang
Ein eingeschränkter Zugang (neue Rolle oder Freigabe-Link) für Eltern
minderjähriger Athlet:innen: Trainingszeiten, Wettkampftermine, eigene
Ergebnisse des Kindes — read-only.
- **Nutzen:** Häufige Anfrage bei Vereinen mit Kinder-/Jugendabteilung;
  reduziert Nachfragen bei Trainer:innen.
- **Bezug zur Architektur:** Größerer Eingriff — bräuchte eine
  Eltern-Kind-Verknüpfung (`Athlete` ↔ mehrere `User` mit Rolle `parent`)
  und eine eigene, stark eingeschränkte Sicht auf bestehende Endpunkte;
  DSGVO-Aspekt (Datenminimierung, Einwilligung) ist zu klären, da bereits
  eine Consent-Infrastruktur besteht (`consentGivenAt`/`-Version`), die
  sich erweitern ließe.

## 5. Vereinsverwaltung

### 5.1 Mehrere Gruppen-Trainer:innen / Vertretungsregelung
Aktuell ist unklar (zu prüfen), ob eine Trainingsgruppe mehrere
zuständige Trainer:innen gleichzeitig haben kann. Eine explizite
Vertretungsregelung (Haupttrainer:in + Vertretung mit vollen Rechten für
diese Gruppe) würde Urlaubs-/Krankheitsvertretung erleichtern.
- **Nutzen:** Kein Datenzugriffsverlust bei Abwesenheit der Haupt-
  Trainer:in.
- **Bezug zur Architektur:** Analog zum bereits umgesetzten Mehrfachrollen-
  Modell (`docs/Plans/kampfrichter-modul-plan.md`, Phase A) — dort wurde bereits
  gelöst, dass eine Person mehrere Rollen gleichzeitig tragen kann; eine
  n:m-Beziehung `Group` ↔ `User` (statt aktuell vermutlich 1:n) wäre der
  naheliegende nächste Schritt in derselben Richtung.

### 5.2 Audit-Log für sicherheitsrelevante Aktionen
Ein Protokoll (wer hat wann welche Einladung erstellt/widerrufen, welches
Konto gelöscht, welche Rolle geändert) für Admins/Superadmins einsehbar.
- **Nutzen:** Nachvollziehbarkeit, auch im Hinblick auf DSGVO-
  Rechenschaftspflicht (Art. 5 Abs. 2 DSGVO).
- **Bezug zur Architektur:** Neues Append-only-Modell `AuditLogEntry`;
  ließe sich an denselben Stellen befüllen, an denen heute schon die
  bestehenden sicherheitsrelevanten Endpunkte (Einladungen, Löschungen,
  Rollenänderungen) liegen.

## 6. Technik / Plattform

### 6.1 Echtzeit-Sync (WebSocket/SSE statt Pull-Intervall)
In README/`docs/Plans/backend-plan.md` bereits als „Phase 6, optionale
Erweiterung" genannt: bisher holt `syncClient.js` Änderungen per
Pull-Zyklus ab; ein Push-Kanal (WebSocket oder Server-Sent Events) würde
Änderungen anderer Geräte nahezu sofort anzeigen — relevant z. B. im
Wettkampfmodus (`competitionLive.js`), wenn mehrere Zeitnehmer:innen
gleichzeitig Zeiten erfassen.
- **Nutzen:** Geringere Latenz genau dort, wo es zählt (Live-Wettkampf),
  ohne das robuste Offline-first-Grundprinzip (Outbox-Pattern) zu
  verändern — Echtzeit-Kanal wäre eine zusätzliche „Bitte jetzt pullen"-
  Benachrichtigung, kein Ersatz für den bestehenden Sync-Mechanismus.
- **Bezug zur Architektur:** Additiv zur bestehenden Sync-API: ein
  Websocket-Endpunkt, der bei erfolgreichem `push` allen anderen
  verbundenen Geräten desselben Vereins ein leichtgewichtiges „es gibt
  Neues" schickt, das dann ganz normal einen `pull()` auslöst — kein neuer
  Konfliktlogik-Pfad nötig.

### 6.2 Mehrsprachigkeit über Deutsch/vorhandene Sprachen hinaus
`i18n.js` existiert bereits (siehe `trLabel`/`trCode`/`t()` in fast allen
Modulen); zu prüfen, welche Sprachen aktuell abgedeckt sind und ob
weitere (z. B. für internationale Vereine oder Athlet:innen) sinnvoll
wären.
- **Nutzen:** Größere Zielgruppe, insbesondere für Vereine mit
  internationalen Athlet:innen/Trainer:innen.
- **Bezug zur Architektur:** Rein additiv — neue Übersetzungsdateien nach
  bestehendem Muster, keine strukturellen Änderungen.

### 6.3 Datenexport für externe Auswertung (CSV/Excel)
Über den bestehenden JSON-Export (DSGVO-Auskunft, Bibliothek-Transfer)
hinaus ein tabellarischer Export (CSV) für Ergebnisse/Anwesenheiten, den
Trainer:innen in Excel/Google Sheets weiterverarbeiten können.
- **Nutzen:** Viele Vereine nutzen parallel Tabellenkalkulationen für
  eigene Auswertungen; ein Bruch-freier Export erleichtert den Umstieg.
- **Bezug zur Architektur:** Reine Client-seitige Umformung bestehender
  Daten, kein Server-Endpunkt nötig (analog zu `planPdfExport.js`, das
  auch komplett client-seitig ohne Vendor-Library arbeitet).

## 7. Kampfrichter-Modul (Ausbau)

Das Kampfrichter-Modul (`docs/Plans/kampfrichter-modul-plan.md`) ist noch jung
(Phasen A–C gerade umgesetzt). Naheliegende Erweiterungen:

### 7.1 Kampfrichter-Einsatzplanung über mehrere Wettkämpfe
Automatischer Vorschlag, welche Kampfrichter:innen für einen Wettkampf
angefragt werden sollten, basierend auf Qualifikation und bisheriger
Einsatzhäufigkeit (Lastverteilung).
- **Nutzen:** Reduziert manuellen Koordinationsaufwand für die
  Kampfrichter-Einteilung, faire Verteilung der Einsätze.
- **Bezug zur Architektur:** Auswertung über bestehende
  Kampfrichter-Einsätze + Qualifikationen (beide bereits vorhanden);
  reine Vorschlagslogik, kein neuer Speicherbedarf.

### 7.2 Verbandsübergreifende Kampfrichter-Freigabe
Aktuell vereinsgescoped (`clubId`); ein Verein könnte anfragen, ob eine
Kampfrichter:in eines anderen Vereins für den eigenen Wettkampf zur
Verfügung steht — relevant, da Kampfrichter:innen oft vereinsübergreifend
bei Wettkämpfen anderer Vereine eingesetzt werden.
- **Nutzen:** Bildet den in der Praxis üblichen Ablauf ab, statt dass
  Vereine dafür weiterhin außerhalb der App koordinieren.
- **Bezug zur Architektur:** Größerer Eingriff — durchbricht das
  bisherige strikte Mandanten-Scoping und bräuchte einen bewussten,
  eng begrenzten Ausnahmepfad (z. B. explizite, einzelne Freigabe statt
  allgemeiner Sichtbarkeit über Vereinsgrenzen hinweg).

---

## Priorisierung: Phasenplanung

Die folgende Reihenfolge legt fest, welche Abschnitte zuerst angegangen
werden. Innerhalb eines Abschnitts sind alle Unterpunkte (z. B. 4.1 *und*
4.2 innerhalb von Abschnitt 4) Teil derselben Phase, außer explizit nur ein
Unterpunkt genannt ist (Abschnitt 1: nur 1.2, nicht 1.1/1.3; Abschnitt 2:
nur 2.2, nicht 2.1/2.3).

| Phase | Abschnitt(e) | Umfang |
|---|---|---|
| **Phase 1** | 3 | **Vollständig umgesetzt** — 3.1 Wiederkehrende Trainingspläne/Vorlagen-Zyklen, 3.2 Belastungssteuerung/Trainingsumfang-Auswertung, 3.3 Anwesenheitsstatistik & -prognose — detaillierter Umsetzungsplan inkl. Umsetzungsstand: `docs/Plans/trainingsplanung-phase1-plan.md` |
| **Phase 2** | 1.2, 4 | **Vollständig umgesetzt** — 1.2 Push-Benachrichtigungen, 4.1 Vereinsinterne Nachrichten/Ankündigungen, 4.2 Eltern-/Erziehungsberechtigten-Zugang — detaillierter Umsetzungsplan inkl. Umsetzungsstand: `docs/Plans/phase2-plan.md` |
| **Phase 3** | 5 | 5.1 Mehrere Gruppen-Trainer:innen/Vertretungsregelung, 5.2 Audit-Log für sicherheitsrelevante Aktionen |
| **Phase 4** | 2.2, 6.3 | 2.2 Automatische Bestenlisten/Vereinsrekorde, 6.3 Datenexport für externe Auswertung (CSV/Excel) |

**Begründung der Reihenfolge:**
- **Phase 1 (Trainingsplanung)** zuerst, da sie den Kernalltag von
  Trainer:innen betrifft (tägliche/wöchentliche Nutzung) und rein additiv
  auf bestehenden `templates`/`plans`/`sessions`-Daten aufbaut — kein
  Eingriff in Rollen-, Mandanten- oder Sync-Modell nötig.
- **Phase 2 (Push + Kommunikation)** baut logisch auf Phase 1 auf: 1.2
  liefert die Zustellinfrastruktur (Web-Push), die 4.1 (Ankündigungen)
  erst wirksam macht — ein Ankündigungs-Modul ohne Benachrichtigung würde
  seinen Zweck kaum erfüllen. 4.2 (Eltern-Zugang) ist architektonisch
  aufwendiger (neue Rolle, DSGVO-Prüfung) und deshalb bewusst zusammen
  mit, nicht vor der Push-Grundlage eingeordnet.
- **Phase 3 (Vereinsverwaltung)** danach, da 5.1 auf dem in
  `docs/Plans/kampfrichter-modul-plan.md` bereits gelegten
  Mehrfachrollen-Fundament aufsetzt und 5.2 (Audit-Log) von den bis dahin
  neu hinzugekommenen sicherheitsrelevanten Aktionen (Ankündigungen,
  Push-Abos) mit profitiert, wenn es nach ihnen kommt.
- **Phase 4 (Bestenlisten + CSV-Export)** bewusst abschließend: beides
  sind reine, unabhängige Auswertungs-/Exportfunktionen auf bereits
  bestehenden Daten (`Result`, `sessions`), ohne Abhängigkeit zu den
  vorherigen Phasen — sie liefern sichtbaren Mehrwert, sind aber am
  wenigsten dringlich für den Kernbetrieb.

**Nicht in dieser Phasenplanung enthalten** (Abschnitte 1.1, 1.3, 2.1, 2.3,
6.1, 6.2, 7.1, 7.2) sind für spätere, noch nicht terminierte Entwicklungen
vorgesehen und werden erst nach Abschluss von Phase 4 erneut priorisiert.
