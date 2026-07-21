# Lane 1 — Trainingsmanagement für Schwimmteams

Eine Offline-first, Single-Page Progressive Web App (PWA) für das
Trainingsmanagement eines Schwimmteams. Läuft vollständig im Browser,
speichert alle Daten lokal (IndexedDB) und benötigt nach dem ersten
Laden keine Internetverbindung mehr.

## Funktionsumfang

- **Athleten- & Teammanagement** — Profile, Trainingsgruppen. Athletenprofile (Name/Identität) werden ausschließlich von Admins/Superadmins angelegt, geändert und gelöscht; Trainer:innen sehen den Bestand und arbeiten damit (Zeiten, Pläne, Einheiten, Handlungsfelder), können aber keine neuen Athlet:innen per Namenseingabe hinzufügen oder bestehende umbenennen/entfernen
- **Wettkampfmanagement** — Wettkämpfe, Startlisten (Wettkampfnummer, Lauf, Startbahn) mit integrierter Stoppuhr (inkl. Rundenzeiten) zur direkten Zeitmessung, und Ergebniserfassung
- **Zeiten- & Leistungserfassung** — Bestzeiten, Verlaufsdiagramme
- **Trainingspläne** — Wochenkalender mit Sets/Serien **und Wiederholungsblöcken** (z. B. „3× [2×25 Sprint, 50 locker]“), aus Vorlagen erstellbar
- **Wiederverwendbare Vorlagen** für Trainingspläne
- **Übungskatalog** — durchsuchbare, taggable Übungsbibliothek inkl. benötigter Ausrüstung, direkt im Trainingsplan-Editor sichtbar und dort auch bearbeitbar (ohne den Übungskatalog verlassen zu müssen)
- **Einheiten-Tracking & Feedback** — Anwesenheit, RPE, Notizen
- **Handlungsfelder** — dokumentierte Entwicklungsziele je Athlet:in mit Status
- **Statistiken & Auswertungen** — Anwesenheitsquote, RPE-Trend, Leistungsentwicklung
- **Sync-Warteschlange** — Event-Queue (Outbox-Pattern) zur Vorbereitung einer künftigen Backend-Synchronisation, inkl. simulierter Übertragung in der Demo
- **Mehrsprachigkeit** — Deutsch (de-DE) und Englisch (en-US) von Anfang an, Sprachumschalter in der Kopfzeile, pro Nutzer:in gespeichert, leicht um weitere Sprachen erweiterbar
- **Mein Profil** — jede:r Nutzer:in kann eigene Kontodaten (Name, E-Mail) sowie die bevorzugte Sprache selbst verwalten; zusätzlich Auskunft (JSON-Export) und Löschung des eigenen Kontos gemäß DSGVO (Art. 15 + 17) — ruft die echten Backend-Endpunkte auf, mit lokalem Export als Ausweichlösung bei fehlender Internetverbindung
- **Nutzerverwaltung** — Superadministrator:innen legen Vereine an und laden deren ersten Admin per zeitlich befristetem Einladungslink ein (per echter E-Mail versendet); Admins laden Trainer:innen/Athlet:innen ihres Vereins ebenso ein. Zusätzlich: Anzeige bestehender Vereinsmitglieder, gruppiert nach Rolle (Admins/Trainer:innen/Athlet:innen) — für Admins automatisch der eigene Verein, für Superadministrator:innen je Verein über einen Button in der Vereinsliste.

Drei Rollen: **Trainer**, **Athlet** und **Administrator** (siehe unten).

## Lokal ausführen

Da die App ES-Module (`<script type="module">`) und einen Service
Worker verwendet, muss sie über **http(s)** ausgeliefert werden (nicht
per `file://` öffnen). Am einfachsten mit einem simplen lokalen Server,
z. B.:

```bash
cd swimapp
python3 -m http.server 8080
# dann im Browser: http://localhost:8080
```

Alternativ z. B. mit `npx serve` oder jedem anderen statischen
Webserver. Nach dem ersten Laden funktioniert die App auch offline
(Flugmodus, Server aus) — der Service Worker liefert dann alle
Dateien aus dem Cache, die Daten liegen bereits in IndexedDB.

## Installation als App

Im Browser (Chrome/Edge/Safari) über "Zum Startbildschirm hinzufügen"
bzw. das Installations-Icon in der Adressleiste. Die App startet dann
wie eine native App, inklusive Offline-Betrieb.

## Anmeldung & Rollen

Seit der Frontend-Integration mit `apps/api` (Phase 4) ist die Anmeldung
echt: E-Mail + Passwort + Pflicht-Einwilligung zur Datenverarbeitung,
gegen das Backend geprüft. Ein Konto entsteht ausschließlich per
Einladungslink (`#/accept-invite/<token>`) — es gibt keine offene
Registrierung. Um die App auszuprobieren, wird ein Backend
(`apps/api`, siehe dessen README) sowie mindestens ein Konto benötigt:

1. Ersten Superadmin anlegen: `npm run create-superadmin` (im Ordner `apps/api`).
2. Als Superadmin anmelden, unter „Nutzerverwaltung" einen Verein anlegen
   (erzeugt automatisch eine Admin-Einladung).
3. Den angezeigten Einladungslink öffnen, um das Admin-Konto zu aktivieren.
4. Als Admin weitere Trainer:innen/Athlet:innen einladen.

Rollen und ihre sichtbaren Bereiche:

| Rolle | Sichtbare Bereiche |
|---|---|
| Superadministrator:in | Dashboard, Mein Profil, Nutzerverwaltung (Vereine anlegen, Admin-Einladungen) |
| Administrator | Alle Bereiche inkl. Nutzerverwaltung (Team einladen) |
| Trainer:in | Alle Bereiche außer Nutzerverwaltung |
| Athlet:in | Dashboard, Zeiten, Trainingspläne, Einheiten, eigene Handlungsfelder, Mein Profil |

Fachliche Demo-Daten (Athlet:innen, Gruppen, ein Wettkampf, Übungen, ein
Trainingsplan) werden weiterhin beim ersten Start lokal geseedet und
dienen als Offline-Cache-Inhalt, sobald ein echtes Konto verbunden ist.

Unter **Einstellungen** (unten in der Seitenleiste) lassen sich alle
lokal zwischengespeicherten Daten als JSON exportieren oder auf die
Demo-Daten zurücksetzen (löscht nicht das Server-Konto).

**Superadmin-Oberfläche unter `/admin`:** Vereine anlegen und die
Vereinsübersicht (mit Admin-/Trainer:innen-/Athlet:innen-Zahlen je Verein)
gehören NICHT zur normalen App unter `/`, sondern zu einer eigenständigen,
bewusst **nur online verfügbaren** Oberfläche unter `apps/web/admin/`
(`index.html` + `admin.js`). Sie registriert keinen Service Worker und ist
im Haupt-Service-Worker explizit von Cache/Precache ausgeschlossen — ein
Aufruf ohne Internetverbindung schlägt bewusst fehl, statt (fälschlich)
die normale App anzuzeigen.

## Architektur & Erweiterbarkeit

- **Kein Build-Schritt.** Reines HTML/CSS/JS mit ES-Modulen — einfach
  zu hosten (auch als statische Dateien) und leicht nachvollziehbar.
- **`js/db.js`** — generischer IndexedDB-Wrapper (`getAll/get/put/remove`)
  über benannte "Stores". Ein neues Datenmodell = ein neuer Store-Name.
  `put()`/`remove()` schreiben bei jeder Änderung an einem fachlichen
  Store automatisch ein Event in den Store `syncQueue` (Outbox-Pattern,
  siehe unten) — Seed-/Import-Daten über `bulkPut()` lösen bewusst
  **keine** Sync-Events aus, da sie keine echte Nutzeraktion sind.
- **`js/router.js`** — minimaler Hash-Router mit Modul-Registry.
  Jedes Feature ist ein Modul mit `{ id, icon, roles, render() }` (der
  Navigationstext kommt über `t('nav.<id>')` aus dem i18n-System, nicht
  als fest codierter String im Modul). Neue Module registrieren sich in
  `js/app.js` und erscheinen automatisch in Navigation (Desktop-Seitenleiste
  & Mobile-Tableiste), inkl. Rollenfilterung über `roles`.
- **`js/i18n.js`** + **`js/i18n/de-DE.js`** / **`js/i18n/en-US.js`** —
  Übersetzungs-Engine (siehe eigener Abschnitt „Mehrsprachigkeit" unten).
- **`js/modules/*.js`** — ein Modul pro Fachbereich, lose gekoppelt
  über den Router (keine direkten Abhängigkeiten zwischen Modulen
  außer über `navigate()`).
- **`js/modules/setEditor.js`** — gemeinsame UI-Komponente für
  Sets/Serien, genutzt von Vorlagen und Trainingsplänen.
- **`js/utils.js`** — DOM-Helfer, Datumsfunktionen, Zeitformatierung,
  eigene, abhängigkeitsfreie SVG-Mini-Chart-Funktionen (kein CDN nötig
  → funktioniert offline).
- **`sw.js`** — Service Worker mit versioniertem Cache; beim Ändern
  von Dateien `CACHE_VERSION` erhöhen, damit Clients die neue Version
  laden.

### Ideen für künftige Erweiterungen

- Server-Sync-Adapter (z. B. REST/GraphQL) ergänzen, der die gleichen
  `db.js`-Funktionen im Hintergrund mit einem Server abgleicht
  (Conflict-Resolution nach `updatedAt`).
- Export/Import einzelner Bereiche (z. B. nur Übungskatalog) zum
  Teilen zwischen Vereinen.
- Push-Benachrichtigungen für anstehende Einheiten/Wettkämpfe.
- Weitere Sprachen über zusätzliche `js/i18n/<locale>.js`-Dateien (siehe unten).

### Sync-Warteschlange (Event Queue / Outbox-Pattern)

Unter **„Sync-Warteschlange"** (Trainer/Admin) wird sichtbar, was im
Hintergrund passiert: Jedes Anlegen, Bearbeiten oder Löschen an einem
fachlichen Datensatz (Athlet:innen, Pläne, Zeiten, …) erzeugt ein
Event mit Status `pending`. Seit Phase 4 ist die Synchronisierung echt
(siehe `js/syncClient.js`):

1. Der Button „Jetzt synchronisieren" sendet `pending`/`error`-Events an
   `POST /api/sync/push` und holt anschließend Änderungen anderer
   Geräte/Nutzer:innen über `GET /api/sync/pull` ab.
2. Erfolgreich übertragene Events werden als `synced` markiert
   (inkl. Zeitstempel), fehlgeschlagene als `error` mit Fehlermeldung
   und Retry-Zähler.
3. Vom Server abgeholte Änderungen werden über eigene
   `putWithoutSync()`/`removeWithoutSync()`-Funktionen (nicht die
   normalen `put()`/`remove()`) lokal übernommen — sonst würde jede
   abgeholte Änderung sofort wieder ein neues Outbox-Event erzeugen
   (Endlosschleife aus Push/Pull).

Die Anzahl offener Events erscheint als kleines Badge neben dem
Navigationspunkt.

## Mehrsprachigkeit (i18n)

Die App liegt von Anfang an in zwei Sprachpaketen vor: **Deutsch
(`de-DE`, Referenzsprache)** und **Englisch (`en-US`)**.

**Sprachwahl im UI:** In der Kopfzeile, direkt links neben dem
Konto-Auswahlfeld, sitzt ein kleines Sprach-Dropdown (🇩🇪/🇺🇸) — von
überall in der App mit einem Klick erreichbar. Die Auswahl wirkt
sofort auf die gesamte Oberfläche, ohne Neuladen.

**Datenmodell:** Jeder Nutzer-Datensatz im Store `users` trägt ein
Feld `locale` (z. B. `"de-DE"`, `"en-US"`) — die bevorzugte
Anzeigesprache dieses Kontos. Beim Wechseln des Kontos (oben rechts)
wechselt die Sprache automatisch mit; ändert man die Sprache über das
Dropdown, wird sie im aktuell aktiven Nutzer-Datensatz gespeichert
(`state.js: setUserLocale()`). Ohne bekannten Nutzer (z. B. ganz
erster Start) wird zunächst die Browsersprache erkannt, sonst auf
Deutsch zurückgefallen (`i18n.js: detectInitialLocale()`). Ein
Sprachwechsel löst dabei genau **einen** Re-Render aus (`setUserLocale()`
benachrichtigt nur die Sprach-Listener, nicht zusätzlich die
Konto-Listener) — jedes Fachmodul sichert seinen Render zusätzlich per
`beginRender()`/`isCurrent()` ab (`js/utils.js`), damit überlappende
Render-Aufrufe (gleich aus welchem Grund) nie zu doppelt angezeigtem
Inhalt führen können.

**Architektur:**
- **`js/i18n/de-DE.js`**, **`js/i18n/en-US.js`** — je ein flaches,
  nach Modul benanntes Schlüssel-Objekt (`{ athletes: {...}, plans: {...}, refdata: {...}, ... }`).
  `de-DE.js` ist die Referenz-/Fallback-Sprache; jeder neue Textschlüssel
  sollte zuerst dort ergänzt werden.
- **`js/i18n.js`** — die Engine: `t(key, vars)` löst einen Punkt-Pfad
  wie `t('athletes.deleteConfirm', { name })` in der aktiven Sprache
  auf, mit Fallback-Kette aktive Sprache → Deutsch → Schlüssel selbst
  (damit ein fehlender Text nie zum Absturz führt, sondern bestenfalls
  auffällt). `getAvailableLocales()` liefert die Liste fürs Dropdown.
- **Referenzdaten (Disziplinen, Schwimmlagen, Kategorien, Status, …)**
  bleiben in `js/refdata.js` unverändert als stabile, sprachunabhängige
  Codes (z. B. `"100 Freistil"`, `"technik"`, `"offen"`) — das sind die
  Werte, die tatsächlich in Athlet:innen, Ergebnissen, Plänen usw.
  gespeichert werden. Für die Anzeige übersetzt `trCode()` /
  `trLabel()` / `trOptions()` / `trOptionsFlat()` aus `i18n.js` diese
  Codes just-in-time in die aktive Sprache. Ein Wechsel der
  Anzeigesprache verändert also nie gespeicherte Daten, nur deren
  Darstellung.
- **`js/utils.js`** — `fmtDateLong()`/`fmtDateShort()` nutzen
  `getLocale()` für `toLocaleDateString()`, Datumsformate passen sich
  also ebenfalls an (z. B. `Mo., 12. Jan. 2026` vs. `Mon, Jan 12, 2026`).

**Eine weitere Sprache hinzufügen** (z. B. Französisch):
1. `js/i18n/de-DE.js` nach `js/i18n/fr-FR.js` kopieren (vollständigste
   Vorlage) und alle Werte übersetzen — Schlüssel-Struktur unverändert lassen.
2. In `js/i18n.js` im `LOCALES`-Objekt eine Zeile ergänzen:
   `'fr-FR': { label: 'Français', flag: '🇫🇷', dict: fr_FR }` (plus den
   passenden Import oben in der Datei).
3. Fertig — das Sprach-Dropdown, alle `t()`-Aufrufe und die
   Referenzdaten-Übersetzung (`refdata.*` im neuen Wörterbuch)
   funktionieren automatisch, ohne dass ein anderes Modul angefasst
   werden muss. Fehlt eine Übersetzung im neuen Sprachpaket, greift
   automatisch der Deutsch-Fallback.

## Design

Gestaltungsleitidee: die "Leinenmarkierung" (Lane Line) im
Schwimmbecken als wiederkehrendes Wellenmotiv, dazu eine an
Poolwasser/Kacheln angelehnte Farbpalette (tiefes Wasserblau, Petrol,
Chlor-Türkis als Akzent, Leinenkorall als Warnfarbe). Zeiten und
Zahlen werden konsequent in einer Monospace-Schrift gesetzt, Überschriften
in einer editorial wirkenden Serife.
