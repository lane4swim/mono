// shared "Sets/Serien" editor widget used
// by both templates.js and plans.js so the editing UX is consistent.
//
// An editable list is an array of "entries". Each entry is one of:
//   - a plain set:   { kind: 'set',     id, description, distance, reps, intensity, restSec, exerciseId? }
//   - a repeat block:{ kind: 'block',   id, label, repeatCount, sets: [ <plain set>, ... ] }
//   - a section:     { kind: 'section', id, heading, entries: [ <plain set | repeat block>, ... ] }
//
// Repeat blocks model classic swim-set notation like "3x [100 free,
// 50 kick]" without forcing the whole block to be typed out longhand.
// Sections group a run of sets/blocks under a heading (e.g. "Warm-up" /
// "Main set" / "Cool-down") — only ONE level deep: a section's `entries`
// can hold plain sets and repeat blocks, but not another section, exactly
// like a block's own `sets` can't hold another block (see entities.ts).
// Entries without a `kind` (older saved data) are treated as plain sets
// for backward compatibility — no data migration needed.
//
// Die Reihenfolge der Einträge IST die fachliche Aussage des Plans (was
// wird wann geschwommen), deshalb kann jeder Eintrag an jeder Stelle
// entstehen und sich bewegen: über/unter dem ausgewählten Eintrag
// einfügen (siehe createEditorState()/buildInsertPanel()) und eine
// Position auf-/abwärts verschieben (siehe moveEntry()/entryControls()). Beides gilt
// gleichermaßen für die oberste Ebene (Sätze, Wiederholungsblöcke UND
// Abschnitte) wie für die Sätze/Blöcke INNERHALB eines Abschnitts bzw.
// die Sätze INNERHALB eines Wiederholungsblocks — da jede Ebene auf ihrer
// EIGENEN Liste arbeitet, ist ein Verschieben über eine Abschnittsgrenze
// hinweg strukturell ausgeschlossen (nicht extra zu sperren).
import { el, clear, localId } from '../dom.js';
import { badge } from '../ui.js';
import { selectInput } from '../forms.js';
import { SET_INTENSITIES, EXERCISE_CATEGORIES, EQUIPMENT_ITEMS } from '../refdata.js';
import { t, trLabel, trOptions } from '../i18n.js';

// Sensible defaults when a set is created from a catalog exercise,
// since exercises don't carry pool-intensity/rest data themselves.
const CATEGORY_DEFAULTS = {
  technik:      { intensity: 'locker',    restSec: 15 },
  ausdauer:     { intensity: 'ga1',       restSec: 15 },
  sprint:       { intensity: 'sprint',    restSec: 40 },
  kraft:        { intensity: 'ga1',       restSec: 20 },
  kick:         { intensity: 'locker',    restSec: 15 },
  atmung:       { intensity: 'locker',    restSec: 15 },
  'start-wende':{ intensity: 'renotempo', restSec: 30 },
  koordination: { intensity: 'locker',    restSec: 15 },
};

function newBlankSet() {
  return { kind: 'set', id: localId('set'), description: '', distance: 100, durationSec: null, reps: 1, intensity: 'ga1', restSec: 20, equipment: [], comments: [] };
}

function newBlock() {
  return { kind: 'block', id: localId('block'), label: '', repeatCount: 3, sets: [newBlankSet()] };
}

function newSection() {
  return { kind: 'section', id: localId('section'), heading: '', entries: [] };
}

// Baut einen Abschnitt aus einer gespeicherten Abschnitts-Vorlage
// (sectionTemplates.js) — frische ids wie cloneItems(), damit die Vorlage
// selbst unverändert bleibt.
function sectionFromTemplate(tpl) {
  return { kind: 'section', id: localId('section'), heading: tpl.name, entries: cloneItems(tpl.entries || []) };
}

function setFromExercise(exercise) {
  const defaults = CATEGORY_DEFAULTS[exercise.category] || { intensity: 'ga1', restSec: 20 };
  // Übungen mit einer eigenen Standarddauer (typischerweise Kraft-/
  // Trockentraining) bekommen KEINE Distanz aufgezwungen — der
  // 100m-Fallback unten gilt nur, wenn die Übung weder Distanz noch Dauer
  // vorgibt (der bisherige Fall vor Einführung von defaultDurationSec).
  const hasDefaultDuration = exercise.defaultDurationSec != null;
  return {
    kind: 'set',
    id: localId('set'),
    description: exercise.name,
    distance: exercise.defaultDistance || (hasDefaultDuration ? null : 100),
    durationSec: exercise.defaultDurationSec ?? null,
    reps: 1,
    intensity: defaults.intensity,
    restSec: defaults.restSec,
    exerciseId: exercise.id,
    // Startwert = Katalog-Standard der Übung, ab hier aber unabhängig
    // editierbar (siehe equipmentForEntry() unten) — Ändern hier wirkt
    // sich NICHT auf den Katalogeintrag aus.
    equipment: [...(exercise.equipment || [])],
    comments: [],
  };
}

// Total distance across a mixed list of plain sets and repeat blocks.
// A block's inner distance is computed once and then multiplied by its
// repeatCount — this is the one place that "correctly" defines what a
// block's total distance means, so every other view (plan detail,
// template cards, stats) should go through this function rather than
// re-implementing the sum.
export function totalDistance(items) {
  return (items || []).reduce((sum, entry) => {
    if (entry.kind === 'block') {
      const inner = totalDistance(entry.sets || []);
      return sum + inner * (entry.repeatCount || 1);
    }
    if (entry.kind === 'section') {
      return sum + totalDistance(entry.entries || []);
    }
    return sum + (entry.distance || 0) * (entry.reps || 1);
  }, 0);
}

// Geplante Gesamtzeit (Sekunden) über eine Liste von Sätzen/Blöcken/
// Abschnitten — Pendant zu totalDistance() oben, strukturell identisch
// (Block-Innensumme × repeatCount, Abschnitt rekursiv unverändert
// durchgereicht). Ein Satz OHNE durationSec (reine Distanz-Sätze) trägt
// GAR NICHTS bei, auch nicht seine Pause: wie lange 100m Schwimmen
// tatsächlich dauern, ist unbekannt und wird bewusst nicht geschätzt —
// nur explizit erfasste Zeit-Sätze zählen zur "Nettozeit". Würde die
// Pause reiner Distanz-Sätze mitgezählt, wäre die Summe für praktisch
// jeden Bestandsplan > 0 (restSec ist ein Pflichtfeld mit typischen
// Default-Werten von 15-40s, siehe CATEGORY_DEFAULTS/newBlankSet oben)
// und die "planDuration > 0"-Anzeigebedingung in plans.js/
// planPdfExport.js liefe leer — genau das rein distanzbasierte
// Bestandsplan-Rauschen, das sie vermeiden soll. Deshalb speist diese
// Funktion auch NICHT die Belastungssteuerung (trainingLoad.js bleibt
// reine Meter-Auswertung) — nur die Anzeige der geplanten Trainingszeit.
export function totalDuration(items) {
  return (items || []).reduce((sum, entry) => {
    if (entry.kind === 'block') {
      const inner = totalDuration(entry.sets || []);
      return sum + inner * (entry.repeatCount || 1);
    }
    if (entry.kind === 'section') {
      return sum + totalDuration(entry.entries || []);
    }
    if (entry.durationSec == null) return sum;
    const reps = entry.reps || 1;
    return sum + (entry.durationSec + (entry.restSec || 0)) * reps;
  }, 0);
}

// "45 Sek" unterhalb einer Minute, sonst "1:30 Min" — eigenständig statt
// über swimTime.js (secToTime), das Hundertstel für Wettkampfzeiten
// formatiert; ein Trainingszeit-Satz kennt nur ganze Sekunden. Exportiert,
// damit plans.js einzelne durationSec-Werte in Tabellen genauso formatiert
// wie formatQuantity() es hier für Vorlagenkarten/PDF bereits tut (siehe
// Code-Review), statt Rohsekunden ("90s" statt "1:30 Min") anzuzeigen.
export function formatDuration(sec) {
  if (sec < 60) return t('setEditor.durationSecShort', { s: sec });
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return t('setEditor.durationMinShort', { m, s: String(s).padStart(2, '0') });
}

// Für die Gesamtzeitanzeige (Editor-Summe, Plan-Übersicht, PDF): auf ganze
// Minuten gerundet statt sekundengenau, da die zugrundeliegende Summe
// ohnehin nur eine Planungsgröße ist (Pausenzeiten sind Vorgaben, keine
// Messwerte).
export function formatTotalDuration(sec) {
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? t('setEditor.totalDurationHours', { h, m }) : t('setEditor.totalDurationMinutes', { m });
}

// Eingabe-/Anzeigeformat "mm:ss" für das Dauer-Eingabefeld im Editor
// (buildSetRow() unten) — eigenständig statt über swimTime.js
// (secToTime/timeToSec), das Hundertstel für Wettkampfzeiten formatiert
// und Stunden zulässt; ein Trainingszeit-Satz kennt nur ganze Sekunden.
// Bewusst getrennt von formatDuration() oben: das dort verwendete
// Wortformat ("45 Sek"/"1:30 Min") ist für Anzeige-Badges gedacht, nicht
// als rückparsbares Eingabeformat.
export function durationToMinSec(sec) {
  // Falsy-Check statt "== null": catalog.js übergibt für eine neue,
  // ungespeicherte Übung '' (Leerstring, analog zum Distanzfeld dort)
  // statt null — beides soll ein leeres Eingabefeld ergeben.
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Akzeptiert "mm:ss" (bzw. "m:ss") UND eine reine Zahl ohne Doppelpunkt
// (dann als Sekunden gelesen — Tippgewohnheit aus der Zeit vor diesem
// Feld). Ungültige/leere Eingaben ergeben null (= "keine Dauer"), analog
// zum Distanzfeld daneben.
export function minSecToDuration(str) {
  const trimmed = (str || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 2 || parts.some(p => p === '' || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  const sec = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0];
  return sec > 0 ? Math.round(sec) : null;
}

// Eingabemaske für die mm:ss-Felder (Zeit und Pause im Satz-Editor): lässt
// nur Ziffern und EINEN Doppelpunkt zu, begrenzt Minuten und Sekunden auf
// je zwei Stellen und setzt nach den ersten zwei Ziffern automatisch den
// Doppelpunkt ("130" → "13:0"). Ein selbst getippter Doppelpunkt bleibt
// stehen, damit auch "m:ss" ("1:30") eingebbar ist. Beim Löschen
// (`deleting`) wird der Doppelpunkt NICHT neu eingefügt — sonst ließe sich
// "12:" per Rücktaste nie auf "12" zurücksetzen.
export function maskMinSec(raw, deleting = false) {
  const cleaned = String(raw ?? '').replace(/[^\d:]/g, '');
  const colon = cleaned.indexOf(':');
  if (colon === -1) {
    const digits = cleaned.slice(0, 4);
    if (digits.length > 2 || (digits.length === 2 && !deleting)) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    return digits;
  }
  const min = cleaned.slice(0, colon).slice(0, 2);
  const sec = cleaned.slice(colon + 1).replace(/:/g, '').slice(0, 2);
  return `${min}:${sec}`;
}

// Wie minSecToDuration(), liest aber einen offenen Doppelpunkt ("12:",
// direkt nach dem automatischen Einfügen durch maskMinSec()) als volle
// Minuten — sonst wäre der Wert bis zur ersten Sekundenziffer null.
function maskedToDuration(str) {
  return minSecToDuration(str.endsWith(':') ? `${str}00` : str);
}

// Position direkt hinter der n-ten Ziffer in `str` — damit die Schreibmarke
// nach dem Umformatieren durch maskMinSec() an derselben Ziffer bleibt,
// statt bei jeder Eingabe in der Feldmitte ans Ende zu springen.
function caretAfterDigits(str, n) {
  let pos = 0;
  for (let seen = 0; pos < str.length && seen < n; pos++) {
    if (str[pos] !== ':') seen++;
  }
  return pos;
}

// Ein mm:ss-Eingabefeld mit Maske (maskMinSec()). `onValue` erhält die
// Sekunden (null bei leerer/ungültiger Eingabe). type="text" statt
// "number", weil ein Doppelpunkt in einem <input type="number"> nicht
// eingebbar ist. KEIN inputmode="numeric": das zeigt auf Touchgeräten eine
// rein numerische Tastatur OHNE Doppelpunkt — "m:ss" wäre dort nicht mehr
// eingebbar (Poolside-Tablets sind der Hauptanwendungsfall dieser App,
// siehe sw.js-Kommentare).
function minSecInput(sec, onValue) {
  return el('input', {
    type: 'text', value: durationToMinSec(sec), placeholder: t('setEditor.durationPlaceholder'),
    oninput: (e) => {
      const input = e.target;
      const raw = input.value;
      const deleting = (e.inputType || '').startsWith('delete');
      const masked = maskMinSec(raw, deleting);
      if (masked !== raw) {
        const caret = input.selectionStart ?? raw.length;
        const atEnd = caret >= raw.length;
        const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
        input.value = masked;
        const pos = atEnd ? masked.length : caretAfterDigits(masked, digitsBefore);
        input.setSelectionRange?.(pos, pos);
      }
      onValue(maskedToDuration(masked));
    },
    // Beim Verlassen in die kanonische Schreibweise bringen ("12:" →
    // "12:00", "1:5" → "1:05"); Ungültiges wird geleert, passend zum
    // bereits auf null gesetzten Wert.
    onblur: (e) => { e.target.value = durationToMinSec(maskedToDuration(e.target.value)); },
  });
}

// Eine Mengenangabe ("3×100 m", "3×45 Sek", "3×100 m · 45 Sek", "3×—") für
// EINEN Satz — einzige Stelle, die Distanz und Dauer zu einem kompakten
// Label zusammensetzt, damit alle Ansichten (PDF, Vorlagenkarten) dieselbe
// Schreibweise zeigen. Sind BEIDE gesetzt, steht die Zeit als eigene,
// durch " · " abgetrennte Angabe daneben — NICHT als zusätzlicher
// Multiplikationsfaktor ("3×100 m×45 Sek" läse sich wie 3 Wiederholungen
// von je 100m UND je 45 Sekunden, was am Wiederholungsfaktor vorbei einen
// zweiten, so nicht gemeinten Multiplikator suggeriert).
export function formatQuantity(entry) {
  const reps = entry.reps || 1;
  const parts = [];
  if (entry.distance != null) parts.push(`${entry.distance} m`);
  if (entry.durationSec != null) parts.push(formatDuration(entry.durationSec));
  return `${reps}×${parts.length > 0 ? parts.join(' · ') : '—'}`;
}

// Deep-clones a list of entries with fresh ids — used when copying a
// template's sets into a new plan day, so editing the plan can never
// mutate the original template (or another day) via shared references.
//
// `resetComments` (used when duplicating a whole Plan/Template — see
// duplicatePlan()/duplicateTemplate()/duplicateSectionTemplate()): clears
// each plain set's `comments` instead of carrying the source's over.
// Required, not just tidy — sync.commentAuthorship.ts (apps/api) only
// allows a pushed comment to keep a foreign authorId when it already
// exists on the server record with the SAME id; a duplicate always has a
// brand-new id, so any carried-over foreign-authored comment would be
// rejected by the push (see also importLibrary() in libraryTransfer.js,
// which resets comments for the same reason).
export function cloneItems(items, { resetComments = false } = {}) {
  return (items || []).map(entry => {
    if (entry.kind === 'block') {
      return {
        ...entry, id: localId('block'),
        sets: (entry.sets || []).map(s => resetComments ? { ...s, id: localId('set'), comments: [] } : { ...s, id: localId('set') }),
      };
    }
    if (entry.kind === 'section') {
      return { ...entry, id: localId('section'), entries: cloneItems(entry.entries || [], { resetComments }) };
    }
    return resetComments ? { ...entry, id: localId('set'), comments: [] } : { ...entry, id: localId('set') };
  });
}

// Ineffizienz-Korrektur: id -> Übung, EINMAL je `exercises`-Array
// aufgebaut und danach für jede weitere Abfrage desselben Arrays
// wiederverwendet. Das Array wird von einem `.find(...)` je Satz linear
// durchsucht — und zwar an fünf Stellen (collectEquipment() unten,
// setRow()/dem Bearbeiten-Dialog hier, equipmentDescCell() in plans.js,
// buildSetRow() in planPdfExport.js, der Vorlagenvorschau in
// templates.js), jeweils einmal PRO SATZ. Ein Wochenplan mit hundert
// Sätzen gegen einen Übungskatalog mit einigen hundert Einträgen
// bedeutete damit fünfstellige Vergleichszahlen bei jedem Rendern.
//
// Als WeakMap über die Array-Identität statt als Parameter, damit die
// bestehenden Signaturen (`(…, exercises)`) unverändert bleiben und alle
// Aufrufer den Index automatisch teilen: `getAll('exercises')` liefert je
// Render ein NEUES Array, ein veralteter Index kann also gar nicht erst
// weiterverwendet werden; das alte Array (samt Index) wird verworfen,
// sobald es unerreichbar ist.
const exerciseIndexCache = new WeakMap();

export function exerciseById(exercises) {
  const list = exercises || [];
  let index = exerciseIndexCache.get(list);
  if (!index) {
    index = new Map(list.map(x => [x.id, x]));
    exerciseIndexCache.set(list, index);
  }
  return index;
}

// Material für GENAU EINEN Satz: `entry.equipment` (eigener, im Plan/in
// der Vorlage editierbarer Wert) hat Vorrang, wenn gesetzt — auch als
// bewusst geleertes Array (Material entfernt). Fehlt das Feld ganz
// (Altbestand vor Einführung dieses Felds), fällt die Anzeige auf das
// Material der verknüpften Katalogübung zurück, damit vor dieser Änderung
// gespeicherte Pläne/Vorlagen nicht plötzlich "kein Material" zeigen.
// Sets ohne Katalogverknüpfung und ohne eigenen Wert liefern `[]`.
export function equipmentForEntry(entry, exercises) {
  if (Array.isArray(entry.equipment)) return entry.equipment;
  if (entry.exerciseId) {
    const ex = exerciseById(exercises).get(entry.exerciseId);
    return ex?.equipment || [];
  }
  return [];
}

// Collects the de-duplicated set of equipment codes needed across a
// (possibly nested, block-containing) list of entries — see
// equipmentForEntry() above for how one entry's own equipment is
// determined.
export function collectEquipment(items, exercises) {
  const codes = new Set();
  const walk = (list) => {
    (list || []).forEach(entry => {
      if (entry.kind === 'block') { walk(entry.sets || []); return; }
      if (entry.kind === 'section') { walk(entry.entries || []); return; }
      equipmentForEntry(entry, exercises).forEach(eq => codes.add(eq));
    });
  };
  walk(items);
  return [...codes];
}

// ---- Umsortieren / Einfügen (reine Listenlogik, ohne DOM) ----
//
// Bewusst als eigenständige, exportierte Funktionen statt inline in den
// Klick-Handlern: so ist die eigentliche Fachlogik ("was passiert mit
// der Liste?") ohne DOM-Umgebung testbar (siehe test/setEditor.test.js),
// und die Handler unten bleiben einzeilig.

// Verschiebt den Eintrag an Position `index` um `delta` Positionen
// (−1 = eins nach oben, +1 = eins nach unten). `list` wird IN PLACE
// verändert — die aufrufende Ansicht arbeitet durchgehend auf genau dem
// Array, das später gespeichert wird. Gibt zurück, ob tatsächlich
// verschoben wurde: am Listenanfang/-ende passiert nichts, statt
// stillschweigend an den Rand zu springen (das wäre für die Nutzerin
// nicht von "Knopf kaputt" zu unterscheiden).
export function moveEntry(list, index, delta) {
  if (!Array.isArray(list)) return false;
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return false;
  const target = index + delta;
  if (target < 0 || target >= list.length || target === index) return false;
  const [entry] = list.splice(index, 1);
  list.splice(target, 0, entry);
  return true;
}

// Fügt `entry` an Position `index` ein (0 = ganz an den Anfang,
// list.length = ans Ende). Der Index wird auf den gültigen Bereich
// begrenzt, damit ein zwischenzeitlich veralteter Einfügepunkt (z. B.
// nach dem Entfernen anderer Zeilen) nie danebengreift. Gibt die
// tatsächlich verwendete Position zurück.
export function insertEntry(list, index, entry) {
  const at = Math.max(0, Math.min(Number.isInteger(index) ? index : list.length, list.length));
  list.splice(at, 0, entry);
  return at;
}

// Sortiert Übungen nach (übersetzter) Kategorie, dann nach Bezeichnung —
// gemeinsam genutzt vom Katalog-Dropdown hier UND vom Übungskatalog
// selbst (catalog.js), damit beide Ansichten dieselbe Reihenfolge zeigen.
export function compareByCategoryThenName(a, b) {
  const catA = trLabel(EXERCISE_CATEGORIES, a.category, 'exerciseCategories') || '';
  const catB = trLabel(EXERCISE_CATEGORIES, b.category, 'exerciseCategories') || '';
  return catA.localeCompare(catB) || (a.name || '').localeCompare(b.name || '');
}

// Kompakte, schreibgeschützte Vorschau einer Satz-/Block-/Abschnittsliste
// (Karten/Listen in templates.js und sectionTemplates.js) — EIN Ort für
// Badge, Beschreibung, Ausrüstungs-Pills und Distanz-Suffix, damit
// zukünftige Formatänderungen nicht an zwei Stellen auseinanderlaufen
// können (siehe Issue #70).
//
// allowSection: false — für Abschnitts-Vorlagen, deren `entries` laut
// Schema (entities.ts) keine verschachtelten Abschnitte enthalten können.
// Ein `section`-Eintrag wird in diesem Fall still übersprungen statt einen
// Fehler zu werfen: er sollte laut Schema nie auftreten, und ein Rendering-
// Helfer ist nicht der Ort, um das durchzusetzen.
export function renderEntryList(entries, exercises, { allowSection = true } = {}) {
  const list = el('div', { class: 'mb-8' });
  (entries || []).forEach(entry => {
    if (entry.kind === 'block') {
      list.appendChild(el('div', { class: 'list-row' }, [
        el('span', { style: 'flex:1' }, [badge(`${entry.repeatCount || 1}×`, 'progress'), ' ', entry.label || t('templates.defaultBlockLabel'), el('span', { class: 'hint' }, t('templates.setsCountSuffix', { count: (entry.sets || []).length }))]),
        el('span', { class: 'data text-sm' }, `${totalDistance(entry.sets || []) * (entry.repeatCount || 1)}m`),
      ]));
    } else if (entry.kind === 'section') {
      if (!allowSection) return;
      list.appendChild(el('div', { class: 'list-row' }, [
        el('span', { style: 'flex:1' }, [badge(t('templates.sectionLabel'), 'neutral'), ' ', entry.heading || t('plans.defaultSectionHeading'), el('span', { class: 'hint' }, t('templates.entriesCountSuffix', { count: (entry.entries || []).length }))]),
        el('span', { class: 'data text-sm' }, `${totalDistance(entry.entries || [])}m`),
      ]));
    } else {
      const equipment = equipmentForEntry(entry, exercises);
      list.appendChild(el('div', { class: 'list-row' }, [
        el('span', { style: 'flex:1' }, [
          entry.description || '—',
          equipment.length > 0
            ? el('div', { class: 'pill-group', style: 'margin-top:3px' }, equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb')))
            : null,
        ].filter(Boolean)),
        el('span', { class: 'data text-sm' }, formatQuantity(entry)),
      ]));
    }
  });
  return list;
}

function buildExerciseOptions(exercises) {
  return [{ value: '', label: t('setEditor.pickExercise') }, ...exercises
    .slice()
    .sort(compareByCategoryThenName)
    .map(ex => ({ value: ex.id, label: `${trLabel(EXERCISE_CATEGORIES, ex.category, 'exerciseCategories')} · ${ex.name}` }))];
}

// ---- Auswahl & Einfügen (ein Zustand je Editor-Instanz) ----
//
// Die Zeilen-Aktionen (hoch/runter/entfernen, darüber/darunter einfügen)
// erscheinen NUR am gerade ausgewählten Eintrag — sonst würde eine lange
// Liste von Knöpfen dominiert. Ausgewählt wird per Klick in den Eintrag
// oder per Fokus (Tab) auf eines seiner Felder. Das Umschalten der Auswahl
// tauscht nur eine CSS-Klasse (kein Neuzeichnen), damit der Fokus im
// gerade bearbeiteten Eingabefeld erhalten bleibt.
//
// Der Dialog zum Anlegen eines neuen Eintrags (buildAddControls()) ist
// standardmäßig nur in einer LEEREN Liste sichtbar; sonst öffnet ihn erst
// "darüber/darunter einfügen" genau an dieser Stelle (`pending`). Es gibt
// immer höchstens EINEN offenen Einfügedialog im ganzen Editor, deshalb
// zeichnen Strukturänderungen (einfügen, verschieben, entfernen) stets den
// gesamten Editor neu (`redrawAll`) statt nur die betroffene Teilliste.
function createEditorState() {
  const state = {
    selected: null,      // ausgewählter Eintrag (Objektreferenz, überlebt Neuzeichnen)
    selectedNode: null,  // zugehöriger DOM-Knoten der aktuellen Zeichnung
    pending: null,       // { list, index } — offener Einfügedialog
    redrawAll: () => {},

    // Markiert `node` als auswählbaren Eintrag. Klicks/Fokus in einem
    // verschachtelten Eintrag (Satz im Block im Abschnitt) wählen nur den
    // INNERSTEN aus — die äußeren Knoten sehen dasselbe Event beim
    // Hochblubbern, ignorieren es aber über den closest()-Vergleich.
    bindSelectable(node, entry) {
      node.classList.add('entry-selectable');
      if (state.selected === entry) {
        node.classList.add('is-selected');
        state.selectedNode = node;
      }
      const handler = (e) => {
        // Nach einer Aktion, die neu gezeichnet hat (z. B. Entfernen),
        // ist `node` bereits ausgehängt — dann nichts mehr auswählen.
        if (!node.isConnected) return;
        if (e.target.closest?.('.entry-selectable') !== node) return;
        state.select(entry, node);
      };
      node.addEventListener('click', handler);
      node.addEventListener('focusin', handler);
    },

    select(entry, node) {
      if (state.selectedNode && state.selectedNode !== node) state.selectedNode.classList.remove('is-selected');
      state.selected = entry;
      state.selectedNode = node;
      node.classList.add('is-selected');
    },

    openInsert(list, index) {
      state.pending = { list, index };
      state.redrawAll();
    },

    closeInsert() {
      state.pending = null;
      state.redrawAll();
    },

    // Fügt ein, wählt den neuen Eintrag aus und setzt den Fokus in sein
    // erstes Eingabefeld — so kann direkt weitergetippt werden.
    insert(list, index, entry) {
      insertEntry(list, index, entry);
      state.pending = null;
      state.selected = entry;
      state.redrawAll();
      state.selectedNode?.querySelector('input')?.focus();
    },

    // Nach dem Verschieben bleibt der Eintrag ausgewählt; der Fokus wandert
    // auf denselben Pfeil-Knopf in der neuen Zeichnung, damit mehrfaches
    // Verschieben per Tastatur ohne erneutes Hin-Tabben möglich ist.
    move(list, index, delta, action) {
      if (!moveEntry(list, index, delta)) return;
      state.pending = null;
      state.redrawAll();
      state.selectedNode?.querySelector(`[data-entry-action="${action}"]`)?.focus();
    },

    remove(list, index) {
      const [removed] = list.splice(index, 1);
      if (removed === state.selected) { state.selected = null; state.selectedNode = null; }
      state.pending = null;
      state.redrawAll();
    },
  };
  return state;
}

// Bündelt die Aktionen, die JEDER Eintrag kennt — hoch, runter, entfernen,
// darüber/darunter einfügen — für Position `index` in `list`. Sätze auf
// oberster Ebene, Wiederholungsblöcke, Abschnitte und Sätze innerhalb
// eines Blocks/Abschnitts teilen sich dadurch exakt dieselbe Semantik.
function entryControls(list, index, state) {
  return {
    canMoveUp: index > 0,
    canMoveDown: index < list.length - 1,
    onMoveUp: () => state.move(list, index, -1, 'up'),
    onMoveDown: () => state.move(list, index, 1, 'down'),
    onRemove: () => state.remove(list, index),
    onInsertAbove: () => state.openInsert(list, index),
    onInsertBelow: () => state.openInsert(list, index + 1),
    bind: (node, entry) => state.bindSelectable(node, entry),
  };
}

// Hoch/runter/entfernen als drei gleich große Symbol-Knöpfe in einer
// Gruppe fester Breite — identisch für Sätze, Blöcke und Abschnitte, damit
// die Aktionen aller Ebenen in derselben Spalte stehen. Nicht ausgewählte
// Einträge blenden die Gruppe per CSS aus (visibility, damit die Spalte
// ihre Breite behält). Am Listenrand werden die Pfeile deaktiviert statt
// entfernt, damit die übrigen Knöpfe ihre Position behalten.
function entryActions(controls, removeLabel) {
  return el('div', { class: 'entry-actions' }, [
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', title: t('setEditor.moveUp'), 'aria-label': t('setEditor.moveUp'),
      'data-entry-action': 'up', disabled: !controls.canMoveUp, onclick: controls.onMoveUp,
    }, '↑'),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', title: t('setEditor.moveDown'), 'aria-label': t('setEditor.moveDown'),
      'data-entry-action': 'down', disabled: !controls.canMoveDown, onclick: controls.onMoveDown,
    }, '↓'),
    el('button', {
      type: 'button', class: 'btn btn-danger btn-sm', title: removeLabel, 'aria-label': removeLabel,
      'data-entry-action': 'remove', onclick: controls.onRemove,
    }, '×'),
  ]);
}

// "Darüber/darunter einfügen" — nur am ausgewählten Eintrag sichtbar
// (CSS: .is-selected > .entry-insert-bar).
function insertBar(controls) {
  return el('div', { class: 'entry-insert-bar' }, [
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-entry-action': 'insert-above', onclick: controls.onInsertAbove }, t('setEditor.insertAbove')),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-entry-action': 'insert-below', onclick: controls.onInsertBelow }, t('setEditor.insertBelow')),
  ]);
}

// Code-Review, Befund L6: buildSetRow() mischte den Aufbau der fünf
// Basisfelder mit dem eigenständigen Katalog-Hinweis+Ausrüstungs-Editor
// als ein einziger, 87-Zeilen-Block. appendCatalogHint()/
// appendEquipmentEditor() unten tragen jetzt jeweils ihr eigenes,
// in sich geschlossenes Widget, sodass buildSetRow() nur noch
// orchestriert (Basisfelder bauen, beide Widgets anhängen).
//
// Reiner Hinweistext, appended into `container` when `s` links to a
// catalog exercise — "this set was created from exercise X". Read-only;
// the exercise's own catalog record (name, category, its default
// equipment, …) is only ever edited in the Übungskatalog module itself.
function appendCatalogHint(container, s, exercises) {
  if (!s.exerciseId) return;
  const ex = exerciseById(exercises).get(s.exerciseId);
  if (!ex) return;
  container.appendChild(el('span', { class: 'hint' }, t('setEditor.fromCatalogHint', { name: ex.name })));
}

// Material FÜR DIESEN SATZ (nicht den Katalogeintrag) — Anzeige als
// Badges plus Klapp-Editor mit denselben Toggle-Pills wie im
// Übungskatalog (catalog.js). Anders als der frühere, katalogschreibende
// Editor mutiert dies nur `s.equipment` im Speicher: wie Distanz/
// Beschreibung/etc. wird der neue Wert erst beim Absenden des
// Plan-/Vorlagenformulars mitgespeichert, kein eigener put() nötig.
// `onChange` (optional) lässt den Aufrufer eine übergeordnete
// Materialübersicht (z. B. die Tagessumme) sofort nachziehen.
function appendEquipmentEditor(container, s, exercises, onChange) {
  // Nur eine lokale Kopie für Anzeige/Editor-State — `s.equipment` wird
  // erst im onclick-Handler unten tatsächlich gesetzt, wenn die Person das
  // Feld aktiv ändert. Vorher (auch beim bloßen Rendern) bleibt `s`
  // unangetastet, damit ein an eine Katalog-Übung geknüpfter Satz ohne
  // eigenen Material-Wert weiterhin dessen Material erbt (equipmentForEntry())
  // statt beim nächsten Speichern stillschweigend "kein Material" zu zeigen.
  let equipment = equipmentForEntry(s, exercises);
  const display = el('div');
  // Bearbeiten-Knopf und aufgeklappter Editor sind nur am ausgewählten
  // Satz sichtbar (CSS: .set-row:not(.is-selected) .equipment-edit) — die
  // Material-Badges selbst bleiben immer sichtbar.
  const editorHost = el('div', { class: 'equipment-edit' });
  container.appendChild(display);
  container.appendChild(editorHost);
  let editorOpen = false;

  // Als Funktionsausdrücke statt Funktionsdeklarationen, siehe Begründung
  // weiter oben in dieser Datei (gegenseitiger Aufruf zwischen drawDisplay
  // und drawEditor ist unproblematisch, da beide erst aus später
  // ausgelösten onclick-Handlern aufgerufen werden).
  const drawDisplay = () => {
    clear(display);
    const badges = equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'));
    const editBtn = el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm equipment-edit',
      onclick: () => { editorOpen = !editorOpen; drawEditor(); },
    }, editorOpen ? t('common.close') : t('setEditor.editEquipment'));
    display.appendChild(el('div', { class: 'pill-group', style: 'margin-top:4px' }, [...badges, editBtn]));
  };

  const drawEditor = () => {
    clear(editorHost);
    if (!editorOpen) { drawDisplay(); return; }
    const selected = new Set(equipment);
    const pills = el('div', { class: 'pill-group', style: 'margin-top:4px' });
    EQUIPMENT_ITEMS.forEach(eq => {
      const pill = el('button', {
        type: 'button', class: `pill ${selected.has(eq.value) ? 'active' : ''}`,
        onclick: () => {
          if (selected.has(eq.value)) selected.delete(eq.value); else selected.add(eq.value);
          pill.classList.toggle('active');
          equipment = [...selected];
          s.equipment = equipment;
          drawDisplay();
          onChange?.();
        },
      }, trLabel(EQUIPMENT_ITEMS, eq.value, 'equipment'));
      pills.appendChild(pill);
    });
    editorHost.appendChild(pills);
    drawDisplay();
  };
  drawDisplay();
}

// Renders one plain-set row. `controls` (see entryControls()) supplies the
// row's ×/↑/↓/insert actions and its selection binding; the caller owns the array and re-draws itself
// afterwards. `onEquipmentChange` (optional) is called after this set's
// own material is edited, so the caller can refresh any aggregate
// summary (e.g. the day's equipment list) that depends on it.
function buildSetRow(s, exercises, controls, onEquipmentChange) {
  const row = el('div', { class: 'set-row' }, [
    el('input', { type: 'number', min: '0', value: s.distance ?? '', oninput: (e) => s.distance = e.target.value ? parseInt(e.target.value) : null }),
    // "mm:ss" statt Rohsekunden; leer/ungültig = keine Dauer (null), analog
    // zum Distanzfeld daneben.
    minSecInput(s.durationSec, (sec) => s.durationSec = sec),
    el('input', { type: 'text', value: s.description || '', placeholder: t('setEditor.descriptionPlaceholder'), oninput: (e) => s.description = e.target.value }),
    el('input', { type: 'number', min: '1', value: s.reps ?? 1, oninput: (e) => s.reps = parseInt(e.target.value) || 1 }),
    // Pause ebenfalls als "mm:ss"; restSec ist Pflichtfeld, leer = 0.
    minSecInput(s.restSec, (sec) => s.restSec = sec ?? 0),
    entryActions(controls, t('setEditor.removeRow')),
  ]);

  // Everything below the main 5 columns (intensity, catalog hint, equipment)
  // lives in one dedicated full-width wrapper that explicitly spans the
  // entire grid row (`.set-row-extra`, grid-column: 1 / -1) and stacks its
  // children with flexbox. This avoids relying on the CSS Grid's implicit
  // auto-placement for several separately positioned elements, which is
  // harder to reason about and easy to get subtly wrong.
  const extra = el('div', { class: 'set-row-extra' });

  const intensitySel = selectInput(trOptions(SET_INTENSITIES, 'setIntensities'), s.intensity || 'ga1', {
    onchange: (e) => s.intensity = e.target.value,
  });
  extra.appendChild(intensitySel);

  appendCatalogHint(extra, s, exercises);
  appendEquipmentEditor(extra, s, exercises, onEquipmentChange);

  row.appendChild(extra);
  row.appendChild(insertBar(controls));
  controls.bind(row, s);
  return row;
}

// Die "Hinzufügen"-Steuerelemente (leerer Satz / Wiederholungsblock /
// Abschnitt / Übung aus dem Katalog) an EINER Stelle, weil sie an
// mehreren Orten gebraucht werden: in einer leeren Liste (oberste Ebene,
// Block, Abschnitt) und im Einfügedialog über/unter dem ausgewählten
// Eintrag. Der Unterschied ist allein, WOHIN der neue Eintrag wandert —
// das entscheidet `onAdd`.
// `allowBlock: false` innerhalb eines Blocks, weil Blöcke sich nicht
// verschachteln (siehe Datenmodell oben). `allowSection` ist NUR auf
// oberster Ebene true (Standard hier: false) — Abschnitte selbst lassen
// sich weder in einem Block noch in einem anderen Abschnitt anlegen.
//
// Zwei Zeilen statt einer, nach Bedeutung gruppiert: oben die
// STRUKTUR-Elemente (Abschnitt, Wiederholungsblock — beide fassen
// weitere Einträge), unten die INHALTS-Elemente (leerer Satz, Übernahme
// aus dem Übungskatalog — beide erzeugen direkt einen Satz). Die obere
// Zeile entfällt ganz, wenn an dieser Stelle weder Abschnitt noch Block
// erlaubt ist (z. B. innerhalb eines Blocks).
function buildAddControls(exercises, { onAdd, allowBlock = true, allowSection = false, sectionTemplates = [], style = '', labels = {} }) {
  const container = el('div', { class: 'add-controls', style });

  const structureRow = el('div', { class: 'flex gap-8', style: 'flex-wrap:wrap' });
  if (allowSection) {
    structureRow.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary btn-sm', onclick: () => onAdd(newSection()),
    }, labels.section || t('setEditor.addSection')));
  }
  if (allowSection && sectionTemplates.length > 0) {
    const tplSel = selectInput([{ value: '', label: t('setEditor.pickSectionTemplate') }, ...sectionTemplates.map(st => ({ value: st.id, label: st.name }))], '', { style: 'min-width:180px' });
    const useTplBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm' }, t('setEditor.addFromSectionTemplate'));
    useTplBtn.addEventListener('click', () => {
      const tpl = sectionTemplates.find(x => x.id === tplSel.value);
      if (!tpl) return;
      tplSel.value = '';
      onAdd(sectionFromTemplate(tpl));
    });
    structureRow.appendChild(tplSel);
    structureRow.appendChild(useTplBtn);
  }
  if (allowBlock) {
    structureRow.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary btn-sm', onclick: () => onAdd(newBlock()),
    }, labels.block || t('setEditor.addBlock')));
  }
  if (structureRow.childNodes.length > 0) container.appendChild(structureRow);

  const contentRow = el('div', { class: 'flex gap-8', style: 'flex-wrap:wrap' });
  contentRow.appendChild(el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => onAdd(newBlankSet()),
  }, labels.blank || t('setEditor.addBlank')));

  if (exercises.length > 0) {
    const exerciseSel = selectInput(buildExerciseOptions(exercises), '', { style: 'min-width:220px' });
    const useBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm' }, labels.catalog || t('setEditor.addFromCatalog'));
    useBtn.addEventListener('click', () => {
      const ex = exercises.find(x => x.id === exerciseSel.value);
      if (!ex) return;
      // Auswahl zurücksetzen, bevor onAdd() ggf. neu zeichnet: die
      // Steuerelemente am Listen-/Blockende überleben das Neuzeichnen
      // (sie liegen außerhalb des neu gezeichneten Bereichs), sonst bliebe
      // die zuletzt gewählte Übung im Feld stehen.
      exerciseSel.value = '';
      onAdd(setFromExercise(ex));
    });
    contentRow.appendChild(exerciseSel);
    contentRow.appendChild(useBtn);
  }
  container.appendChild(contentRow);

  return container;
}

// Der Einfügedialog an der per "darüber/darunter einfügen" gewählten
// Stelle: dieselben Steuerelemente wie in einer leeren Liste, nur wird an
// Position `index` eingefügt statt angehängt — die Einfügestelle IST der
// gewählte Eintrag, ein separater "Wohin?"-Schritt entfällt.
function buildInsertPanel(list, index, exercises, state, { allowBlock = true, allowSection = false, sectionTemplates = [] }) {
  return el('div', { class: 'insert-panel' }, [
    el('div', { class: 'insert-panel-head' }, [
      el('span', { class: 'hint' }, t('setEditor.insertHereHint')),
      el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', title: t('setEditor.cancelInsert'), 'aria-label': t('setEditor.cancelInsert'),
        onclick: () => state.closeInsert(),
      }, '×'),
    ]),
    buildAddControls(exercises, {
      allowBlock,
      allowSection,
      sectionTemplates,
      onAdd: (entry) => state.insert(list, index, entry),
    }),
  ]);
}

// Zeichnet die Einträge einer Liste (oberste Ebene, Abschnitt oder Block)
// samt eventuell offenem Einfügedialog in `host`. Ist die Liste leer, steht
// dort statt der Einträge der Hinweis `emptyHint` plus die
// Hinzufügen-Steuerelemente — der einzige Fall, in dem sie ohne
// "darüber/darunter einfügen" sichtbar sind, weil es noch keinen Eintrag
// gibt, an dem man sie aufrufen könnte. `buildEntry(entry, controls)`
// liefert den DOM-Knoten eines Eintrags.
function drawEntryList(host, list, exercises, state, { emptyHint, addOptions, buildEntry }) {
  const panelAt = (i) => (state.pending && state.pending.list === list && state.pending.index === i
    ? buildInsertPanel(list, i, exercises, state, addOptions)
    : null);
  list.forEach((entry, i) => {
    const panel = panelAt(i);
    if (panel) host.appendChild(panel);
    host.appendChild(buildEntry(entry, entryControls(list, i, state)));
  });
  const endPanel = panelAt(list.length);
  if (endPanel && list.length > 0) host.appendChild(endPanel);
  if (list.length === 0) {
    host.appendChild(el('p', { class: 'hint', style: 'padding:4px 0' }, emptyHint));
    host.appendChild(buildAddControls(exercises, {
      ...addOptions,
      onAdd: (entry) => state.insert(list, 0, entry),
    }));
  }
}

// Renders one repeat-block: header (label + × repeatCount + actions), its
// own inner rows (reusing buildSetRow), and a live subtotal. `controls`
// (see entryControls()) moves, removes or inserts next to the block itself
// within the parent list. `onRedrawParent` refreshes the outer totals
// whenever a non-structural value inside the block changes.
function buildBlockRow(block, exercises, controls, onRedrawParent, state) {
  const container = el('div', { class: 'editor-block' });

  const labelInput = el('input', {
    type: 'text', value: block.label || '', placeholder: t('setEditor.blockNamePlaceholder'),
    oninput: (e) => block.label = e.target.value,
  });
  const repeatInput = el('input', {
    type: 'number', min: '1', value: block.repeatCount || 1, style: 'width:60px',
    oninput: (e) => { block.repeatCount = Math.max(1, parseInt(e.target.value) || 1); updateSubtotal(); onRedrawParent(); },
  });

  container.appendChild(el('div', { class: 'entry-head' }, [
    el('div', { class: 'entry-head-main' }, [
      badge(t('setEditor.repeatBlockBadge'), 'progress'), labelInput,
      el('span', { class: 'text-sm', style: 'white-space:nowrap' }, t('setEditor.repeats')), repeatInput,
    ]),
    entryActions(controls, t('setEditor.removeBlock')),
  ]));
  container.appendChild(insertBar(controls));

  const innerHost = el('div');
  container.appendChild(innerHost);
  const subtotalEl = el('div', { class: 'hint', style: 'margin-top:6px' });
  container.appendChild(subtotalEl);

  function updateSubtotal() {
    const inner = totalDistance(block.sets || []);
    subtotalEl.textContent = t('setEditor.blockSummary', { inner, n: block.repeatCount || 1, total: inner * (block.repeatCount || 1) });
  }

  block.sets = block.sets || [];
  drawEntryList(innerHost, block.sets, exercises, state, {
    emptyHint: t('setEditor.noSetsInBlock'),
    addOptions: { allowBlock: false, labels: { blank: t('setEditor.addSetInBlock'), catalog: t('setEditor.addFromCatalogBlock') } },
    buildEntry: (s, c) => buildSetRow(s, exercises, c, onRedrawParent),
  });
  updateSubtotal();

  controls.bind(container, block);
  return container;
}

// Renders one section: header (heading + actions), its own inner rows
// (sets AND blocks, reusing buildSetRow()/buildBlockRow() — a section is
// the one place besides the top level that allows blocks), and a live
// subtotal. Structurally the mirror image of buildBlockRow() above, one
// level up.
//
// `bubbleUp` (below) is what nested rows/blocks receive as THEIR
// "something changed, refresh ancestors" callback instead of the raw
// `onRedrawParent`: it refreshes this section's own subtotal AND forwards
// to `onRedrawParent`, so e.g. changing a block's repeatCount two levels
// down still updates both the section's and the top-level total.
function buildSectionRow(section, exercises, controls, onRedrawParent, state) {
  const container = el('div', { class: 'section-block' });

  const headingInput = el('input', {
    type: 'text', value: section.heading || '', placeholder: t('setEditor.sectionHeadingPlaceholder'),
    class: 'section-heading-input', oninput: (e) => section.heading = e.target.value,
  });

  container.appendChild(el('div', { class: 'entry-head' }, [
    el('div', { class: 'entry-head-main' }, [headingInput]),
    entryActions(controls, t('setEditor.removeSection')),
  ]));
  container.appendChild(insertBar(controls));

  const innerHost = el('div');
  container.appendChild(innerHost);
  const subtotalEl = el('div', { class: 'hint', style: 'margin-top:6px' });
  container.appendChild(subtotalEl);

  function updateSubtotal() {
    subtotalEl.textContent = t('setEditor.sectionSummary', { m: totalDistance(section.entries || []) });
  }
  function bubbleUp() { updateSubtotal(); onRedrawParent(); }

  section.entries = section.entries || [];
  drawEntryList(innerHost, section.entries, exercises, state, {
    emptyHint: t('setEditor.emptySectionHint'),
    addOptions: { allowSection: false },
    buildEntry: (entry, c) => (entry.kind === 'block'
      ? buildBlockRow(entry, exercises, c, bubbleUp, state)
      : buildSetRow(entry, exercises, c, bubbleUp)),
  });
  updateSubtotal();

  controls.bind(container, section);
  return container;
}

// Renders an editable list of mixed sets/blocks into `hostNode`.
// `items` is mutated in place; the caller reads the same array on submit.
// `exercises` (optional) enables "use from exercise catalog" pickers.
// `allowSection` (default true): false for a section template's own editor
// — its `entries` may only hold sets/blocks, not another section (siehe
// SectionTemplateSchema). `sectionTemplates` (optional) enables "insert
// section from template" at the top level, alongside the plain "add
// section" button.
export function renderSetEditor(hostNode, items, exercises = [], { allowSection = true, sectionTemplates = [] } = {}) {
  clear(hostNode);
  const state = createEditorState();

  const editor = el('div', { class: 'set-editor' });
  hostNode.appendChild(editor);

  const totalEl = el('div', { class: 'hint', style: 'margin-bottom:4px;font-weight:700' });
  editor.appendChild(totalEl);
  const equipmentEl = el('div', { class: 'hint', style: 'margin-bottom:8px' });
  editor.appendChild(equipmentEl);

  const head = el('div', { class: 'set-row set-row-head' }, [
    el('span', {}, t('setEditor.colDistance')), el('span', {}, t('setEditor.colDuration')), el('span', {}, t('setEditor.colDescription')), el('span', {}, t('setEditor.colReps')), el('span', {}, t('setEditor.colRest')), el('span', {}, ''),
  ]);
  editor.appendChild(head);
  const rowsHost = el('div');
  editor.appendChild(rowsHost);

  function updateTotal() {
    const duration = totalDuration(items);
    totalEl.textContent = duration > 0
      ? t('setEditor.totalDistanceAndDuration', { m: totalDistance(items), duration: formatTotalDuration(duration) })
      : t('setEditor.totalDistance', { m: totalDistance(items) });
    const equipment = collectEquipment(items, exercises);
    equipmentEl.textContent = equipment.length > 0
      ? `${t('setEditor.equipmentSummary')} ${equipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`
      : t('setEditor.equipmentNone');
  }

  function draw() {
    clear(rowsHost);
    state.selectedNode = null;
    drawEntryList(rowsHost, items, exercises, state, {
      emptyHint: t('setEditor.emptyHint'),
      addOptions: { allowSection, sectionTemplates },
      buildEntry: (entry, controls) => {
        if (entry.kind === 'block') return buildBlockRow(entry, exercises, controls, updateTotal, state);
        if (entry.kind === 'section') return buildSectionRow(entry, exercises, controls, updateTotal, state);
        return buildSetRow(entry, exercises, controls, updateTotal);
      },
    });
    updateTotal();
  }
  state.redrawAll = draw;
  draw();
}
