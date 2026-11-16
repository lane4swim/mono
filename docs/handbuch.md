# Lane 1 — Funktionshandbuch

**Stand:** November 2026 · **Geltungsbereich:** alle Funktionen, die im Code
umgesetzt sind (Frontend `apps/web`, Backend `apps/api`). Geplante, noch nicht
umgesetzte Funktionen stehen gesammelt in [Abschnitt 15](#15-noch-nicht-umgesetzt).

Dieses Handbuch beschreibt **was** Lane 1 kann und **wer** es nutzen darf. Für
die Bedienung im Alltag gibt es zusätzlich die Hilfeseiten in der App
(`apps/web/help/`), für Rollen und Rechte im Detail das
[Rollenhandbuch](./rollenhandbuch.html), für Betrieb und Installation die
Anleitungen unter [`docs/deployment/`](./deployment/).

## Inhalt

1. [Überblick](#1-überblick)
2. [Rollen](#2-rollen)
3. [Zugang, Anmeldung und Konto](#3-zugang-anmeldung-und-konto)
4. [Navigation: Dashboard, Ansichten, Kalender](#4-navigation-dashboard-ansichten-kalender)
5. [Athlet:innen und Gruppen](#5-athletinnen-und-gruppen)
6. [Trainingsplanung](#6-trainingsplanung)
7. [Trainingseinheiten, Feedback und Handlungsfelder](#7-trainingseinheiten-feedback-und-handlungsfelder)
8. [Wettkämpfe](#8-wettkämpfe)
9. [Zeiten, Leistung und Statistiken](#9-zeiten-leistung-und-statistiken)
10. [Kommunikation: Ankündigungen, Push, Eltern-Zugang](#10-kommunikation-ankündigungen-push-eltern-zugang)
11. [Qualifikationen und Kampfrichterwesen](#11-qualifikationen-und-kampfrichterwesen)
12. [Vereinsverwaltung](#12-vereinsverwaltung)
13. [Superadmin und Plattformbetrieb](#13-superadmin-und-plattformbetrieb)
14. [Datenschutz (DSGVO)](#14-datenschutz-dsgvo)
15. [Noch nicht umgesetzt](#15-noch-nicht-umgesetzt)
16. [Anhang: Umsetzungsstand der Pläne](#16-anhang-umsetzungsstand-der-pläne)

---

## 1. Überblick

Lane 1 ist eine Trainingsmanagement-App für Schwimmvereine.

- **Progressive Web App:** läuft im Browser und lässt sich wie eine App auf
  Smartphone, Tablet oder Desktop installieren — ohne App Store.
- **Offline-first:** Alle fachlichen Eingaben (Zeiten, Pläne, Anwesenheit,
  Feedback …) funktionieren ohne Internet, z. B. am Beckenrand. Änderungen
  landen in einer lokalen Sync-Warteschlange und werden übertragen, sobald
  wieder eine Verbindung besteht. Der Verbindungsstatus steht oben in der App.
- **Mehrere Vereine auf einem Server:** Jeder Verein sieht ausschließlich
  seine eigenen Daten.
- **Zubuchbare Module:** Pro Verein lässt sich festlegen, welche Funktionspakete
  aktiv sind (siehe [12.6](#126-zubuchbare-module)).
- **Sprachen:** Deutsch und Englisch, umschaltbar oben rechts; die Wahl wird
  pro Konto gespeichert.
- **Demo:** `demo.html` zeigt die App mit Beispieldaten und drei festen Konten
  (Trainerin, Athletin, Administratorin) — ganz ohne Server. Demo-Daten bleiben
  im Browser und mischen sich nie mit echten Daten.

## 2. Rollen

Ein Konto kann **mehrere Rollen gleichzeitig** haben, z. B. Trainer:in und
Kampfrichter:in. Sichtbar ist dann alles, was mindestens eine der Rollen darf.

| Rolle | Aufgabe |
|---|---|
| **Superadmin** | Betreibt die Plattform: legt Vereine an, lädt deren ersten Admin ein, schaltet Module frei. Eigene Oberfläche unter `/admin`. Gehört zu keinem Verein. |
| **Admin** | Verwaltet einen Verein: Einladungen, Rollen, Athletenprofile, Vereinsangaben, Qualifikationen, Audit-Log. |
| **Trainer:in** | Trainingsplanung, Einheiten und Feedback, Wettkämpfe, Zeiten, Statistiken. Sieht alle Athlet:innen des Vereins. |
| **Athlet:in** | Sieht eigene Zeiten, Pläne der eigenen Gruppe, eigene Einheiten und Handlungsfelder. Optional mit einem Athletenprofil verknüpft. |
| **Kampfrichter:in** | Pflegt eigene Wettkampfeinsätze und sieht den eigenen Kampfrichter-Qualifikationsstatus. |
| **Erziehungsberechtigte:r** | Sieht eine eingeschränkte Übersicht der verknüpften Kinder (siehe [10.3](#103-eltern-zugang)). |

Welche Menüpunkte welche Rolle sieht:

| Bereich | Admin | Trainer:in | Athlet:in | Kampfrichter:in | Eltern |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ● | ● | ● | | |
| Kalender | ● | ● | ● | ● | ● |
| Ankündigungen | ● | ● | ● | | |
| Athleten & Team | ● | ● | | | |
| Trainingspläne | | ● | ● | | |
| Vorlagen, Abschnitts-Vorlagen, Übungskatalog | | ● | | | |
| Einheiten & Feedback | | ● | ● | | |
| Handlungsfelder | ● | ● | ● | | |
| Wettkämpfe | ● | ● | | | |
| Zeiten & Leistung | ● | ● | ● | | |
| Statistiken | ● | ● | | | |
| Anwesenheitsstatistik | ● | | | | |
| Qualifikationen\* | ● | ● | ● | | |
| Kampfrichter\* | ● | | | ● | |
| Nutzerverwaltung | ● | | | | |
| Audit-Log | ● | | | | |
| Sync-Warteschlange | ● | ● | | | |
| Mein Kind | | | | | ● |
| Mein Profil, Rechtliches | ● | ● | ● | ● | ● |

\* zubuchbares Modul — nur sichtbar, wenn der Verein es gebucht hat.

## 3. Zugang, Anmeldung und Konto

### 3.1 Einladung statt Registrierung
Es gibt keine offene Registrierung. Jedes Konto entsteht über einen zeitlich
befristeten, einmal verwendbaren Einladungslink:

- Der Superadmin lädt den ersten Admin eines neuen Vereins ein.
- Admins laden Trainer:innen, Athlet:innen, Kampfrichter:innen und
  Erziehungsberechtigte ihres Vereins ein.
- Die Einladung wird per E-Mail verschickt; der Link wird zusätzlich angezeigt
  und lässt sich kopieren, z. B. um ihn per Messenger weiterzugeben.
- Beim Öffnen des Links legt die Person ihr Passwort fest und stimmt der
  Datenverarbeitung zu.
- Offene Einladungen lassen sich widerrufen oder mit neuem Link erneuern.

### 3.2 Anmeldung
- Anmeldung mit E-Mail-Adresse und Passwort.
- **Passwort vergessen:** Über den Link auf der Anmeldeseite wird ein
  Zurücksetzen-Link per E-Mail verschickt.
- Sitzungen bleiben über automatisch erneuerte Tokens angemeldet; bei Verdacht
  auf ein gestohlenes Sitzungstoken werden alle Sitzungen beendet.

### 3.3 Zwei-Faktor-Anmeldung (TOTP)
- Zusätzlich zum Passwort ein 6-stelliger Code aus einer Authenticator-App.
- Einrichtung unter **Mein Profil → Sicherheit**: QR-Code scannen, Code
  bestätigen, Wiederherstellungscodes aufbewahren. Neue Wiederherstellungscodes
  lassen sich jederzeit erzeugen.
- **Pflicht:** für Superadmins (auf den meisten Servern vorgeschrieben); für
  Admins, wenn die Vereinsadministration es einschaltet. Wer verpflichtet ist,
  wird nach der Passworteingabe direkt zur Einrichtung geführt und kann sie
  nicht abschalten.
- **Zurücksetzen:** Admins setzen die Zwei-Faktor-Anmeldung von Mitgliedern
  ihres Vereins zurück (mit eigenem Passwort bestätigt), Superadmins die aller
  Vereine; das Konto eines Superadmins setzt nur der Serverbetrieb zurück
  (`npm run reset-mfa`). Die betroffene Person wird abgemeldet und per E-Mail
  informiert.

### 3.4 Mein Profil
- Name und bevorzugte Sprache ändern.
- E-Mail-Adresse und Passwort ändern (jeweils mit aktuellem Passwort bestätigt;
  Sicherheitshinweis per E-Mail).
- Push-Benachrichtigungen für dieses Gerät ein- und ausschalten.
- Zwei-Faktor-Anmeldung verwalten.
- Eigene Daten als JSON exportieren und das eigene Konto löschen
  (siehe [Abschnitt 14](#14-datenschutz-dsgvo)).

## 4. Navigation: Dashboard, Ansichten, Kalender

### 4.1 Dashboard
- **Trainer:innen/Admins:** aktive Athlet:innen und Gruppen, nächster
  Wettkampf, offene Handlungsfelder, kommende Trainingseinheiten mit geplanten
  Metern, letzte Einheiten mit Anwesenheit und Ø RPE, Hinweis auf auffällig
  gesunkene Anwesenheit, neueste Ankündigungen.
- **Athlet:innen:** persönliche Bestzeiten, nächstes Training, offene Ziele,
  anstehende Wettkämpfe.

### 4.2 Ansichten
Die Navigation lässt sich nach Aufgabe bündeln: **Verwaltung**,
**Trainingsplanung**, **Wettkampfteilnahme**, **Wettkampforganisation**.
Angeboten werden nur Ansichten, in denen die eigene Rolle etwas sehen darf.
Beim Start fragt die App nach der Ansicht (abschaltbar mit „Immer in dieser
Ansicht starten"); gewechselt wird über die Schaltfläche neben dem Logo.
Ansichten filtern nur die Navigation — sie schränken keine Rechte ein.

### 4.3 Kalender
Fasst alle relevanten Termine an einem Ort zusammen:

- geplante Trainingstage aus Trainingsplänen und erfasste Einheiten,
- Wettkämpfe mit Meldeschluss und interner Startauswahl,
- Fristen von Handlungsfeldern,
- Ablauf und Verlängerungslehrgang eigener Qualifikationen,
- eigene Kampfrichtereinsätze (mit Hinweis auf offene Anfragen).

Darstellung als Woche, Monat, Quartal oder Jahr; Termintypen sind per Farbe und
Symbol unterscheidbar und über Filter ein- und ausblendbar. Trainer:innen
wechseln zwischen **Meine Termine** (betreute Gruppen, zugewiesene Fristen) und
**Ganzer Verein**; ein Team-Filter grenzt auf einzelne Gruppen ein.

**Saisonplanung** (Trainer:innen/Admins): Schulferien, Feiertage,
Hallenbadschließungen und Trainingslager für den Verein oder eine Gruppe sowie
regelmäßige Trainingszeiten (Wochentage, Uhrzeit, Gültigkeitszeitraum, Ausfall
während Ferien oder Schließungen). Ein Klick auf einen Trainingstag ohne Plan
legt direkt einen Plan an.

## 5. Athlet:innen und Gruppen

- **Athletenprofile:** Name, Geburtsdatum, Geschlecht, Gruppe, Mitglied seit,
  Status aktiv/inaktiv, Notizen, optionale Athletenkennung (z. B. DSV-ID für den
  Ergebnisimport). Die Detailseite zeigt Anwesenheit, Bestzeiten und
  Handlungsfelder. Anlegen, Umbenennen und Löschen ist Admins vorbehalten.
- **Eigenes Konto:** Je Profil wird festgelegt, ob die Person nur vom Verein
  verwaltet wird oder ein eigenes Konto bekommen kann. Die Spalte **Konto**
  zeigt den Stand: vom Verein verwaltet, noch nicht eingeladen, eingeladen (mit
  Ablaufdatum) oder Konto aktiv.
- **Gruppen:** anlegen, bearbeiten, löschen; mit Kurzbeschreibung und
  **mehreren zuständigen Trainer:innen** (Vertretungsregelung). Die Zuordnung
  steuert u. a. „Meine Termine" im Kalender.

## 6. Trainingsplanung

### 6.1 Trainingspläne
- Wochenpläne für eine Gruppe mit beliebig vielen Trainingstagen, Status
  aktiv/archiviert, optionaler **Beckenlänge** (25 m/50 m).
- Inhalte je Tag:
  - **Sätze** mit Beschreibung, Distanz, Wiederholungen, Pause, Intensität und
    optional verknüpfter Übung,
  - **Wiederholungsblöcke**, z. B. „3× [2×25 Sprint, 50 locker]",
  - **Abschnitte** mit Überschrift, z. B. „Einschwimmen".
- Intensitätsstufen: Regeneration, Locker (GA2), Grundlage (GA1), Schwelle,
  Renntempo, Sprint/Maximal.
- Automatisch berechnete Gesamtmeter und geplante Gesamtzeit.
- Pläne duplizieren, aus Vorlagen befüllen, Übungen direkt im Editor
  einsehen und bearbeiten.
- **Kommentare** am ganzen Plan und an einzelnen Sätzen.
- **Drucken / als PDF speichern:** druckoptimierte Ansicht für den ganzen Plan
  oder einen einzelnen Tag, funktioniert offline.
- **Export/Import (JSON):** einzelne Pläne zwischen Trainer:innen oder Vereinen
  austauschen; der Export enthält keine Kommentare oder Vereinsdaten, fehlende
  Übungen werden beim Import im Katalog angelegt.
- Athlet:innen sehen die Pläne ihrer Gruppe lesend.

### 6.2 Trainingsmodus
Für den Beckenrand: führt Tag für Tag durch den Plan, Sätze lassen sich
abhaken, der Bildschirm bleibt eingeschaltet. Nur für Trainer:innen/Admins.

### 6.3 Vorlagen-Zyklen
Ein Zyklus bündelt mehrere Wochen aus Vorlagen, z. B. für die
Wettkampfvorbereitung. Beim **Anwenden** wählt man Startdatum und Zielgruppe;
Lane 1 erzeugt daraus die einzelnen Wochenpläne. Wochen lassen sich duplizieren
und entfernen.

### 6.4 Vorlagen, Abschnitts-Vorlagen und Übungskatalog
- **Vorlagen:** wiederverwendbare Trainingseinheiten mit Sätzen, Blöcken und
  Abschnitten, Tags und optionaler Beckenlänge; Karten- oder Listenansicht,
  duplizieren.
- **Abschnitts-Vorlagen:** wiederverwendbare Abschnitte wie „Einschwimmen", die
  sich in Pläne und Vorlagen einfügen lassen.
- **Übungskatalog:** durchsuchbare Übungsbibliothek mit Kategorie
  (Technik, Ausdauer, Sprint, Kraft, Beinarbeit, Atmung, Start & Wende,
  Koordination, Regeneration), Schwimmlage, Standarddistanz und -dauer, Tags,
  benötigter Ausrüstung und Kommentaren.
- **Export/Import (JSON):** Vorlagen, Abschnitts-Vorlagen und Übungen als
  gemeinsames Paket, ohne personenbezogene Daten — frei zwischen Vereinen
  teilbar.

## 7. Trainingseinheiten, Feedback und Handlungsfelder

### 7.1 Einheiten & Feedback
- Einheit erfassen: Datum, Gruppe, verknüpfter Plan, Trainernotiz.
- Je Athlet:in Anwesenheit (mit Fehlgrund), **RPE** (empfundene Belastung
  1–10) und Notiz.
- Anwesende Trainer:innen.
- Umfang in Metern: aus dem verknüpften Plan berechnet oder von Hand
  eingetragen.
- Athlet:innen sehen nur die Einheiten, an denen sie teilgenommen haben.

### 7.2 Handlungsfelder
Dokumentierte Beobachtungen und Entwicklungsziele je Athlet:in:
Titel, Kategorie (Technik, Kondition, Mental/Wettkampf, Verhalten/Einstellung,
Gesundheit/Belastung, Sonstiges), Status (offen, in Bearbeitung, erledigt),
Fälligkeitsdatum und zuständige:r Trainer:in. Athlet:innen sehen ihre eigenen.

## 8. Wettkämpfe

### 8.1 Wettkämpfe verwalten
- Wettkampf mit Name, Datum, Ort, Bahnlänge und Notizen; Liste nach anstehend
  und vergangen.
- **Fristen:** externer Meldeschluss und interne Startauswahl (Vorschlag:
  eine Woche vor Meldeschluss, sonst drei Wochen vor dem Wettkampf).
- **Aus DSV-Datei anlegen:** einen ganzen Wettkampf aus einer DSV7-/DSV8-Datei
  erzeugen.
- **Wettkampfdefinition laden (DSV7/DSV8):** übernimmt alle Disziplinen samt
  Wettkampfnummern und Pflichtzeiten.

### 8.2 Startliste
- Einträge mit Wettkampfnummer, Disziplin, Lauf, Startbahn und Meldezeit;
  Disziplinen lassen sich aus der Wettkampfdefinition wählen (passend zum
  Geschlecht gefiltert).
- **Pflichtzeiten-Prüfung:** je Eintrag farbig, ob die Pflichtzeit im
  Wettkampf (grün), nur im Training (gelb) oder noch nicht erreicht (rot) wurde.

### 8.3 Ergebnisse und Zeitmessung
- Ergebnisse mit Zeit, Platz und PB-Kennzeichnung; automatische
  Bestzeit-Erkennung.
- **Stoppuhr** mit Rundenzeiten direkt in der Startliste.
- **Wettkampfmodus** für den Beckenrand: startet beim ersten gesetzten Lauf,
  eine gemeinsame Stoppuhr pro Lauf plus je Athlet:in eine Karte für Runden-
  und Zielzeit, Schnellzugriff auf ein neues Handlungsfeld, Weiter zum nächsten
  Lauf. Der Bildschirm bleibt eingeschaltet.
- **Ergebnisimport (DSV7/DSV8):** Ergebnisliste hochladen, eigenen Verein
  erkennen oder auswählen, unbekannte Wettkämpfe zuordnen, neu anlegen oder
  ignorieren, Vorschau mit neuen/überschriebenen/übersprungenen Ergebnissen,
  dann bestätigen. Übernimmt Zeit, Platz, Zwischenzeiten und Status
  (disqualifiziert, nicht angetreten, abgemeldet, aufgegeben,
  Zeitüberschreitung); Kommentare bleiben erhalten. Athlet:innen werden über
  die Athletenkennung zugeordnet.

### 8.4 Kampfgericht
Je Wettkampf wird erfasst, wie viele Kampfrichter:innen der Verein stellen
muss. Admins teilen Kampfrichter:innen ein; diese bekommen eine Anfrage und
sagen zu oder ab. Der Wettkampf zeigt den Stand („2 von 3 zugesagt").

## 9. Zeiten, Leistung und Statistiken

### 9.1 Zeiten & Leistung
Zeiten aus Training und Wettkampf erfassen (Athlet:in, Disziplin, Zeit, Datum,
Bahnlänge, PB), filtern nach Athlet:in und Disziplin, Verlaufsdiagramm je
Disziplin. Athlet:innen sehen ihre eigenen Zeiten.

### 9.2 Statistiken (Trainer:innen/Admins)
- **Anwesenheit:** Quote je Gruppe, Trend über die Zeit, **Frühindikator** für
  Athlet:innen mit deutlich gesunkener Anwesenheit.
- **Belastung:** Trainingsumfang je Gruppe (m pro Kopf), Umfang gegenüber
  empfundener Belastung, RPE-Trend — für das Team oder einzelne Athlet:innen.
- **Leistung:** erfasste Zeiten pro Monat, Leistungsentwicklung je Athlet:in
  und Disziplin.

### 9.3 Anwesenheitsstatistik (Admins)
Übersicht für die Vereinsverwaltung: Einheiten, Ø anwesende Athlet:innen,
Anwesenheitsquote je Athlet:in und Trainer:innen im Einsatz — nach Gruppe und
Zeitraum (4 Wochen, 12 Wochen, 12 Monate, gesamt). Ohne RPE und Notizen.

## 10. Kommunikation: Ankündigungen, Push, Eltern-Zugang

### 10.1 Ankündigungen
Organisatorische Mitteilungen von Trainer:innen und Admins an eine Gruppe oder
den ganzen Verein. Erscheinen in der Liste und auf dem Dashboard; neue
Ankündigungen gehen zusätzlich als Push an die Empfänger:innen.

### 10.2 Push-Benachrichtigungen
In **Mein Profil** pro Gerät aktivierbar. Lane 1 schickt Push-Nachrichten
- bei neuen Ankündigungen für die eigene Gruppe oder den Verein,
- vor bevorstehenden Trainingseinheiten,
- vor dem Ablauf eigener Qualifikationen (zusätzlich zur E-Mail).

### 10.3 Eltern-Zugang
Admins laden Erziehungsberechtigte ein und verknüpfen sie in der
Nutzerverwaltung mit einem oder mehreren Kindern (**Kinder verwalten**).
Eltern sehen unter **Mein Kind** eine rein lesende Übersicht je Kind:
bevorstehende Einheiten und Wettkämpfe, letzte Ergebnisse, Bestzeiten,
Anwesenheit sowie den Kalender des Kindes.

## 11. Qualifikationen und Kampfrichterwesen

### 11.1 Qualifikationen (zubuchbar)
- Erfassung je Person: Art (Trainer-C/B/A-Lizenz, Rettungsschwimmschein
  Silber/Gold, Erste Hilfe, Kinderschutz, Kampfrichter-Ämter, Sonstige),
  Erwerbsdatum, optionales Ablaufdatum, geplanter Verlängerungslehrgang, Notiz.
- Status: gültig, läuft bald ab, abgelaufen, unbefristet, Verlängerung geplant.
- Jede Person sieht ihre eigenen Qualifikationen; **nur Admins** erfassen und
  ändern sie.
- **Erinnerungen:** E-Mail (und Push) an die Person und die Vereins-Admins vor
  Ablauf. Die Schwellen („Tage vor Ablauf") stellen Admins je
  Qualifikationsart ein.

### 11.2 Kampfrichter-Modul (zubuchbar)
- **Kampfrichter:innen:** eigener Kampfrichter-Qualifikationsstatus (lesend),
  eigene Wettkampfeinsätze erfassen (Datum, Wettkampf, Funktion, Notiz),
  Anfragen zu- oder absagen.
- **Admins:** Übersicht aller Kampfrichter:innen mit Qualifikationsstatus und
  Einsätzen; Einsätze im Namen einer Person erfassen.
- Funktionen: Kampfrichter:in, Schiedsrichter:in, Startrichter:in,
  Zeitnehmer:in, Bahnrichter:in, Wettkampfsekretär:in, Sonstige.

## 12. Vereinsverwaltung

Die **Nutzerverwaltung** ist für Admins in der normalen App erreichbar.

### 12.1 Einladungen
Trainer:innen, Athlet:innen, Kampfrichter:innen und Erziehungsberechtigte
einladen; Athlet:innen werden dabei mit einem einladbaren Athletenprofil
verknüpft. Liste aller Einladungen mit Status (ausstehend, angenommen,
abgelaufen, widerrufen), widerrufen oder Link erneuern.

### 12.2 Mitglieder und Rollen
- Mitgliederliste nach Rolle gruppiert.
- **Rollen verwalten:** Rollen eines Mitglieds hinzufügen oder entfernen. Ein
  Verein behält immer mindestens einen Admin. Die Person muss sich danach neu
  anmelden.
- Zwei-Faktor-Status je Mitglied, Zwei-Faktor-Anmeldung zurücksetzen.

### 12.3 Vereinsangaben
- **Vereinskennung** (z. B. DSV-Vereinskennzahl) für den automatischen
  Vereinsabgleich beim Ergebnisimport.
- **Zwei-Faktor-Pflicht für Admins** ein- und ausschalten.

### 12.4 Rechtliche Angaben
Impressum und Datenschutzhinweis je Verein: Anschrift, vertretungsberechtigte
Personen, Kontakt, Registerangaben, USt-IdNr., Datenschutz-Kontakt, zuständige
Aufsichtsbehörde, Datenschutzbeauftragte:r. Die Seite **Rechtliches &
Datenschutz** zeigt diese Angaben allen Mitgliedern; fehlende Felder erscheinen
als erkennbarer Platzhalter. Vor der Anmeldung bleibt die Seite allgemein.

### 12.5 Audit-Log
Rein lesendes Protokoll sicherheitsrelevanter Aktionen des Vereins, u. a.
Einladungen, Rollenänderungen, fehlgeschlagene Anmeldungen,
Passwort-/E-Mail-Änderungen, Modul- und Vereinsangaben-Änderungen,
Elternverknüpfungen, Qualifikationen, Kampfrichtereinsätze und alle
Zwei-Faktor-Ereignisse. Alte Einträge werden automatisch pseudonymisiert und
später gelöscht.

### 12.6 Zubuchbare Module
Der Superadmin schaltet je Verein frei, welche Pakete aktiv sind: Athleten,
Wettkämpfe, Zeiten, Trainingspläne, Vorlagen, Übungskatalog,
Abschnitts-Vorlagen, Einheiten, Handlungsfelder, Ankündigungen, Statistiken,
Qualifikationen, Kampfrichter. Nicht gebuchte Module sind weder in der
Navigation sichtbar noch über die Schnittstelle nutzbar.

## 13. Superadmin und Plattformbetrieb

### 13.1 Superadmin-Oberfläche `/admin`
Eigene, nur online nutzbare Oberfläche, getrennt von der App:
- Vereine anlegen (mit erster Admin-Einladung per E-Mail),
- Vereinsliste mit Mitgliederzahlen je Rolle,
- Module je Verein bearbeiten,
- Einladungen und Mitglieder beliebiger Vereine einsehen und verwalten,
- Status der Hintergrundjobs.

Der allererste Superadmin wird einmalig per Server-Skript angelegt.

### 13.2 Hintergrundjobs
Der Server führt seine Jobs selbst aus (kein Cron nötig); verpasste Läufe
werden nachgeholt, mehrere Server-Instanzen laufen nie doppelt.

| Job | Zeitplan | Aufgabe |
|---|---|---|
| Löschung & Bereinigung | täglich ab 02:00 UTC | endgültige Löschung vorgemerkter Konten, Bereinigung von Sync-Daten und altem Audit-Log |
| Qualifikations-Erinnerungen | täglich ab 03:00 UTC | E-Mail/Push vor Ablauf von Qualifikationen |
| Trainings-Erinnerungen | alle 6 Stunden | Push vor bevorstehenden Trainingseinheiten |

Status je Job (letzter Lauf, Ergebnis, Fehler, nächster Lauf) sehen
Superadmins in `/admin` und in der Nutzerverwaltung; `GET /health` meldet nur
`ok`, `stale` oder `unknown`.

### 13.3 Synchronisierung
- Jede Änderung landet zuerst in der lokalen **Sync-Warteschlange**
  (Trainer:innen/Admins sehen sie als eigenen Menüpunkt: offene Einträge,
  „Jetzt synchronisieren", Fehlerstatus, Aufräumen).
- Die App synchronisiert zusätzlich automatisch im Hintergrund.
- Konflikte werden je Datenart nach festen Regeln aufgelöst; Löschungen
  erreichen auch Geräte, die lange offline waren.

### 13.4 Installation und Updates
Installation als App über den Browser; neue Versionen werden im Hintergrund
geladen und beim nächsten Start aktiv. Betrieb auf Hetzner, netcup, OVHcloud,
Raspberry Pi, macOS oder GitHub Codespaces: siehe
[`docs/deployment/`](./deployment/).

## 14. Datenschutz (DSGVO)

- **Einwilligung** beim ersten Anmelden, mit Fassungsnummer gespeichert.
- **Auskunft (Art. 15):** „Alle meine Daten als JSON exportieren" in Mein
  Profil — Profil, Athletendaten, Ergebnisse, Startlisten, Handlungsfelder,
  Anwesenheit, Qualifikationen, Kampfrichtereinsätze. Ohne Verbindung werden
  die lokal gespeicherten Daten exportiert.
- **Löschung (Art. 17):** Konto sofort gesperrt und abgemeldet, endgültige
  Löschung nach der Aufbewahrungsfrist (Standard 30 Tage) durch den täglichen
  Job. Kommentare bleiben als „Gelöschtes Konto" erhalten, im Audit-Log wird
  die Person pseudonymisiert.
- **Rechtliche Angaben je Verein:** siehe [12.4](#124-rechtliche-angaben).
- **Datensparsame Exporte:** Plan- und Katalog-Exporte enthalten keine
  personenbezogenen Daten.

## 15. Noch nicht umgesetzt

| Thema | Stand |
|---|---|
| Lenex-Import | zurückgestellt; der Import ist formatunabhängig vorbereitet, es fehlt nur der Lenex-Parser |
| Push bei neuen Kommentaren und neuen Startlisten | bewusst zurückgestellt (nur zeitgesteuerte Push-Auslöser umgesetzt) |
| Normzeiten-Tracker | nur teilweise: Pflichtzeiten aus der DSV-Wettkampfdefinition werden geprüft; eigene Normzeiten-Tabellen je Altersklasse fehlen |
| Kampfrichter-Einsatzplanung mit Vorschlägen | offen; manuelle Einteilung je Wettkampf ist umgesetzt |
| Bestenlisten/Vereinsrekorde, CSV-/Excel-Export | als Nächstes geplant |
| Vereins-Branding, Startlisten-Export, World-Aquatics-Punkte, Pacing-Analyse, Staffel-Aufstellung, Leistungstests, persönliche Ziele, Vorab-Abmeldung, Kalender-Abo (iCal), Echtzeit-Sync, Vereins-Backup, weitere Sprachen | Ideen, noch nicht terminiert — siehe [`future-features-brainstorm.md`](./future-features-brainstorm.md) |

## 16. Anhang: Umsetzungsstand der Pläne

Geprüft gegen den Code im November 2026.

| Plan | Stand | Offene Reste |
|---|---|---|
| [backend-plan.md](./Plans/backend-plan.md) — Backend, Auth, Sync | umgesetzt | Turborepo bewusst nicht eingeführt |
| [beckenlaenge-regeneration-plan.md](./Plans/beckenlaenge-regeneration-plan.md) — Beckenlänge, Regeneration | umgesetzt | — |
| [club-legal-info-plan.md](./Plans/club-legal-info-plan.md) — Impressum/Datenschutz je Verein | umgesetzt (Iteration 1) | weitere Rechtsordnungen bewusst nicht umgesetzt |
| [dsv7-lenex-import-plan.md](./Plans/dsv7-lenex-import-plan.md) — Ergebnisimport | DSV7/DSV8 umgesetzt | Lenex zurückgestellt |
| [kampfrichter-modul-plan.md](./Plans/kampfrichter-modul-plan.md) — Mehrfachrollen, Kampfrichter | umgesetzt | alte Spalte `User.role` noch nicht entfernt; Nachtrag in `backend-plan.md` fehlt |
| [nutzer-qualifikationen-plan.md](./Plans/nutzer-qualifikationen-plan.md) — Qualifikationen | umgesetzt | — |
| [phase2-plan.md](./Plans/phase2-plan.md) — Push, Ankündigungen, Eltern | umgesetzt | ereignisgesteuerte Push-Auslöser zurückgestellt |
| [trainingsplanung-phase1-plan.md](./Plans/trainingsplanung-phase1-plan.md) — Zyklen, Belastung, Anwesenheit | umgesetzt | — |
| [vereinsverwaltung-phase3-plan.md](./Plans/vereinsverwaltung-phase3-plan.md) — Gruppen-Trainer:innen, Audit-Log | umgesetzt | Bereinigung von `Group.trainerIds` beim endgültigen Löschen eines Kontos fehlt (ohne sichtbare Auswirkung) |
| [zwei-faktor-anmeldung-plan.md](./Plans/zwei-faktor-anmeldung-plan.md) — TOTP | umgesetzt | — |
