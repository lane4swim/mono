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
// ============================================================
import { el, clear, uid, selectInput, badge, toast } from '../utils.js';
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
  return { kind: 'set', id: uid('set'), description: '', distance: 100, reps: 1, intensity: 'ga1', restSec: 20, comments: [] };
}

function newBlock() {
  return { kind: 'block', id: uid('block'), label: '', repeatCount: 3, sets: [newBlankSet()] };
}

function setFromExercise(exercise) {
  const defaults = CATEGORY_DEFAULTS[exercise.category] || { intensity: 'ga1', restSec: 20 };
  return {
    kind: 'set',
    id: uid('set'),
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
      return { ...entry, id: uid('block'), sets: (entry.sets || []).map(s => ({ ...s, id: uid('set') })) };
    }
    return { ...entry, id: uid('set') };
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

function buildExerciseOptions(exercises) {
  return [{ value: '', label: t('setEditor.pickExercise') }, ...exercises
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(ex => ({ value: ex.id, label: `${trLabel(EXERCISE_CATEGORIES, ex.category, 'exerciseCategories')} · ${ex.name}` }))];
}

// Renders one plain-set row. `onRemove` is called when the row's × is clicked;
// the caller owns the array and re-draws itself afterwards. `onEquipmentChange`
// (optional) is called after the linked exercise's equipment is edited inline,
// so the caller can refresh any aggregate summary that depends on it.
function buildSetRow(s, exercises, onRemove, onEquipmentChange) {
  const row = el('div', { class: 'set-row' }, [
    el('input', { type: 'number', min: '0', value: s.distance ?? '', oninput: (e) => s.distance = e.target.value ? parseInt(e.target.value) : null }),
    el('input', { type: 'text', value: s.description || '', placeholder: t('setEditor.descriptionPlaceholder'), oninput: (e) => s.description = e.target.value }),
    el('input', { type: 'number', min: '1', value: s.reps ?? 1, oninput: (e) => s.reps = parseInt(e.target.value) || 1 }),
    el('input', { type: 'number', min: '0', value: s.restSec ?? 0, oninput: (e) => s.restSec = parseInt(e.target.value) || 0 }),
    el('button', { type: 'button', class: 'btn btn-danger btn-sm', title: t('setEditor.removeRow'), onclick: onRemove }, '×'),
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

  if (s.exerciseId) {
    const ex = exercises.find(x => x.id === s.exerciseId);
    if (ex) {
      extra.appendChild(el('span', { class: 'hint' }, t('setEditor.fromCatalogHint', { name: ex.name })));

      // Read-only equipment badges + an inline, persistent editor toggle.
      // Equipment lives on the *exercise* (catalog entry), not the set —
      // editing it here updates the same 'exercises' record used by the
      // Übungskatalog module, it's just a faster path while building a
      // plan/template so you don't have to leave the editor.
      const eqDisplay = el('div');
      const eqEditorHost = el('div');
      extra.appendChild(eqDisplay);
      extra.appendChild(eqEditorHost);
      let editorOpen = false;

      function drawDisplay() {
        clear(eqDisplay);
        const badges = (ex.equipment || []).map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'));
        const editBtn = el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onclick: () => { editorOpen = !editorOpen; drawEditor(); },
        }, editorOpen ? t('common.close') : t('setEditor.editEquipment'));
        eqDisplay.appendChild(el('div', { class: 'pill-group', style: 'margin-top:4px' }, [...badges, editBtn]));
      }

      function drawEditor() {
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
      }
      drawDisplay();
    }
  }

  row.appendChild(extra);
  return row;
}

// Renders one repeat-block: header (label + × repeatCount + remove),
// its own inner rows/controls (reusing buildSetRow), and a live subtotal.
// `onRedrawParent` re-renders the outer list so the parent's total-distance
// hint stays correct whenever something inside the block changes.
function buildBlockRow(block, exercises, onRemoveBlock, onRedrawParent) {
  const container = el('div', { class: 'day-block', style: 'margin:10px 0;border-style:dashed;border-color:var(--c-chlorine-d)' });

  const labelInput = el('input', {
    type: 'text', value: block.label || '', placeholder: t('setEditor.blockNamePlaceholder'),
    style: 'min-width:180px', oninput: (e) => block.label = e.target.value,
  });
  const repeatInput = el('input', {
    type: 'number', min: '1', value: block.repeatCount || 1, style: 'width:60px',
    oninput: (e) => { block.repeatCount = Math.max(1, parseInt(e.target.value) || 1); updateSubtotal(); onRedrawParent(); },
  });
  const removeBlockBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: onRemoveBlock }, t('setEditor.removeBlock'));

  container.appendChild(el('div', { class: 'day-block-head' }, [
    el('div', { class: 'flex items-center gap-8' }, [badge(t('setEditor.repeatBlockBadge'), 'progress'), labelInput]),
    el('div', { class: 'flex items-center gap-8' }, [el('span', { class: 'text-sm' }, t('setEditor.repeats')), repeatInput, removeBlockBtn]),
  ]));

  const innerHost = el('div');
  container.appendChild(innerHost);
  const subtotalEl = el('div', { class: 'hint', style: 'margin-top:6px' });
  container.appendChild(subtotalEl);

  function updateSubtotal() {
    const inner = totalDistance(block.sets || []);
    subtotalEl.textContent = t('setEditor.blockSummary', { inner, n: block.repeatCount || 1, total: inner * (block.repeatCount || 1) });
  }

  function drawInner() {
    clear(innerHost);
    (block.sets || []).forEach((s, si) => {
      innerHost.appendChild(buildSetRow(s, exercises, () => { block.sets.splice(si, 1); drawInner(); updateSubtotal(); onRedrawParent(); }, onRedrawParent));
    });
    if (!block.sets || block.sets.length === 0) {
      innerHost.appendChild(el('p', { class: 'hint', style: 'padding:4px 0' }, t('setEditor.noSetsInBlock')));
    }
    updateSubtotal();
  }
  drawInner();

  const innerControls = el('div', { class: 'flex gap-8', style: 'margin-top:6px;flex-wrap:wrap' });
  const addSetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, t('setEditor.addSetInBlock'));
  addSetBtn.addEventListener('click', () => { block.sets = block.sets || []; block.sets.push(newBlankSet()); drawInner(); onRedrawParent(); });
  innerControls.appendChild(addSetBtn);

  if (exercises.length > 0) {
    const exerciseSel = selectInput(buildExerciseOptions(exercises), '', { style: 'min-width:220px' });
    const useBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm' }, t('setEditor.addFromCatalogBlock'));
    useBtn.addEventListener('click', () => {
      const ex = exercises.find(x => x.id === exerciseSel.value);
      if (!ex) return;
      block.sets = block.sets || [];
      block.sets.push(setFromExercise(ex));
      exerciseSel.value = '';
      drawInner();
      onRedrawParent();
    });
    innerControls.appendChild(exerciseSel);
    innerControls.appendChild(useBtn);
  }
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
      if (entry.kind === 'block') {
        rowsHost.appendChild(buildBlockRow(entry, exercises, () => { items.splice(i, 1); draw(); }, updateTotal));
      } else {
        rowsHost.appendChild(buildSetRow(entry, exercises, () => { items.splice(i, 1); draw(); }, updateTotal));
      }
    });
    if (items.length === 0) {
      rowsHost.appendChild(el('p', { class: 'hint', style: 'padding:6px 0' }, t('setEditor.emptyHint')));
    }
    updateTotal();
  }
  draw();

  const controls = el('div', { class: 'flex gap-8', style: 'margin-top:10px;flex-wrap:wrap' });

  const addBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, t('setEditor.addBlank'));
  addBtn.addEventListener('click', () => { items.push(newBlankSet()); draw(); });
  controls.appendChild(addBtn);

  const addBlockBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, t('setEditor.addBlock'));
  addBlockBtn.addEventListener('click', () => { items.push(newBlock()); draw(); });
  controls.appendChild(addBlockBtn);

  if (exercises.length > 0) {
    const exerciseSel = selectInput(buildExerciseOptions(exercises), '', { style: 'min-width:260px' });
    const useBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm' }, t('setEditor.addFromCatalog'));
    useBtn.addEventListener('click', () => {
      const ex = exercises.find(x => x.id === exerciseSel.value);
      if (!ex) return;
      items.push(setFromExercise(ex));
      exerciseSel.value = '';
      draw();
    });
    controls.appendChild(exerciseSel);
    controls.appendChild(useBtn);
  }

  hostNode.appendChild(controls);
}
