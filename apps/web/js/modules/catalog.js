// ============================================================
// modules/catalog.js — Übungskatalog
// ============================================================
import { getAll, put, remove } from '../db.js';
import { el, clear, field, textInput, selectInput, openModal, confirmAction, toast, badge, emptyState, laneWave, beginRender } from '../utils.js';
import { EXERCISE_CATEGORIES, STROKES, EQUIPMENT_ITEMS } from '../refdata.js';
import { getRole } from '../state.js';
import { t, trLabel, trCode, trOptions } from '../i18n.js';

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
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('catalog.eyebrow', { count: exercises.length })), el('h1', { class: 'mt-0' }, t('catalog.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openExerciseModal(null, refresh) }, t('catalog.createExercise'))]),
  ]));
  wrap.appendChild(laneWave());

  let catFilter = 'all', search = '';
  const controls = el('div', { class: 'grid grid-2 mb-16' }, [
    field(t('catalog.searchLabel'), textInput('', { placeholder: t('catalog.searchPlaceholder'), oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } })),
    field(t('catalog.categoryLabel'), selectInput([{ value: 'all', label: t('catalog.allCategories') }, ...trOptions(EXERCISE_CATEGORIES, 'exerciseCategories')], 'all', { onchange: (e) => { catFilter = e.target.value; draw(); } })),
  ]);
  wrap.appendChild(controls);

  const host = el('div', { class: 'grid grid-3' });
  wrap.appendChild(host);
  container.appendChild(wrap);

  function draw() {
    clear(host);
    let filtered = exercises;
    if (catFilter !== 'all') filtered = filtered.filter(e => e.category === catFilter);
    if (search) filtered = filtered.filter(e => (e.name + ' ' + (e.description || '')).toLowerCase().includes(search));
    if (filtered.length === 0) { host.appendChild(emptyState(t('catalog.noExercisesTitle'), t('catalog.noExercisesMsg'), null)); return; }
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
      host.appendChild(card);
    });
  }
  draw();

  async function refresh() { const e2 = await getAll('exercises'); clear(container); renderList(container, e2); }
}

function openExerciseModal(exercise, onSaved) {
  const isEdit = !!exercise;
  const data = exercise ? { ...exercise } : { name: '', category: 'technik', stroke: '', description: '', defaultDistance: '', tags: [], equipment: [] };
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
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
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
