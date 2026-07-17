// ============================================================
// modules/templates.js — wiederverwendbare Trainingsplan-Vorlagen
// ============================================================
import { getAll, put, remove, uid } from '../db.js';
import { el, clear, field, textInput, openModal, confirmAction, toast, badge, emptyState, laneWave, beginRender } from '../utils.js';
import { renderSetEditor, totalDistance, cloneItems, collectEquipment } from './setEditor.js';
import { EQUIPMENT_ITEMS } from '../refdata.js';
import { t, trLabel } from '../i18n.js';

export const templatesModule = {
  id: 'templates',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="11" width="8" height="9" rx="1"/><rect x="13" y="11" width="8" height="9" rx="1"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [templates, exercises] = await Promise.all([getAll('templates'), getAll('exercises')]);
    if (!isCurrent()) return;
    renderList(container, templates, exercises);
  }
};

function renderList(container, templates, exercises) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('templates.eyebrow', { count: templates.length })), el('h1', { class: 'mt-0' }, t('templates.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openTemplateModal(null, exercises, refresh) }, t('templates.createTemplate'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('templates.intro')));

  const host = el('div', { class: 'grid grid-2' });
  wrap.appendChild(host);
  container.appendChild(wrap);

  if (templates.length === 0) { host.appendChild(emptyState(t('templates.noTemplatesTitle'), t('templates.noTemplatesMsg'), null)); }
  templates.forEach(tpl => {
    const tplEquipment = collectEquipment(tpl.sets || [], exercises);
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'flex justify-between items-center' }, [el('h3', { class: 'mt-0' }, tpl.name), badge(t('plans.totalBadge', { m: totalDistance(tpl.sets || []) }), 'neutral')]),
      el('p', { class: 'text-sm' }, tpl.description || ''),
      el('div', { class: 'pill-group mb-8' }, (tpl.tags || []).map(tag => badge(tag, 'neutral'))),
    ]);
    if (tplEquipment.length > 0) {
      card.appendChild(el('p', { class: 'text-sm' }, `${t('setEditor.equipmentSummary')} ${tplEquipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`));
    }
    const list = el('div', { class: 'mb-8' });
    (tpl.sets || []).forEach(entry => {
      if (entry.kind === 'block') {
        list.appendChild(el('div', { class: 'list-row' }, [
          el('span', { style: 'flex:1' }, [badge(`${entry.repeatCount || 1}×`, 'progress'), ' ', entry.label || t('templates.defaultBlockLabel'), el('span', { class: 'hint' }, t('templates.setsCountSuffix', { count: (entry.sets || []).length }))]),
          el('span', { class: 'data text-sm' }, `${totalDistance(entry.sets || []) * (entry.repeatCount || 1)}m`),
        ]));
      } else {
        const ex = entry.exerciseId ? exercises.find(x => x.id === entry.exerciseId) : null;
        list.appendChild(el('div', { class: 'list-row' }, [
          el('span', { style: 'flex:1' }, [
            entry.description || '—',
            ex && (ex.equipment || []).length > 0
              ? el('div', { class: 'pill-group', style: 'margin-top:3px' }, ex.equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb')))
              : null,
          ].filter(Boolean)),
          el('span', { class: 'data text-sm' }, `${entry.reps}× ${entry.distance ?? '—'}m`),
        ]));
      }
    });
    card.appendChild(list);
    card.appendChild(el('div', { class: 'flex gap-8' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openTemplateModal(tpl, exercises, refresh) }, t('common.edit')),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('templates.deleteConfirm', { name: tpl.name }), async () => { await remove('templates', tpl.id); toast(t('templates.deleted')); refresh(); }) }, t('common.delete')),
    ]));
    host.appendChild(card);
  });

  async function refresh() { const [t2, e2] = await Promise.all([getAll('templates'), getAll('exercises')]); clear(container); renderList(container, t2, e2); }
}

function openTemplateModal(template, exercises, onSaved) {
  const isEdit = !!template;
  const data = template ? { ...template, sets: cloneItems(template.sets) } : { name: '', description: '', tags: [], sets: [] };
  const form = el('form', { class: 'form-grid single' });
  const fName = textInput(data.name, { required: true });
  const fDesc = el('textarea', {}, data.description || '');
  const fTags = textInput((data.tags || []).join(', '), { placeholder: 'e.g. endurance, base' });
  form.appendChild(field(t('templates.formName'), fName));
  form.appendChild(field(t('templates.formDescription'), fDesc));
  form.appendChild(field(t('templates.formTags'), fTags, { hint: t('templates.formTagsHint') }));

  const setsWrap = el('div', { class: 'field' });
  setsWrap.appendChild(el('label', {}, t('templates.setsLabel')));
  const setsHost = el('div');
  setsWrap.appendChild(setsHost);
  form.appendChild(setsWrap);
  renderSetEditor(setsHost, data.sets, exercises);

  form.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('templates.validationName'), 'error'); return; }
    await put('templates', { ...data, name: fName.value.trim(), description: fDesc.value.trim(), tags: fTags.value.split(',').map(x => x.trim()).filter(Boolean), sets: data.sets });
    toast(isEdit ? t('templates.savedEdit') : t('templates.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('templates.modalEdit') : t('templates.modalCreate'), bodyNode: form, wide: true });
}
