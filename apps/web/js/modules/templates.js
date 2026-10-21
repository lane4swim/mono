// wiederverwendbare Trainingsplan-Vorlagen
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender, icon, redraw } from '../dom.js';
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

const VIEW_STORAGE_KEY = 'lane1-templates-view';
function loadView() {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
}
function saveView(mode) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* ignore (private mode etc.) */ }
}

const ICON_VIEW_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_VIEW_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round" stroke-width="2.6"/></svg>`;

export const templatesModule = {
  id: 'templates',
  // Ohne 'admin': Trainingsplanung ist Sache der Trainer:innen, die
  // Vereinsverwaltung sieht dieses Modul nicht (Admin mit zusätzlicher
  // Rolle 'trainer' weiterhin schon).
  roles: ['trainer'],
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
  let viewMode = loadView();

  const gridBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`,
    title: t('templates.viewGrid'), 'aria-label': t('templates.viewGrid'), 'aria-pressed': String(viewMode === 'grid'),
    onclick: () => setView('grid'),
  }, icon(ICON_VIEW_GRID));
  const listBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`,
    title: t('templates.viewList'), 'aria-label': t('templates.viewList'), 'aria-pressed': String(viewMode === 'list'),
    onclick: () => setView('list'),
  }, icon(ICON_VIEW_LIST));
  const viewToggle = el('div', { class: 'view-toggle' }, [gridBtn, listBtn]);

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, t('templates.title'))]),
    el('div', { class: 'page-actions' }, [
      viewToggle,
      libraryTransferButtons({ onImported: refresh }),
      el('button', { class: 'btn btn-primary', onclick: () => openTemplateModal(null, exercises, sectionTemplates, refresh) }, t('templates.createTemplate')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('templates.intro')));

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function setView(mode) {
    if (mode === viewMode) return;
    viewMode = mode;
    saveView(mode);
    gridBtn.classList.toggle('active', mode === 'grid');
    listBtn.classList.toggle('active', mode === 'list');
    gridBtn.setAttribute('aria-pressed', String(mode === 'grid'));
    listBtn.setAttribute('aria-pressed', String(mode === 'list'));
    draw();
  }

  function draw() {
    clear(host);
    if (templates.length === 0) { host.appendChild(emptyState(t('templates.noTemplatesTitle'), t('templates.noTemplatesMsg'), null)); return; }
    if (viewMode === 'list') drawTable(); else drawGrid();
  }

  function actionButtons(tpl) {
    return [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openTemplateModal(tpl, exercises, sectionTemplates, refresh) }, t('common.edit')),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => duplicate(tpl) }, t('common.duplicate')),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('templates.deleteConfirm', { name: tpl.name }), async () => { await remove('templates', tpl.id); toast(t('templates.deleted')); refresh(); }) }, t('common.delete')),
    ];
  }

  function drawGrid() {
    const grid = el('div', { class: 'grid grid-2' });
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
      card.appendChild(el('div', { class: 'flex gap-8' }, actionButtons(tpl)));
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function drawTable() {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('templates.colName')), el('th', {}, t('templates.colPoolLength')), el('th', {}, t('templates.colEntries')), el('th', {}, t('templates.colDistance')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    templates.forEach(tpl => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', {}, tpl.name), tpl.description ? el('div', { class: 'text-sm', style: 'color:var(--c-slate)' }, tpl.description) : null].filter(Boolean)),
        el('td', {}, tpl.poolLength ? trLabel(COURSES, tpl.poolLength, 'courses') : '—'),
        el('td', {}, String((tpl.sets || []).length)),
        el('td', {}, `${totalDistance(tpl.sets || [])} m`),
        el('td', {}, el('div', { class: 'flex gap-8' }, actionButtons(tpl))),
      ]));
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }

  draw();

  async function duplicate(tpl) { await put('templates', duplicateTemplate(tpl)); toast(t('templates.duplicated')); refresh(); }

  function refresh() {
    return redraw(container, () => Promise.all([getAll('templates'), getAll('exercises'), getAll('sectionTemplates')]), ([t2, e2, st2]) => renderList(container, t2, e2, st2));
  }
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
