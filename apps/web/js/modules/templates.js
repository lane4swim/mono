// wiederverwendbare Trainingsplan-Vorlagen
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { badge, emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, formActions } from '../forms.js';
import { renderSetEditor, totalDistance, cloneItems, collectEquipment, renderEntryList } from './setEditor.js';
import { EQUIPMENT_ITEMS, COURSES } from '../refdata.js';
import { t, trLabel, trOptions } from '../i18n.js';
import { libraryTransferButtons } from './libraryTransfer.js';

// poolLength ist nullable (siehe TemplateSchema) — eine leere Option bildet
// "nicht festgelegt" ab, siehe docs/Plans/beckenlaenge-regeneration-plan.md.
function poolLengthOptions() {
  return [{ value: '', label: t('plans.poolLengthNotSet') }, ...trOptions(COURSES, 'courses')];
}

export const templatesModule = {
  id: 'templates',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="11" width="8" height="9" rx="1"/><rect x="13" y="11" width="8" height="9" rx="1"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [templates, exercises, sectionTemplates] = await Promise.all([getAll('templates'), getAll('exercises'), getAll('sectionTemplates')]);
    if (!isCurrent()) return;
    renderList(container, templates, exercises, sectionTemplates);
  }
};

// Baut eine unabhängige Kopie einer Vorlage für "Duplizieren" — id/
// Zeitstempel übernimmt put() automatisch (siehe db.js). `sets` wird per
// cloneItems(..., { resetComments: true }) tief kopiert: frische
// Eintrags-ids (sonst teilen sich Original und Kopie dieselben Objekte)
// UND geleerte Kommentare — sync.commentAuthorship.ts würde einen
// fremdautorisierten Kommentar unter der neuen id sonst beim Push ablehnen
// (siehe auch importLibrary() in libraryTransfer.js).
export function duplicateTemplate(template) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...rest } = template;
  return { ...rest, name: t('common.copyOf', { name: template.name }), sets: cloneItems(template.sets || [], { resetComments: true }) };
}

function renderList(container, templates, exercises, sectionTemplates) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('templates.eyebrow', { count: templates.length })), el('h1', { class: 'mt-0' }, t('templates.title'))]),
    el('div', { class: 'page-actions' }, [
      libraryTransferButtons({ onImported: refresh }),
      el('button', { class: 'btn btn-primary', onclick: () => openTemplateModal(null, exercises, sectionTemplates, refresh) }, t('templates.createTemplate')),
    ]),
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
      el('div', { class: 'flex justify-between items-center' }, [
        el('h3', { class: 'mt-0' }, tpl.name),
        el('div', { class: 'flex items-center gap-8' }, [
          tpl.poolLength ? badge(trLabel(COURSES, tpl.poolLength, 'courses'), 'neutral') : null,
          badge(t('plans.totalBadge', { m: totalDistance(tpl.sets || []) }), 'neutral'),
        ]),
      ]),
      el('p', { class: 'text-sm' }, tpl.description || ''),
      el('div', { class: 'pill-group mb-8' }, (tpl.tags || []).map(tag => badge(tag, 'neutral'))),
    ]);
    if (tplEquipment.length > 0) {
      card.appendChild(el('p', { class: 'text-sm' }, `${t('setEditor.equipmentSummary')} ${tplEquipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`));
    }
    card.appendChild(renderEntryList(tpl.sets || [], exercises));
    card.appendChild(el('div', { class: 'flex gap-8' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openTemplateModal(tpl, exercises, sectionTemplates, refresh) }, t('common.edit')),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => duplicate(tpl) }, t('common.duplicate')),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('templates.deleteConfirm', { name: tpl.name }), async () => { await remove('templates', tpl.id); toast(t('templates.deleted')); refresh(); }) }, t('common.delete')),
    ]));
    host.appendChild(card);
  });

  async function duplicate(tpl) { await put('templates', duplicateTemplate(tpl)); toast(t('templates.duplicated')); refresh(); }

  async function refresh() { const [t2, e2, st2] = await Promise.all([getAll('templates'), getAll('exercises'), getAll('sectionTemplates')]); clear(container); renderList(container, t2, e2, st2); }
}

function openTemplateModal(template, exercises, sectionTemplates, onSaved) {
  const isEdit = !!template;
  const data = template ? { ...template, sets: cloneItems(template.sets) } : { name: '', description: '', tags: [], sets: [], poolLength: null };
  const form = el('form', { class: 'form-grid single' });
  const fName = textInput(data.name, { required: true });
  const fDesc = el('textarea', {}, data.description || '');
  const fTags = textInput((data.tags || []).join(', '), { placeholder: 'e.g. endurance, base' });
  const fPoolLength = selectInput(poolLengthOptions(), data.poolLength ?? '');
  form.appendChild(field(t('templates.formName'), fName));
  form.appendChild(field(t('templates.formDescription'), fDesc));
  form.appendChild(field(t('templates.formTags'), fTags, { hint: t('templates.formTagsHint') }));
  form.appendChild(field(t('plans.formPoolLength'), fPoolLength));

  const setsWrap = el('div', { class: 'field' });
  setsWrap.appendChild(el('label', {}, t('templates.setsLabel')));
  const setsHost = el('div');
  setsWrap.appendChild(setsHost);
  form.appendChild(setsWrap);
  renderSetEditor(setsHost, data.sets, exercises, { sectionTemplates });

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create'), spanFull: false }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('templates.validationName'), 'error'); return; }
    await put('templates', { ...data, name: fName.value.trim(), description: fDesc.value.trim(), tags: fTags.value.split(',').map(x => x.trim()).filter(Boolean), poolLength: fPoolLength.value || null, sets: data.sets });
    toast(isEdit ? t('templates.savedEdit') : t('templates.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('templates.modalEdit') : t('templates.modalCreate'), bodyNode: form, wide: true });
}
