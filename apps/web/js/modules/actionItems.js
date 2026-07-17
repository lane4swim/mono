// ============================================================
// modules/actionItems.js — Identifikation & Dokumentation von
// Handlungsfeldern (Entwicklungsschwerpunkte pro Athlet:in)
// ============================================================
import { getAll, put, remove } from '../db.js';
import {
  el, clear, field, textInput, selectInput, openModal, confirmAction, toast, badge,
  emptyState, laneWave, fmtDateShort, todayISO, fullName, beginRender,
} from '../utils.js';
import { ACTION_CATEGORIES, ACTION_STATUS } from '../refdata.js';
import { getRole, getCurrentUser } from '../state.js';
import { navigate } from '../router.js';
import { t, trLabel, trOptions } from '../i18n.js';

export const actionItemsModule = {
  id: 'actionitems',
  roles: ['trainer', 'admin', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    const [items, athletes] = await Promise.all([getAll('actionItems'), getAll('athletes')]);
    if (!isCurrent()) return;
    const role = getRole();
    if (role === 'athlete') {
      const user = getCurrentUser();
      const mine = items.filter(i => i.athleteId === user?.athleteId);
      return renderAthleteList(container, mine, athletes);
    }
    if (params[0]) return renderDetail(container, params[0]);
    renderList(container, items, athletes);
  }
};

function statusBadge(status) {
  const label = trLabel(ACTION_STATUS, status, 'actionStatus');
  const variant = status === 'done' ? 'done' : status === 'progress' ? 'progress' : 'open';
  return badge(label, variant);
}

function renderList(container, items, athletes) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('actionitems.eyebrow', { count: items.length })), el('h1', { class: 'mt-0' }, t('actionitems.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openItemModal(null, athletes, refresh) }, t('actionitems.addItem'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('actionitems.intro')));

  let statusFilter = 'all';
  const pillRow = el('div', { class: 'pill-group mb-16' });
  const statuses = [{ value: 'all', label: t('actionitems.all') }, ...trOptions(ACTION_STATUS, 'actionStatus')];
  statuses.forEach((s, i) => {
    const count = s.value === 'all' ? items.length : items.filter(x => x.status === s.value).length;
    const pill = el('button', { class: `pill ${i === 0 ? 'active' : ''}`, onclick: () => { statusFilter = s.value; [...pillRow.children].forEach(p => p.classList.remove('active')); pill.classList.add('active'); draw(); } }, `${s.label} (${count})`);
    pillRow.appendChild(pill);
  });
  wrap.appendChild(pillRow);

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function draw() {
    clear(host);
    const filtered = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter);
    if (filtered.length === 0) { host.appendChild(emptyState(t('common.nothingHereTitle'), t('actionitems.noneForFilter'), null)); return; }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('actionitems.colAthlete')), el('th', {}, t('actionitems.colTitle')), el('th', {}, t('actionitems.colCategory')), el('th', {}, t('actionitems.colStatus')), el('th', {}, t('actionitems.colDue')), el('th', {}, '')])));
    const tbody = el('tbody');
    filtered.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).forEach(i => {
      const athlete = athletes.find(a => a.id === i.athleteId);
      const cat = trLabel(ACTION_CATEGORIES, i.category, 'actionCategories');
      tbody.appendChild(el('tr', { class: 'row-click', onclick: () => navigate('actionitems', i.id) }, [
        el('td', {}, fullName(athlete)), el('td', {}, i.title), el('td', {}, cat), el('td', {}, statusBadge(i.status)),
        el('td', {}, i.dueDate ? fmtDateShort(i.dueDate) : '—'),
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); navigate('actionitems', i.id); } }, t('common.open'))),
      ]));
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }
  draw();

  async function refresh() { const [i2, a2] = await Promise.all([getAll('actionItems'), getAll('athletes')]); clear(container); renderList(container, i2, a2); }
}

async function renderDetail(container, itemId) {
  const [items, athletes] = await Promise.all([getAll('actionItems'), getAll('athletes')]);
  const item = items.find(i => i.id === itemId);
  if (!item) { container.appendChild(emptyState(t('common.notFoundTitle'), t('actionitems.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('actionitems') }, t('common.back')))); return; }
  const athlete = athletes.find(a => a.id === item.athleteId);
  const cat = trLabel(ACTION_CATEGORIES, item.category, 'actionCategories');

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('actionitems') }, t('actionitems.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, fullName(athlete)), el('h1', { class: 'mt-0' }, item.title)]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openItemModal(item, athletes, () => { clear(container); renderDetail(container, itemId); }) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('actionitems.deleteConfirm'), async () => { await remove('actionItems', itemId); toast(t('actionitems.deleted')); navigate('actionitems'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('div', { class: 'pill-group mb-16' }, [statusBadge(item.status), badge(cat, 'neutral'), item.dueDate ? badge(t('actionitems.dueLabel', { date: fmtDateShort(item.dueDate) }), 'neutral') : null].filter(Boolean)));
  wrap.appendChild(el('div', { class: 'card' }, [
    el('h3', { class: 'mt-0' }, t('actionitems.descriptionTitle')),
    el('p', {}, item.description || t('actionitems.noDescription')),
    el('p', { class: 'text-sm' }, t('actionitems.createdOn', { date: fmtDateShort(item.createdDate) })),
  ]));
  container.appendChild(wrap);
}

function renderAthleteList(container, items, athletes) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('div', { class: 'page-eyebrow' }, t('actionitems.myGoalsEyebrow')), el('h1', { class: 'mt-0' }, t('actionitems.myGoalsTitle'))])]));
  wrap.appendChild(laneWave());
  if (items.length === 0) { wrap.appendChild(emptyState(t('actionitems.allGoodTitle'), t('actionitems.allGoodMsg'), null)); container.appendChild(wrap); return; }
  items.forEach(i => {
    const cat = trLabel(ACTION_CATEGORIES, i.category, 'actionCategories');
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'flex justify-between items-center' }, [el('h3', { class: 'mt-0' }, i.title), statusBadge(i.status)]),
      el('p', { class: 'text-sm' }, cat),
      el('p', {}, i.description || ''),
    ]));
  });
  container.appendChild(wrap);
}

function openItemModal(item, athletes, onSaved) {
  const isEdit = !!item;
  const data = item ? { ...item } : { athleteId: athletes[0]?.id || '', title: '', description: '', category: 'technik', status: 'offen', createdDate: todayISO(), dueDate: '' };
  const form = el('form', { class: 'form-grid' });
  const fAthlete = selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), data.athleteId);
  const fTitle = textInput(data.title, { required: true });
  const fCat = selectInput(trOptions(ACTION_CATEGORIES, 'actionCategories'), data.category);
  const fStatus = selectInput(trOptions(ACTION_STATUS, 'actionStatus'), data.status);
  const fDue = el('input', { type: 'date', value: data.dueDate || '' });
  const fDesc = el('textarea', {}, data.description || '');
  form.appendChild(field(t('actionitems.formAthlete'), fAthlete, { span2: true }));
  form.appendChild(field(t('actionitems.formTitle'), fTitle, { span2: true }));
  form.appendChild(field(t('actionitems.formCategory'), fCat));
  form.appendChild(field(t('actionitems.formStatus'), fStatus));
  form.appendChild(field(t('actionitems.formDue'), fDue));
  form.appendChild(field(t('actionitems.formDescription'), fDesc, { span2: true }));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fTitle.value.trim()) { toast(t('actionitems.validationTitle'), 'error'); return; }
    await put('actionItems', { ...data, athleteId: fAthlete.value, title: fTitle.value.trim(), category: fCat.value, status: fStatus.value, dueDate: fDue.value, description: fDesc.value.trim() });
    toast(isEdit ? t('actionitems.savedEdit') : t('actionitems.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('actionitems.modalEdit') : t('actionitems.modalCreate'), bodyNode: form, wide: true });
}
