// ============================================================
// modules/plans.js — Trainingspläne (Sets, Serien, Wochenpläne, Kalender)
// ============================================================
import { getAll, put, remove, uid } from '../db.js';
import {
  el, clear, field, textInput, selectInput, openModal, confirmAction, toast, badge,
  emptyState, laneWave, fmtDateLong, fmtDateShort, todayISO, isoAddDays, startOfWeek, beginRender,
} from '../utils.js';
import { WEEKDAYS, EQUIPMENT_ITEMS } from '../refdata.js';
import { renderSetEditor, totalDistance, cloneItems, collectEquipment } from './setEditor.js';
import { renderCommentThread, commentsButton } from './comments.js';
import { navigate } from '../router.js';
import { t, trLabel } from '../i18n.js';

export const plansModule = {
  id: 'plans',
  roles: ['trainer', 'admin', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 2.5v4M16 2.5v4"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    const [plans, groups, templates, exercises] = await Promise.all([getAll('plans'), getAll('groups'), getAll('templates'), getAll('exercises')]);
    if (!isCurrent()) return;
    if (params[0]) return renderDetail(container, params[0]);
    renderList(container, plans, groups, templates, exercises);
  }
};

function renderList(container, plans, groups, templates, exercises) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('plans.eyebrow', { count: plans.length })), el('h1', { class: 'mt-0' }, t('plans.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openPlanModal(null, groups, templates, exercises, refresh) }, t('plans.createPlan'))]),
  ]));
  wrap.appendChild(laneWave());

  const host = el('div', { class: 'grid grid-2' });
  wrap.appendChild(host);
  container.appendChild(wrap);

  if (plans.length === 0) host.appendChild(emptyState(t('plans.noPlansTitle'), t('plans.noPlansMsg'), null));
  plans.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).forEach(p => {
    const group = groups.find(g => g.id === p.groupId);
    const dist = (p.days || []).reduce((sum, d) => sum + totalDistance(d.sets || []), 0);
    const card = el('div', { class: 'card row-click', onclick: () => navigate('plans', p.id) }, [
      el('div', { class: 'flex justify-between items-center' }, [el('h3', { class: 'mt-0' }, p.name), badge(p.status === 'aktiv' ? t('plans.statusActive') : t('plans.statusArchived'), p.status === 'aktiv' ? 'done' : 'neutral')]),
      el('p', { class: 'text-sm' }, `${group?.name || t('plans.noGroup')} · ${t('plans.sessionsCount', { count: (p.days || []).length })} · ${t('plans.totalMeters', { m: dist })}`),
      el('p', { class: 'text-sm' }, t('plans.weekFrom', { date: fmtDateShort(p.weekStart) })),
    ]);
    host.appendChild(card);
  });

  async function refresh() { const [p2, g2, t2, e2] = await Promise.all([getAll('plans'), getAll('groups'), getAll('templates'), getAll('exercises')]); clear(container); renderList(container, p2, g2, t2, e2); }
}

async function renderDetail(container, planId) {
  const [plans, groups, templates, exercises] = await Promise.all([getAll('plans'), getAll('groups'), getAll('templates'), getAll('exercises')]);
  const plan = plans.find(p => p.id === planId);
  if (!plan) { container.appendChild(emptyState(t('common.notFoundTitle'), t('plans.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('plans') }, t('common.back')))); return; }
  const group = groups.find(g => g.id === plan.groupId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('plans') }, t('plans.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, group?.name || t('plans.noGroup')), el('h1', { class: 'mt-0' }, plan.name)]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openPlanModal(plan, groups, templates, exercises, () => { clear(container); renderDetail(container, planId); }) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('plans.deleteConfirm'), async () => { await remove('plans', planId); toast(t('plans.deleted')); navigate('plans'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('plans.statusLine', { date: fmtDateLong(plan.weekStart), status: plan.status === 'aktiv' ? t('plans.statusActive') : t('plans.statusArchived') })));

  const planCommentsCard = el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('comments.planCommentsTitle'))]);
  const planCommentsHost = el('div');
  planCommentsCard.appendChild(planCommentsHost);
  wrap.appendChild(planCommentsCard);
  renderCommentThread(planCommentsHost, plan.comments, async (nextComments) => {
    await put('plans', { ...plan, comments: nextComments });
  });

  (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(day => {
    const dayEquipment = collectEquipment(day.sets || [], exercises);
    const dayCard = el('div', { class: 'card' }, [
      el('div', { class: 'day-block-head' }, [
        el('h3', { class: 'mt-0' }, fmtDateLong(day.date)),
        el('div', { class: 'flex items-center gap-8' }, [
          badge(t('plans.totalBadge', { m: totalDistance(day.sets || []) }), 'neutral'),
        ]),
      ]),
    ]);
    dayCard.appendChild(el('p', { class: 'text-sm', style: 'margin-top:-8px' },
      dayEquipment.length > 0
        ? `${t('setEditor.equipmentSummary')} ${dayEquipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`
        : t('setEditor.equipmentNone')));
    dayCard.appendChild(renderDayItems(day.sets || [], exercises, plan));
    wrap.appendChild(dayCard);
  });

  container.appendChild(wrap);
}

// Renders a day's sets/blocks for read-only display. Consecutive plain
// sets are grouped into one table (as before); a repeat block interrupts
// the table and is shown as its own distinct box — same visual language
// (dashed border, "repeat block" badge) as the editor uses, so the
// reading view and the editing view stay recognizably consistent.
function renderDayItems(items, exercises, plan) {
  const host = el('div');
  if (items.length === 0) { host.appendChild(el('p', {}, t('plans.noSetsPlanned'))); return host; }

  let pendingRows = [];
  function flushTable() {
    if (pendingRows.length === 0) return;
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('plans.colDescription')), el('th', {}, t('plans.colDistance')), el('th', {}, t('plans.colReps')), el('th', {}, t('plans.colRest')), el('th', {}, '')])));
    const tbody = el('tbody');
    pendingRows.forEach(row => tbody.appendChild(row));
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap mb-8' }, table));
    pendingRows = [];
  }

  items.forEach(entry => {
    if (entry.kind === 'block') {
      flushTable();
      host.appendChild(renderBlockBox(entry, exercises, plan));
    } else {
      pendingRows.push(el('tr', {}, [
        el('td', {}, equipmentDescCell(entry, exercises)), el('td', {}, `${entry.distance ?? '—'} m`), el('td', {}, entry.reps), el('td', {}, `${entry.restSec || 0}s`),
        el('td', {}, setCommentsButton(entry, plan)),
      ]));
    }
  });
  flushTable();
  return host;
}

// Opens a modal with the comment thread for a single set/exercise entry
// within a plan (works the same whether `entry` sits directly in a day's
// `sets` array or inside a repeat block's `sets` array, since both are
// the same object reference living somewhere inside `plan.days`).
// Persisting just re-saves the whole plan — mutating `entry.comments`
// in place already updated the right spot inside `plan.days`.
function setCommentsButton(entry, plan) {
  return commentsButton(entry.comments, {
    title: t('comments.setCommentsTitle'),
    persist: async (nextComments) => {
      entry.comments = nextComments;
      await put('plans', { ...plan });
    },
  });
}

// Builds the "Beschreibung" cell content: the set's text, plus a small
// equipment badge row underneath if it's linked to a catalog exercise
// that needs equipment — this is what was missing from the read-only
// plan view (equipment was only ever shown inside the edit dialog).
function equipmentDescCell(entry, exercises) {
  const wrap = el('div');
  wrap.appendChild(el('div', {}, entry.description || '—'));
  if (entry.exerciseId) {
    const ex = (exercises || []).find(x => x.id === entry.exerciseId);
    if (ex && (ex.equipment || []).length > 0) {
      wrap.appendChild(el('div', { class: 'pill-group', style: 'margin-top:3px' },
        ex.equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'))));
    }
  }
  return wrap;
}

function renderBlockBox(block, exercises, plan) {
  const innerDist = totalDistance(block.sets || []);
  const blockEquipment = collectEquipment(block.sets || [], exercises);
  const box = el('div', { class: 'day-block', style: 'margin:4px 0 12px;border-style:dashed;border-color:var(--c-chlorine-d);background:var(--c-foam-2)' });
  box.appendChild(el('div', { class: 'day-block-head' }, [
    el('div', { class: 'flex items-center gap-8' }, [badge(t('plans.repeatBlockLabel', { n: block.repeatCount || 1 }), 'progress'), el('strong', {}, block.label || t('templates.defaultBlockLabel'))]),
    badge(t('plans.totalBadge', { m: innerDist * (block.repeatCount || 1) }), 'neutral'),
  ]));
  if (blockEquipment.length > 0) {
    box.appendChild(el('p', { class: 'text-sm', style: 'margin-top:-6px' },
      `${t('setEditor.equipmentSummary')} ${blockEquipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`));
  }
  if (!block.sets || block.sets.length === 0) {
    box.appendChild(el('p', { class: 'hint mt-0' }, t('plans.blockNoSets')));
  } else {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('plans.colDescription')), el('th', {}, t('plans.colDistance')), el('th', {}, t('plans.colReps')), el('th', {}, t('plans.colRest')), el('th', {}, '')])));
    const tbody = el('tbody');
    block.sets.forEach(s => tbody.appendChild(el('tr', {}, [el('td', {}, equipmentDescCell(s, exercises)), el('td', {}, `${s.distance ?? '—'} m`), el('td', {}, s.reps), el('td', {}, `${s.restSec || 0}s`), el('td', {}, setCommentsButton(s, plan))])));
    table.appendChild(tbody);
    box.appendChild(el('div', { class: 'table-wrap' }, table));
  }
  box.appendChild(el('div', { class: 'hint', style: 'margin-top:8px;margin-bottom:0' }, t('plans.blockSummary', { inner: innerDist, n: block.repeatCount || 1, total: innerDist * (block.repeatCount || 1) })));
  return box;
}

function openPlanModal(plan, groups, templates, exercises, onSaved) {
  const isEdit = !!plan;
  const data = plan ? { ...plan, days: (plan.days || []).map(d => ({ ...d, sets: cloneItems(d.sets) })) } : {
    name: `${t('nav.plans')} ${startOfWeek(todayISO())}`, weekStart: startOfWeek(todayISO()), groupId: groups[0]?.id || '', status: 'aktiv', days: [],
  };
  const form = el('form', { class: 'form-grid single' });
  const fName = textInput(data.name, { required: true });
  const fWeek = el('input', { type: 'date', value: data.weekStart });
  const fGroup = selectInput(groups.map(g => ({ value: g.id, label: g.name })), data.groupId);
  const fStatus = selectInput([{ value: 'aktiv', label: t('plans.statusActive') }, { value: 'archiv', label: t('plans.statusArchived') }], data.status);
  form.appendChild(field(t('plans.formName'), fName));
  const row2 = el('div', { class: 'form-grid' }, [field(t('plans.formWeekStart'), fWeek), field(t('plans.formGroup'), fGroup)]);
  form.appendChild(row2);
  form.appendChild(field(t('plans.formStatus'), fStatus));

  const daysWrap = el('div', { class: 'field' });
  daysWrap.appendChild(el('label', {}, t('plans.trainingDaysLabel')));
  const daysHost = el('div');
  daysWrap.appendChild(daysHost);
  form.appendChild(daysWrap);

  function drawDays() {
    clear(daysHost);
    data.days.forEach((day, di) => {
      const block = el('div', { class: 'day-block' });
      const dateInput = el('input', { type: 'date', value: day.date, oninput: (e) => day.date = e.target.value });
      block.appendChild(el('div', { class: 'day-block-head' }, [
        el('div', { class: 'flex items-center gap-8' }, [el('strong', {}, t('plans.dateLabel')), dateInput]),
        el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => { data.days.splice(di, 1); drawDays(); } }, t('plans.removeDay')),
      ]));
      const setsHost = el('div');
      block.appendChild(setsHost);
      renderSetEditor(setsHost, day.sets, exercises);
      daysHost.appendChild(block);
    });
  }
  drawDays();

  const addRow = el('div', { class: 'flex gap-8', style: 'margin-top:8px' });
  const templateSel = selectInput([{ value: '', label: t('plans.emptyDayOption') }, ...templates.map(tpl => ({ value: tpl.id, label: tpl.name }))], '');
  addRow.appendChild(templateSel);
  addRow.appendChild(el('button', { type: 'button', class: 'btn btn-accent btn-sm', onclick: () => {
    const tpl = templates.find(x => x.id === templateSel.value);
    const nextDate = data.days.length ? isoAddDays(data.days[data.days.length - 1].date, 1) : fWeek.value || todayISO();
    data.days.push({ date: nextDate, sets: tpl ? cloneItems(tpl.sets) : [] });
    drawDays();
  } }, t('plans.addDayButton')));
  daysWrap.appendChild(addRow);

  form.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('plans.validationName'), 'error'); return; }
    await put('plans', { ...data, name: fName.value.trim(), weekStart: fWeek.value, groupId: fGroup.value, status: fStatus.value, days: data.days });
    toast(isEdit ? t('plans.savedEdit') : t('plans.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('plans.modalEdit') : t('plans.modalCreate'), bodyNode: form, wide: true });
}
