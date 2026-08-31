// ============================================================
// modules/catalog.js — Übungskatalog
// ============================================================
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender, icon } from '../dom.js';
import { badge, emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, formActions } from '../forms.js';
import { EXERCISE_CATEGORIES, STROKES, EQUIPMENT_ITEMS } from '../refdata.js';
import { t, trLabel, trCode, trOptions } from '../i18n.js';
import { renderCommentThread } from './comments.js';
import { libraryTransferButtons } from './libraryTransfer.js';
import { compareByCategoryThenName } from './setEditor.js';

const VIEW_STORAGE_KEY = 'lane1-catalog-view';
function loadCatalogView() {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
}
function saveCatalogView(mode) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* ignore (private mode etc.) */ }
}

const ICON_VIEW_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_VIEW_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round" stroke-width="2.6"/></svg>`;

export const catalogModule = {
  id: 'catalog',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><path d="M9 7h7M9 11h7"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const exercises = await getAll('exercises');
    if (!isCurrent()) return;
    renderList(container, exercises);
  }
};

function renderList(container, exercises) {
  const wrap = el('div');
  let viewMode = loadCatalogView();

  const gridBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`,
    title: t('catalog.viewGrid'), 'aria-label': t('catalog.viewGrid'), 'aria-pressed': viewMode === 'grid',
    onclick: () => setView('grid'),
  }, icon(ICON_VIEW_GRID));
  const listBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`,
    title: t('catalog.viewList'), 'aria-label': t('catalog.viewList'), 'aria-pressed': viewMode === 'list',
    onclick: () => setView('list'),
  }, icon(ICON_VIEW_LIST));
  const viewToggle = el('div', { class: 'view-toggle' }, [gridBtn, listBtn]);

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('catalog.eyebrow', { count: exercises.length })), el('h1', { class: 'mt-0' }, t('catalog.title'))]),
    el('div', { class: 'page-actions' }, [
      viewToggle,
      libraryTransferButtons({ onImported: refresh }),
      el('button', { class: 'btn btn-primary', onclick: () => openExerciseModal(null, refresh) }, t('catalog.createExercise')),
    ]),
  ]));
  wrap.appendChild(laneWave());

  let catFilter = 'all', search = '';
  const controls = el('div', { class: 'grid grid-2 mb-16' }, [
    field(t('catalog.searchLabel'), textInput('', { placeholder: t('catalog.searchPlaceholder'), oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } })),
    field(t('catalog.categoryLabel'), selectInput([{ value: 'all', label: t('catalog.allCategories') }, ...trOptions(EXERCISE_CATEGORIES, 'exerciseCategories')], 'all', { onchange: (e) => { catFilter = e.target.value; draw(); } })),
  ]);
  wrap.appendChild(controls);

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function setView(mode) {
    if (mode === viewMode) return;
    viewMode = mode;
    saveCatalogView(mode);
    gridBtn.classList.toggle('active', mode === 'grid');
    listBtn.classList.toggle('active', mode === 'list');
    gridBtn.setAttribute('aria-pressed', String(mode === 'grid'));
    listBtn.setAttribute('aria-pressed', String(mode === 'list'));
    draw();
  }

  function draw() {
    clear(host);
    let filtered = exercises;
    if (catFilter !== 'all') filtered = filtered.filter(e => e.category === catFilter);
    if (search) filtered = filtered.filter(e => (e.name + ' ' + (e.description || '')).toLowerCase().includes(search));
    filtered = filtered.slice().sort(compareByCategoryThenName);
    if (filtered.length === 0) { host.appendChild(emptyState(t('catalog.noExercisesTitle'), t('catalog.noExercisesMsg'), null)); return; }
    if (viewMode === 'list') drawTable(filtered); else drawGrid(filtered);
  }

  function drawGrid(filtered) {
    const grid = el('div', { class: 'grid grid-3' });
    filtered.forEach(ex => {
      const catLabel = trLabel(EXERCISE_CATEGORIES, ex.category, 'exerciseCategories');
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'flex justify-between items-center mb-8' }, [el('h3', { class: 'mt-0', style: 'font-size:1.05rem' }, ex.name), badge(catLabel, 'neutral')]),
        el('p', { class: 'text-sm' }, ex.description || t('catalog.noDescription')),
        el('div', { class: 'pill-group mb-8' }, [
          ex.stroke ? badge(trCode(ex.stroke, 'strokes'), 'progress') : null,
          ex.defaultDistance ? badge(`${ex.defaultDistance} m`, 'neutral') : null,
          ...(ex.equipment || []).map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb')),
          ...(ex.tags || []).map(tag => badge(tag, 'neutral')),
        ].filter(Boolean)),
        el('div', { class: 'flex gap-8', style: 'margin-top:10px' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openExerciseModal(ex, refresh) }, t('common.edit')),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('catalog.deleteConfirm', { name: ex.name }), async () => { await remove('exercises', ex.id); toast(t('catalog.deleted')); refresh(); }) }, t('common.delete')),
        ]),
      ]);
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function drawTable(filtered) {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('catalog.colName')), el('th', {}, t('catalog.colCategory')), el('th', {}, t('catalog.colStroke')),
      el('th', {}, t('catalog.colDistance')), el('th', {}, t('catalog.colEquipment')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    filtered.forEach(ex => {
      const catLabel = trLabel(EXERCISE_CATEGORIES, ex.category, 'exerciseCategories');
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', {}, ex.name), ex.description ? el('div', { class: 'text-sm', style: 'color:var(--c-slate)' }, ex.description) : null].filter(Boolean)),
        el('td', {}, badge(catLabel, 'neutral')),
        el('td', {}, ex.stroke ? badge(trCode(ex.stroke, 'strokes'), 'progress') : '—'),
        el('td', {}, ex.defaultDistance ? `${ex.defaultDistance} m` : '—'),
        el('td', {}, el('div', { class: 'pill-group' }, (ex.equipment || []).map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb')))),
        el('td', {}, el('div', { class: 'flex gap-8' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openExerciseModal(ex, refresh) }, t('common.edit')),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('catalog.deleteConfirm', { name: ex.name }), async () => { await remove('exercises', ex.id); toast(t('catalog.deleted')); refresh(); }) }, t('common.delete')),
        ])),
      ]));
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }

  draw();

  async function refresh() { const e2 = await getAll('exercises'); clear(container); renderList(container, e2); }
}

function openExerciseModal(exercise, onSaved) {
  const isEdit = !!exercise;
  const data = exercise ? { ...exercise } : { name: '', category: 'technik', stroke: '', description: '', defaultDistance: '', tags: [], equipment: [], comments: [] };
  const form = el('form', { class: 'form-grid' });
  const fName = textInput(data.name, { required: true });
  const fCat = selectInput(trOptions(EXERCISE_CATEGORIES, 'exerciseCategories'), data.category);
  const fStroke = selectInput([{ value: '', label: t('catalog.noStroke') }, ...STROKES.map(s => ({ value: s, label: trCode(s, 'strokes') }))], data.stroke || '');
  const fDist = el('input', { type: 'number', min: '0', value: data.defaultDistance || '', placeholder: t('catalog.formDistancePlaceholder') });
  const fDesc = el('textarea', {}, data.description || '');
  const fTags = textInput((data.tags || []).join(', '), { placeholder: 'e.g. warmup, technique' });
  form.appendChild(field(t('catalog.formName'), fName, { span2: true }));
  form.appendChild(field(t('catalog.formCategory'), fCat));
  form.appendChild(field(t('catalog.formStroke'), fStroke));
  form.appendChild(field(t('catalog.formDistance'), fDist));
  const selectedEquipment = new Set(data.equipment || []);
  const equipmentPills = el('div', { class: 'pill-group' });
  EQUIPMENT_ITEMS.forEach(eq => {
    const isActive = selectedEquipment.has(eq.value);
    const pill = el('button', {
      type: 'button', class: `pill ${isActive ? 'active' : ''}`,
      onclick: () => {
        if (selectedEquipment.has(eq.value)) selectedEquipment.delete(eq.value); else selectedEquipment.add(eq.value);
        pill.classList.toggle('active');
      },
    }, trLabel(EQUIPMENT_ITEMS, eq.value, 'equipment'));
    equipmentPills.appendChild(pill);
  });
  form.appendChild(field(t('catalog.formEquipment'), equipmentPills, { span2: true, hint: t('catalog.formEquipmentHint') }));
  form.appendChild(field(t('catalog.formTags'), fTags, { hint: t('catalog.formTagsHint') }));
  form.appendChild(field(t('catalog.formDescription'), fDesc, { span2: true }));

  if (isEdit) {
    const commentsWrap = el('div', { class: 'field', style: 'grid-column:1/-1' });
    commentsWrap.appendChild(el('label', {}, t('comments.exerciseCommentsTitle')));
    const commentsHost = el('div');
    commentsWrap.appendChild(commentsHost);
    form.appendChild(commentsWrap);
    // Kommentare speichern sofort (unabhängig vom "Speichern"-Klick des
    // restlichen Formulars) — `data` hält bis zum eigentlichen Submit nur
    // die unveränderten Ausgangswerte der anderen Felder (siehe unten:
    // fName/fCat/... werden erst beim Submit zusammengeführt), ein
    // Zwischenspeichern hier überschreibt also keine unbestätigten Edits.
    renderCommentThread(commentsHost, data.comments, async (nextComments) => {
      data.comments = nextComments;
      await put('exercises', { ...data, comments: nextComments });
      onSaved?.();
    });
  }

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('catalog.validationName'), 'error'); return; }
    await put('exercises', {
      ...data, name: fName.value.trim(), category: fCat.value, stroke: fStroke.value || null,
      defaultDistance: fDist.value ? parseInt(fDist.value) : null, description: fDesc.value.trim(),
      tags: fTags.value.split(',').map(x => x.trim()).filter(Boolean),
      equipment: [...selectedEquipment],
    });
    toast(isEdit ? t('catalog.savedEdit') : t('catalog.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('catalog.modalEdit') : t('catalog.modalCreate'), bodyNode: form, wide: true });
}
