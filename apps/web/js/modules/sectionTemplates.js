// Abschnitts-Vorlagen-Katalog — wiederverwendbare Abschnitte (z. B.
// "Einschwimmen"), unabhängig von einem einzelnen Trainingsplan/einer
// Trainingsplan-Vorlage anlegbar und dort per setEditor.js einfügbar.
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender, icon, redraw } from '../dom.js';
import { badge, emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, formActions } from '../forms.js';
import { renderSetEditor, totalDistance, cloneItems, collectEquipment, renderEntryList } from './setEditor.js';
import { EQUIPMENT_ITEMS } from '../refdata.js';
import { t, trLabel } from '../i18n.js';
import { libraryTransferButtons } from './libraryTransfer.js';

const VIEW_STORAGE_KEY = 'lane1-sectiontemplates-view';
function loadView() {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
}
function saveView(mode) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* ignore (private mode etc.) */ }
}

const ICON_VIEW_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const ICON_VIEW_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round" stroke-width="2.6"/></svg>`;

export const sectionTemplatesModule = {
  id: 'sectionTemplates',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [sectionTemplates, exercises] = await Promise.all([getAll('sectionTemplates'), getAll('exercises')]);
    if (!isCurrent()) return;
    renderList(container, sectionTemplates, exercises);
  }
};

// Baut eine unabhängige Kopie einer Abschnitts-Vorlage für "Duplizieren" —
// analog zu duplicateTemplate() in templates.js (siehe dortiger
// Kommentar zur Kommentar-Autorenschaft).
export function duplicateSectionTemplate(sectionTemplate) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...rest } = sectionTemplate;
  return { ...rest, name: t('common.copyOf', { name: sectionTemplate.name }), entries: cloneItems(sectionTemplate.entries || [], { resetComments: true }) };
}

function renderList(container, sectionTemplates, exercises) {
  const wrap = el('div');
  let viewMode = loadView();

  const gridBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`,
    title: t('sectionTemplates.viewGrid'), 'aria-label': t('sectionTemplates.viewGrid'), 'aria-pressed': viewMode === 'grid',
    onclick: () => setView('grid'),
  }, icon(ICON_VIEW_GRID));
  const listBtn = el('button', {
    type: 'button', class: `view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`,
    title: t('sectionTemplates.viewList'), 'aria-label': t('sectionTemplates.viewList'), 'aria-pressed': viewMode === 'list',
    onclick: () => setView('list'),
  }, icon(ICON_VIEW_LIST));
  const viewToggle = el('div', { class: 'view-toggle' }, [gridBtn, listBtn]);

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('sectionTemplates.eyebrow', { count: sectionTemplates.length })), el('h1', { class: 'mt-0' }, t('sectionTemplates.title'))]),
    el('div', { class: 'page-actions' }, [
      viewToggle,
      libraryTransferButtons({ onImported: refresh }),
      el('button', { class: 'btn btn-primary', onclick: () => openSectionTemplateModal(null, exercises, refresh) }, t('sectionTemplates.createSectionTemplate')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('sectionTemplates.intro')));

  let search = '';
  wrap.appendChild(el('div', { class: 'grid grid-2 mb-16' }, [
    field(t('sectionTemplates.searchLabel'), textInput('', { placeholder: t('sectionTemplates.searchPlaceholder'), oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } })),
  ]));

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
    let filtered = sectionTemplates;
    if (search) filtered = filtered.filter(st => (st.name + ' ' + (st.description || '')).toLowerCase().includes(search));
    filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (filtered.length === 0) { host.appendChild(emptyState(t('sectionTemplates.noSectionTemplatesTitle'), t('sectionTemplates.noSectionTemplatesMsg'), null)); return; }
    if (viewMode === 'list') drawTable(filtered); else drawGrid(filtered);
  }

  function drawGrid(filtered) {
    const grid = el('div', { class: 'grid grid-3' });
    filtered.forEach(st => {
      const stEquipment = collectEquipment(st.entries || [], exercises);
      const card = el('div', { class: 'card' }, [
        el('div', { class: 'flex justify-between items-center mb-8' }, [el('h3', { class: 'mt-0', style: 'font-size:1.05rem' }, st.name), badge(t('plans.totalBadge', { m: totalDistance(st.entries || []) }), 'neutral')]),
        el('p', { class: 'text-sm' }, st.description || ''),
        el('div', { class: 'pill-group mb-8' }, (st.tags || []).map(tag => badge(tag, 'neutral'))),
      ]);
      if (stEquipment.length > 0) {
        card.appendChild(el('p', { class: 'text-sm' }, `${t('setEditor.equipmentSummary')} ${stEquipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`));
      }
      card.appendChild(renderEntryList(st.entries || [], exercises, { allowSection: false }));
      card.appendChild(el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openSectionTemplateModal(st, exercises, refresh) }, t('common.edit')),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => duplicate(st) }, t('common.duplicate')),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('sectionTemplates.deleteConfirm', { name: st.name }), async () => { await remove('sectionTemplates', st.id); toast(t('sectionTemplates.deleted')); refresh(); }) }, t('common.delete')),
      ]));
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function drawTable(filtered) {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('sectionTemplates.colName')), el('th', {}, t('sectionTemplates.colEntries')), el('th', {}, t('sectionTemplates.colDistance')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    filtered.forEach(st => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('strong', {}, st.name), st.description ? el('div', { class: 'text-sm', style: 'color:var(--c-slate)' }, st.description) : null].filter(Boolean)),
        el('td', {}, String((st.entries || []).length)),
        el('td', {}, `${totalDistance(st.entries || [])} m`),
        el('td', {}, el('div', { class: 'flex gap-8' }, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openSectionTemplateModal(st, exercises, refresh) }, t('common.edit')),
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => duplicate(st) }, t('common.duplicate')),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('sectionTemplates.deleteConfirm', { name: st.name }), async () => { await remove('sectionTemplates', st.id); toast(t('sectionTemplates.deleted')); refresh(); }) }, t('common.delete')),
        ])),
      ]));
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }

  draw();

  async function duplicate(st) { await put('sectionTemplates', duplicateSectionTemplate(st)); toast(t('sectionTemplates.duplicated')); refresh(); }

  function refresh() {
    return redraw(container, () => Promise.all([getAll('sectionTemplates'), getAll('exercises')]), ([st2, e2]) => renderList(container, st2, e2));
  }
}

function openSectionTemplateModal(sectionTemplate, exercises, onSaved) {
  const isEdit = !!sectionTemplate;
  const data = sectionTemplate ? { ...sectionTemplate, entries: cloneItems(sectionTemplate.entries) } : { name: '', description: '', tags: [], entries: [] };
  const form = el('form', { class: 'form-grid single' });
  const fName = textInput(data.name, { required: true });
  const fDesc = el('textarea', {}, data.description || '');
  const fTags = textInput((data.tags || []).join(', '), { placeholder: 'z. B. einschwimmen, technik' });
  form.appendChild(field(t('sectionTemplates.formName'), fName));
  form.appendChild(field(t('sectionTemplates.formDescription'), fDesc));
  form.appendChild(field(t('sectionTemplates.formTags'), fTags, { hint: t('sectionTemplates.formTagsHint') }));

  const entriesWrap = el('div', { class: 'field' });
  entriesWrap.appendChild(el('label', {}, t('sectionTemplates.entriesLabel')));
  const entriesHost = el('div');
  entriesWrap.appendChild(entriesHost);
  form.appendChild(entriesWrap);
  // allowSection: false — eine Abschnitts-Vorlage entspricht Section.entries
  // (nur Sätze/Blöcke), keine verschachtelten Abschnitte (siehe entities.ts).
  renderSetEditor(entriesHost, data.entries, exercises, { allowSection: false });

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create'), spanFull: false }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('sectionTemplates.validationName'), 'error'); return; }
    await put('sectionTemplates', { ...data, name: fName.value.trim(), description: fDesc.value.trim(), tags: fTags.value.split(',').map(x => x.trim()).filter(Boolean), entries: data.entries });
    toast(isEdit ? t('sectionTemplates.savedEdit') : t('sectionTemplates.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('sectionTemplates.modalEdit') : t('sectionTemplates.modalCreate'), bodyNode: form, wide: true });
}
