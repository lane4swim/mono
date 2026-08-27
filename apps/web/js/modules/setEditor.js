// ============================================================
// modules/setEditor.js — shared "Sets/Serien" editor widget used
// by both templates.js and plans.js so the editing UX is consistent.
//
// An editable list is an array of "entries". Each entry is either:
//   - a plain set:   { kind: 'set',   id, description, distance, reps, intensity, restSec, exerciseId? }
//   - a repeat block:{ kind: 'block', id, label, repeatCount, sets: [ <plain set>, ... ] }
//
// Repeat blocks model classic swim-set notation like "3x [100 free,
// 50 kick]" without forcing the whole block to be typed out longhand.
// Entries without a `kind` (older saved data) are treated as plain sets
// for backward compatibility — no data migration needed.
//
// Die Reihenfolge der Einträge IST die fachliche Aussage des Plans (was
// wird wann geschwommen), deshalb kann jeder Eintrag an jeder Stelle
// entstehen und sich bewegen: zwischen zwei bestehenden Einträgen
// einfügen (siehe buildInsertPoint()) und eine Position auf-/abwärts
// verschieben (siehe moveEntry()/entryControls()). Beides gilt
// gleichermaßen für die oberste Ebene (Sätze UND Wiederholungsblöcke)
// wie für die Sätze INNERHALB eines Wiederholungsblocks.
// ============================================================
import { el, clear, localId } from '../dom.js';
import { badge, toast } from '../ui.js';
import { selectInput } from '../forms.js';
import { SET_INTENSITIES, EXERCISE_CATEGORIES, EQUIPMENT_ITEMS } from '../refdata.js';
import { t, trLabel, trOptions } from '../i18n.js';
import { put } from '../db.js';

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
  return { kind: 'set', id: localId('set'), description: '', distance: 100, reps: 1, intensity: 'ga1', restSec: 20, comments: [] };
}

function newBlock() {
  return { kind: 'block', id: localId('block'), label: '', repeatCount: 3, sets: [newBlankSet()] };
}

function setFromExercise(exercise) {
  const defaults = CATEGORY_DEFAULTS[exercise.category] || { intensity: 'ga1', restSec: 20 };
  return {
    kind: 'set',
    id: localId('set'),
    description: exercise.name,
    distance: exercise.defaultDistance || 100,
    reps: 1,
    intensity: defaults.intensity,
    restSec: defaults.restSec,
    exerciseId: exercise.id,
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
    return sum + (entry.distance || 0) * (entry.reps || 1);
  }, 0);
}

// Deep-clones a list of entries with fresh ids — used when copying a
// template's sets into a new plan day, so editing the plan can never
// mutate the original template (or another day) via shared references.
export function cloneItems(items) {
  return (items || []).map(entry => {
    if (entry.kind === 'block') {
      return { ...entry, id: localId('block'), sets: (entry.sets || []).map(s => ({ ...s, id: localId('set') })) };
    }
    return { ...entry, id: localId('set') };
  });
}

// Collects the de-duplicated set of equipment codes needed across a
// (possibly nested, block-containing) list of entries, by looking up
// each set's linked catalog exercise (if any) and its `equipment` list.
// Sets not created from a catalog exercise simply contribute nothing —
// there's no equipment info to draw on for freely-typed sets.
export function collectEquipment(items, exercises) {
  const codes = new Set();
  const walk = (list) => {
    (list || []).forEach(entry => {
      if (entry.kind === 'block') { walk(entry.sets || []); return; }
      if (entry.exerciseId) {
        const ex = exercises.find(x => x.id === entry.exerciseId);
        (ex?.equipment || []).forEach(eq => codes.add(eq));
      }
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

function buildExerciseOptions(exercises) {
  return [{ value: '', label: t('setEditor.pickExercise') }, ...exercises
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(ex => ({ value: ex.id, label: `${trLabel(EXERCISE_CATEGORIES, ex.category, 'exerciseCategories')} · ${ex.name}` }))];
}

// Bündelt die drei Aktionen, die JEDER Eintrag kennt — hoch, runter,
// entfernen — für Position `index` in `list`. Sätze auf oberster Ebene,
// Wiederholungsblöcke und Sätze innerhalb eines Blocks teilen sich
// dadurch exakt dieselbe Umsortier-Semantik; `redraw` zeichnet die
// besitzende Liste neu (und aktualisiert deren Summen).
function entryControls(list, index, redraw) {
  return {
    canMoveUp: index > 0,
    canMoveDown: index < list.length - 1,
    onMoveUp: () => { if (moveEntry(list, index, -1)) redraw(); },
    onMoveDown: () => { if (moveEntry(list, index, 1)) redraw(); },
    onRemove: () => { list.splice(index, 1); redraw(); },
  };
}

// Die beiden Pfeil-Schaltflächen zu einem entryControls()-Objekt. Am
// Listenrand werden sie deaktiviert statt ausgeblendet, damit die Zeilen
// nicht unterschiedlich breit werden und die Position der übrigen Knöpfe
// stabil bleibt.
function orderButtons(controls) {
  return [
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', title: t('setEditor.moveUp'), 'aria-label': t('setEditor.moveUp'),
      disabled: !controls.canMoveUp, onclick: controls.onMoveUp,
    }, '↑'),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', title: t('setEditor.moveDown'), 'aria-label': t('setEditor.moveDown'),
      disabled: !controls.canMoveDown, onclick: controls.onMoveDown,
    }, '↓'),
  ];
}

// Code-Review, Befund L6: buildSetRow() mischte den Aufbau der fünf
// Basisfelder mit dem eigenständigen Katalog-Hinweis+Ausrüstungs-Editor
// (eigener editorOpen-Zustand, eigene Persistenz über put('exercises', …))
// als ein einziger, 87-Zeilen-Block. appendCatalogInfo() unten trägt jetzt
// genau dieses in sich geschlossene Widget separat, sodass buildSetRow()
// nur noch orchestriert (Basisfelder bauen, bei Bedarf das Widget
// anhängen).
//
// Read-only equipment badges + an inline, persistent editor toggle,
// appended into `container` when `s` links to a catalog exercise.
// Equipment lives on the *exercise* (catalog entry), not the set —
// editing it here updates the same 'exercises' record used by the
// Übungskatalog module, it's just a faster path while building a
// plan/template so you don't have to leave the editor. `onEquipmentChange`
// (optional) is called after a save, so the caller can refresh any
// aggregate summary that depends on it.
function appendCatalogInfo(container, s, exercises, onEquipmentChange) {
  if (!s.exerciseId) return;
  const ex = exercises.find(x => x.id === s.exerciseId);
  if (!ex) return;

  container.appendChild(el('span', { class: 'hint' }, t('setEditor.fromCatalogHint', { name: ex.name })));

  const eqDisplay = el('div');
  const eqEditorHost = el('div');
  container.appendChild(eqDisplay);
  container.appendChild(eqEditorHost);
  let editorOpen = false;

  // Als Funktionsausdrücke statt Funktionsdeklarationen: eine
  // Funktionsdeklaration innerhalb eines Blocks (hier `if (ex) { … }`)
  // ist historisch uneinheitlich zwischen JS-Engines spezifiziert —
  // als Ausdruck zugewiesen ist das Verhalten eindeutig. Gegenseitiger
  // Aufruf bleibt unproblematisch: `drawDisplay` ruft `drawEditor` nur
  // aus einem später ausgelösten onclick-Handler auf (nicht bei der
  // Definition), und `drawEditor` wird selbst erst aufgerufen, nachdem
  // beide bereits zugewiesen sind.
  const drawDisplay = () => {
    clear(eqDisplay);
    const badges = (ex.equipment || []).map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'));
    const editBtn = el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onclick: () => { editorOpen = !editorOpen; drawEditor(); },
    }, editorOpen ? t('common.close') : t('setEditor.editEquipment'));
    eqDisplay.appendChild(el('div', { class: 'pill-group', style: 'margin-top:4px' }, [...badges, editBtn]));
  };

  const drawEditor = () => {
    clear(eqEditorHost);
    if (!editorOpen) { drawDisplay(); return; }
    const selected = new Set(ex.equipment || []);
    const pills = el('div', { class: 'pill-group', style: 'margin-top:4px' });
    EQUIPMENT_ITEMS.forEach(eq => {
      const pill = el('button', {
        type: 'button', class: `pill ${selected.has(eq.value) ? 'active' : ''}`,
        onclick: async () => {
          if (selected.has(eq.value)) selected.delete(eq.value); else selected.add(eq.value);
          pill.classList.toggle('active');
          ex.equipment = [...selected];
          await put('exercises', { ...ex });
          toast(t('setEditor.equipmentSaved'));
          drawDisplay();
          onEquipmentChange?.();
        },
      }, trLabel(EQUIPMENT_ITEMS, eq.value, 'equipment'));
      pills.appendChild(pill);
    });
    eqEditorHost.appendChild(pills);
    drawDisplay();
  };
  drawDisplay();
}

// Renders one plain-set row. `controls` (see entryControls()) supplies the
// row's ×/↑/↓ actions; the caller owns the array and re-draws itself
// afterwards. `onEquipmentChange` (optional) is called after the linked
// exercise's equipment is edited inline, so the caller can refresh any
// aggregate summary that depends on it.
function buildSetRow(s, exercises, controls, onEquipmentChange) {
  const row = el('div', { class: 'set-row' }, [
    el('input', { type: 'number', min: '0', value: s.distance ?? '', oninput: (e) => s.distance = e.target.value ? parseInt(e.target.value) : null }),
    el('input', { type: 'text', value: s.description || '', placeholder: t('setEditor.descriptionPlaceholder'), oninput: (e) => s.description = e.target.value }),
    el('input', { type: 'number', min: '1', value: s.reps ?? 1, oninput: (e) => s.reps = parseInt(e.target.value) || 1 }),
    el('input', { type: 'number', min: '0', value: s.restSec ?? 0, oninput: (e) => s.restSec = parseInt(e.target.value) || 0 }),
    el('div', { class: 'set-row-actions' }, [
      ...orderButtons(controls),
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', title: t('setEditor.removeRow'), 'aria-label': t('setEditor.removeRow'), onclick: controls.onRemove }, '×'),
    ]),
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

  appendCatalogInfo(extra, s, exercises, onEquipmentChange);

  row.appendChild(extra);
  return row;
}

// Die "Hinzufügen"-Steuerelemente (leerer Satz / Wiederholungsblock /
// Übung aus dem Katalog) an EINER Stelle, weil sie an mehreren Orten
// gebraucht werden: am Listenende, am Blockende und in jedem
// Einfügepunkt zwischen zwei Einträgen. Der Unterschied ist allein,
// WOHIN der neue Eintrag wandert — das entscheidet `onAdd`.
// `allowBlock: false` innerhalb eines Blocks, weil Blöcke sich nicht
// verschachteln (siehe Datenmodell oben).
function buildAddControls(exercises, { onAdd, allowBlock = true, className = 'flex gap-8', style = '', labels = {} }) {
  const row = el('div', { class: className, style });

  row.appendChild(el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => onAdd(newBlankSet()),
  }, labels.blank || t('setEditor.addBlank')));

  if (allowBlock) {
    row.appendChild(el('button', {
      type: 'button', class: 'btn btn-primary btn-sm', onclick: () => onAdd(newBlock()),
    }, labels.block || t('setEditor.addBlock')));
  }

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
    row.appendChild(exerciseSel);
    row.appendChild(useBtn);
  }

  return row;
}

// Ein Einfügepunkt ZWISCHEN zwei Einträgen (bzw. vor dem ersten): eine
// dezente Trennlinie mit "+"-Knopf, der dieselben Steuerelemente wie am
// Listenende aufklappt — nur wird hier an Position `index` eingefügt
// statt angehängt. Dadurch braucht es keinen separaten "Wohin?"-Dialog:
// die Einfügestelle IST der angeklickte Punkt.
function buildInsertPoint(list, index, exercises, { allowBlock = true, redraw }) {
  const host = el('div', { class: 'insert-point-host' });
  const panelHost = el('div');
  let open = false;

  const toggle = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm insert-point-btn',
    title: t('setEditor.insertHere'), 'aria-label': t('setEditor.insertHere'),
    onclick: () => { open = !open; drawPanel(); },
  }, '+');

  host.appendChild(el('div', { class: 'insert-point' }, [el('span', { class: 'insert-point-line' }), toggle, el('span', { class: 'insert-point-line' })]));
  host.appendChild(panelHost);

  function drawPanel() {
    clear(panelHost);
    toggle.textContent = open ? '×' : '+';
    if (!open) return;
    panelHost.appendChild(el('div', { class: 'insert-panel' }, [
      el('span', { class: 'hint' }, t('setEditor.insertHereHint')),
      buildAddControls(exercises, {
        allowBlock,
        className: 'flex gap-8',
        style: 'flex-wrap:wrap',
        // Nach dem Einfügen zeichnet redraw() die ganze Liste neu — das
        // Panel verschwindet dabei von selbst, ohne eigenes Aufräumen.
        onAdd: (entry) => { insertEntry(list, index, entry); redraw(); },
      }),
    ]));
  }
  drawPanel();

  return host;
}

// Renders one repeat-block: header (label + × repeatCount + move/remove),
// its own inner rows/insert points/controls (reusing buildSetRow), and a
// live subtotal. `controls` (see entryControls()) moves or removes the
// block itself within the parent list. `onRedrawParent` re-renders the
// outer list so the parent's total-distance hint stays correct whenever
// something inside the block changes.
function buildBlockRow(block, exercises, controls, onRedrawParent) {
  const container = el('div', { class: 'day-block', style: 'margin:10px 0;border-style:dashed;border-color:var(--c-chlorine-d)' });

  const labelInput = el('input', {
    type: 'text', value: block.label || '', placeholder: t('setEditor.blockNamePlaceholder'),
    style: 'min-width:180px', oninput: (e) => block.label = e.target.value,
  });
  const repeatInput = el('input', {
    type: 'number', min: '1', value: block.repeatCount || 1, style: 'width:60px',
    oninput: (e) => { block.repeatCount = Math.max(1, parseInt(e.target.value) || 1); updateSubtotal(); onRedrawParent(); },
  });
  const removeBlockBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: controls.onRemove }, t('setEditor.removeBlock'));

  container.appendChild(el('div', { class: 'day-block-head' }, [
    el('div', { class: 'flex items-center gap-8' }, [badge(t('setEditor.repeatBlockBadge'), 'progress'), labelInput]),
    el('div', { class: 'flex items-center gap-8' }, [
      el('span', { class: 'text-sm', style: 'white-space:nowrap' }, t('setEditor.repeats')), repeatInput,
      ...orderButtons(controls),
      removeBlockBtn,
    ]),
  ]));

  const innerHost = el('div');
  container.appendChild(innerHost);
  const subtotalEl = el('div', { class: 'hint', style: 'margin-top:6px' });
  container.appendChild(subtotalEl);

  function updateSubtotal() {
    const inner = totalDistance(block.sets || []);
    subtotalEl.textContent = t('setEditor.blockSummary', { inner, n: block.repeatCount || 1, total: inner * (block.repeatCount || 1) });
  }

  // Neuzeichnen der Blockinhalte: aktualisiert immer auch die
  // Block-Zwischensumme UND die Gesamtsumme der äußeren Liste, weil jede
  // Änderung im Block (einfügen, verschieben, entfernen) beide betrifft.
  function drawInner() {
    clear(innerHost);
    block.sets = block.sets || [];
    block.sets.forEach((s, si) => {
      innerHost.appendChild(buildInsertPoint(block.sets, si, exercises, { allowBlock: false, redraw: redrawInner }));
      innerHost.appendChild(buildSetRow(s, exercises, entryControls(block.sets, si, redrawInner), onRedrawParent));
    });
    if (block.sets.length === 0) {
      innerHost.appendChild(el('p', { class: 'hint', style: 'padding:4px 0' }, t('setEditor.noSetsInBlock')));
    }
    updateSubtotal();
  }
  function redrawInner() { drawInner(); onRedrawParent(); }
  drawInner();

  const innerControls = buildAddControls(exercises, {
    allowBlock: false,
    style: 'margin-top:6px;flex-wrap:wrap',
    labels: { blank: t('setEditor.addSetInBlock'), catalog: t('setEditor.addFromCatalogBlock') },
    onAdd: (entry) => { block.sets = block.sets || []; block.sets.push(entry); redrawInner(); },
  });
  container.appendChild(innerControls);

  return container;
}

// Renders an editable list of mixed sets/blocks into `hostNode`.
// `items` is mutated in place; the caller reads the same array on submit.
// `exercises` (optional) enables "use from exercise catalog" pickers.
export function renderSetEditor(hostNode, items, exercises = []) {
  clear(hostNode);

  const totalEl = el('div', { class: 'hint', style: 'margin-bottom:4px;font-weight:700' });
  hostNode.appendChild(totalEl);
  const equipmentEl = el('div', { class: 'hint', style: 'margin-bottom:8px' });
  hostNode.appendChild(equipmentEl);

  const head = el('div', { class: 'set-row set-row-head' }, [
    el('span', {}, t('setEditor.colDistance')), el('span', {}, t('setEditor.colDescription')), el('span', {}, t('setEditor.colReps')), el('span', {}, t('setEditor.colRest')), el('span', {}, ''),
  ]);
  hostNode.appendChild(head);
  const rowsHost = el('div');
  hostNode.appendChild(rowsHost);

  function updateTotal() {
    totalEl.textContent = t('setEditor.totalDistance', { m: totalDistance(items) });
    const equipment = collectEquipment(items, exercises);
    equipmentEl.textContent = equipment.length > 0
      ? `${t('setEditor.equipmentSummary')} ${equipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`
      : t('setEditor.equipmentNone');
  }

  function draw() {
    clear(rowsHost);
    items.forEach((entry, i) => {
      // Vor JEDEM Eintrag ein Einfügepunkt (der letzte Platz — ganz am
      // Ende — bleibt den Steuerelementen unter der Liste vorbehalten,
      // die genau das schon immer getan haben).
      rowsHost.appendChild(buildInsertPoint(items, i, exercises, { redraw: draw }));
      const controls = entryControls(items, i, draw);
      if (entry.kind === 'block') {
        rowsHost.appendChild(buildBlockRow(entry, exercises, controls, updateTotal));
      } else {
        rowsHost.appendChild(buildSetRow(entry, exercises, controls, updateTotal));
      }
    });
    if (items.length === 0) {
      rowsHost.appendChild(el('p', { class: 'hint', style: 'padding:6px 0' }, t('setEditor.emptyHint')));
    }
    updateTotal();
  }
  draw();

  const controls = buildAddControls(exercises, {
    style: 'margin-top:10px;flex-wrap:wrap',
    onAdd: (entry) => { items.push(entry); draw(); },
  });

  hostNode.appendChild(controls);
}
