// Normtabellen: wiederverwendbare Pflichtzeiten (Store "requiredTimeSets"),
// die in Wettkämpfe kopiert werden (docs/Plans/pflichtzeiten-manuell-plan.md,
// Abschnitt 3). Kein eigenes Router-Modul — Unterseite der Route
// 'competitions' (navigate('competitions', 'normtables')), wie die
// Vorlagen-Zyklen bei den Trainingsplänen; Paket 'competitions'.
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { field, textInput, formActions } from '../forms.js';
import { openModal, confirmAction } from '../modal.js';
import { toast, emptyState, laneWave } from '../ui.js';
import { navigate } from '../router.js';
import { t, trCode } from '../i18n.js';
import { buildRequiredTimesEditor } from './requiredTimesEditor.js';

export const REQUIRED_TIME_SETS_ROUTE = 'normtables';

export async function renderRequiredTimeSets(container) {
  const isCurrent = beginRender(container);
  const sets = await getAll('requiredTimeSets');
  if (!isCurrent()) return;
  clear(container);
  const refresh = () => renderRequiredTimeSets(container);
  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('competitions') }, t('competitions.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, t('requiredTimes.setsTitle'))]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-primary', onclick: () => openRequiredTimeSetModal(null, refresh) }, t('requiredTimes.setAdd')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', { class: 'text-sm' }, t('requiredTimes.setsIntro')));
  if (sets.length === 0) {
    wrap.appendChild(emptyState(t('requiredTimes.setsNone'), t('requiredTimes.setsNoneHint')));
  } else {
    const tbody = el('tbody');
    for (const set of [...sets].sort((a, b) => a.name.localeCompare(b.name))) {
      tbody.appendChild(el('tr', { class: 'rt-set-row' }, [
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openRequiredTimeSetModal(set, refresh) }, set.name)),
        el('td', {}, set.description || ''),
        el('td', {}, setSummary(set)),
        el('td', { class: 'rt-row-actions' }, [
          el('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: async () => {
              const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = set;
              await put('requiredTimeSets', { ...rest, name: t('common.copyOf', { name: set.name }).slice(0, 200) });
              toast(t('requiredTimes.setDuplicated'));
              refresh();
            },
          }, t('common.duplicate')),
          el('button', {
            class: 'btn btn-danger btn-sm',
            onclick: () => confirmAction(t('requiredTimes.setDeleteConfirm', { name: set.name }), async () => {
              await remove('requiredTimeSets', set.id);
              toast(t('requiredTimes.setDeleted'));
              refresh();
            }),
          }, t('common.delete')),
        ]),
      ]));
    }
    wrap.appendChild(el('div', { class: 'card' }, el('div', { class: 'table-wrap' }, el('table', {}, [
      el('thead', {}, el('tr', {}, [el('th', {}, t('requiredTimes.setName')), el('th', {}, t('requiredTimes.setDescription')), el('th', {}, t('requiredTimes.cardTitle')), el('th', {}, '')])),
      tbody,
    ]))));
  }
  container.appendChild(wrap);
}

// "12 Pflichtzeiten · 50 Freistil, 100 Freistil, …"
export function setSummary(set) {
  const rules = set.rules || [];
  const events = [...new Set(rules.map((r) => r.event))];
  const shown = events.slice(0, 3).map((e) => trCode(e, 'events')).join(', ');
  return t('requiredTimes.setRulesCount', { count: rules.length }) + (events.length ? ` · ${shown}${events.length > 3 ? ', …' : ''}` : '');
}

export function openRequiredTimeSetModal(set, onSaved) {
  const isEdit = !!set;
  const data = set ? { ...set } : { name: '', description: '', rules: [], qualifyingWindow: {} };
  const fName = textInput(data.name, { required: true, maxlength: 200 });
  const fDescription = textInput(data.description || '', { maxlength: 2000 });
  const editor = buildRequiredTimesEditor({ rules: data.rules || [], window: data.qualifyingWindow || {} });
  const form = el('form', { class: 'form-grid' });
  form.appendChild(field(t('requiredTimes.setName'), fName));
  form.appendChild(field(t('requiredTimes.setDescription'), fDescription));
  form.appendChild(el('div', { style: 'grid-column:1/-1' }, editor.node));
  const { row } = formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') });
  form.appendChild(row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = fName.value.trim();
    if (!name) { toast(t('requiredTimes.setNameRequired'), 'error'); return; }
    const res = editor.collect();
    if (!res.ok) return;
    await put('requiredTimeSets', { ...data, name, description: fDescription.value.trim(), rules: res.rules, qualifyingWindow: res.window });
    toast(t('requiredTimes.setSaved'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: t(isEdit ? 'requiredTimes.setEditTitle' : 'requiredTimes.setCreateTitle'), bodyNode: form, wide: true });
}
