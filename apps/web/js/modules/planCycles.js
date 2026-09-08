// Wiederkehrende Trainingspläne / Vorlagen-Zyklen (Phase 1, Abschnitt 3.1
// — docs/trainingsplanung-phase1-plan.md). Kein eigenes registriertes
// Modul: die UI hängt an der bestehenden 'plans'-Route
// (navigate('plans', 'cycles', ...), siehe plans.js), das Paket bleibt
// 'plans' (packages/shared-types/src/modules.ts).
import { getAll, put, remove } from '../db.js';
import { el, clear } from '../dom.js';
import { emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { cloneItems } from './setEditor.js';
import { isoAddDays, startOfWeek, todayISO, toIsoDateTime } from '../dates.js';
import { navigate } from '../router.js';
import { isTrainerOrAdmin } from '../state.js';
import { t } from '../i18n.js';

// dayOfWeek 0..6 -> Übersetzungsschlüssel unter i18n "weekdays" (Montag = 0,
// siehe dates.js: startOfWeek()).
const WEEKDAY_KEYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Plan.name ist serverseitig auf 200 Zeichen begrenzt
// (packages/shared-types/src/entities.ts: PlanSchema) — Zyklusname und
// Wochen-Label dürfen je bis zu 200 sein, ihre Kombination also bis zu 403.
// Ohne diese Kappung würde ein solcher Plan lokal angelegt, aber sein
// Sync-Push dauerhaft am Schema scheitern (Code-Review-Fund).
const PLAN_NAME_MAX = 200;
function planNameFor(cycleName, weekLabel) {
  return `${cycleName} — ${weekLabel}`.slice(0, PLAN_NAME_MAX);
}

// Reine Funktion: erzeugt aus einem Zyklus konkrete Plan-Objekte
// (Snapshot — kein Bezug zu Cycle/Template danach). Daten sind noch ohne
// id/clubId/createdAt/updatedAt, das übernimmt put() beim Speichern.
export function buildPlansFromCycle(cycle, templates, startDateIso, groupId) {
  const base = startOfWeek(startDateIso);
  return cycle.weeks.map((week, i) => {
    const weekStart = isoAddDays(base, week.weekOffset * 7);
    const days = week.days.map(d => {
      const tpl = templates.find(x => x.id === d.templateId);
      return { date: isoAddDays(weekStart, d.dayOfWeek), sets: tpl ? cloneItems(tpl.sets) : [] };
    });
    return { name: planNameFor(cycle.name, week.label || `Woche ${i + 1}`), weekStart, groupId, status: 'aktiv', days };
  });
}

export async function renderCyclesRoute(container, isCurrent, params) {
  const [cycles, templates, groups] = await Promise.all(['planCycles', 'templates', 'groups'].map(getAll));
  if (!isCurrent()) return;
  if (params[0]) return renderCycleDetail(container, params[0], cycles, templates, groups);
  renderCyclesList(container, cycles, templates);
}

function renderCyclesList(container, cycles, templates) {
  const canManage = isTrainerOrAdmin();
  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('plans') }, t('planCycles.backToPlans')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('planCycles.eyebrow', { count: cycles.length })), el('h1', { class: 'mt-0' }, t('planCycles.title'))]),
    el('div', { class: 'page-actions' }, canManage ? [el('button', { class: 'btn btn-primary', onclick: () => openCycleModal(null, templates, refresh) }, t('planCycles.createCycle'))] : []),
  ]));
  wrap.appendChild(laneWave());

  const host = el('div', { class: 'grid grid-2' });
  wrap.appendChild(host);
  container.appendChild(wrap);

  if (cycles.length === 0) host.appendChild(emptyState(t('planCycles.noCyclesTitle'), t('planCycles.noCyclesMsg'), null));
  cycles.forEach(c => {
    host.appendChild(el('div', { class: 'card row-click', onclick: () => navigate('plans', 'cycles', c.id) }, [
      el('h3', { class: 'mt-0' }, c.name),
      el('p', { class: 'text-sm' }, t('planCycles.weeksCount', { count: c.weeks.length })),
    ]));
  });

  async function refresh() { const [c2, t2] = await Promise.all(['planCycles', 'templates'].map(getAll)); clear(container); renderCyclesList(container, c2, t2); }
}

function renderCycleDetail(container, cycleId, cycles, templates, groups) {
  const cycle = cycles.find(c => c.id === cycleId);
  if (!cycle) {
    container.appendChild(emptyState(t('common.notFoundTitle'), t('planCycles.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('plans', 'cycles') }, t('common.back'))));
    return;
  }

  const canManage = isTrainerOrAdmin();
  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('plans', 'cycles') }, t('planCycles.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, cycle.name)]),
    el('div', { class: 'page-actions' }, canManage ? [
      el('button', { class: 'btn btn-accent', onclick: () => openApplyCycleModal(cycle, templates, groups) }, t('planCycles.apply')),
      el('button', { class: 'btn btn-ghost', onclick: () => openCycleModal(cycle, templates, refreshDetail) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('planCycles.deleteConfirm'), async () => { await remove('planCycles', cycleId); toast(t('planCycles.deleted')); navigate('plans', 'cycles'); }) }, t('common.delete')),
    ] : []),
  ]));
  wrap.appendChild(laneWave());
  if (cycle.description) wrap.appendChild(el('p', {}, cycle.description));

  cycle.weeks.forEach((week, i) => {
    const box = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, week.label || t('planCycles.weekLabel', { n: i + 1 }))]);
    if (week.days.length === 0) {
      box.appendChild(el('p', {}, t('planCycles.noDaysInWeek')));
    } else {
      const list = el('ul');
      week.days.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek).forEach(d => {
        const tpl = templates.find(x => x.id === d.templateId);
        list.appendChild(el('li', {}, `${t('weekdays.' + WEEKDAY_KEYS[d.dayOfWeek])}: ${tpl?.name || t('planCycles.unknownTemplate')}`));
      });
      box.appendChild(list);
    }
    wrap.appendChild(box);
  });

  container.appendChild(wrap);

  // Nach dem Speichern neu aus der DB laden statt die veraltete `cycles`-
  // Kopie aus dem Aufrufer-Closure weiterzureichen (Code-Review-Fund: eine
  // Umbenennung/Wochenänderung blieb sonst bis zum nächsten Reload
  // unsichtbar) — analog zu plans.js: renderDetail(), das ebenfalls frisch
  // lädt statt eine übergebene Liste wiederzuverwenden.
  async function refreshDetail() {
    const [cycles2, templates2, groups2] = await Promise.all(['planCycles', 'templates', 'groups'].map(getAll));
    clear(container);
    renderCycleDetail(container, cycleId, cycles2, templates2, groups2);
  }
}

function openCycleModal(cycle, templates, onSaved) {
  const isEdit = !!cycle;
  const data = cycle
    ? { ...cycle, weeks: cycle.weeks.map(w => ({ ...w, days: w.days.map(d => ({ ...d })) })) }
    : { name: '', description: '', weeks: [] };

  const form = el('form', { class: 'form-grid single' });
  const fName = textInput(data.name, { required: true });
  const fDesc = el('textarea', {}, data.description || '');
  form.appendChild(field(t('planCycles.formName'), fName));
  form.appendChild(field(t('planCycles.formDescription'), fDesc));

  const weeksWrap = el('div', { class: 'field' });
  weeksWrap.appendChild(el('label', {}, t('planCycles.weeksLabel')));
  const weeksHost = el('div');
  weeksWrap.appendChild(weeksHost);
  form.appendChild(weeksWrap);

  function renumberWeeks() { data.weeks.forEach((w, i) => w.weekOffset = i); }

  function drawWeeks() {
    clear(weeksHost);
    data.weeks.forEach((week, wi) => {
      const block = el('div', { class: 'day-block' });
      const labelInput = el('input', { type: 'text', value: week.label || '', placeholder: t('planCycles.weekLabel', { n: wi + 1 }), oninput: (e) => week.label = e.target.value });
      block.appendChild(el('div', { class: 'day-block-head' }, [
        el('div', { class: 'flex items-center gap-8' }, [el('strong', {}, t('planCycles.weekN', { n: wi + 1 })), labelInput]),
        el('div', { class: 'flex gap-8' }, [
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { data.weeks.splice(wi + 1, 0, { weekOffset: 0, label: week.label, days: week.days.map(d => ({ ...d })) }); renumberWeeks(); drawWeeks(); } }, t('planCycles.duplicateWeek')),
          el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => { data.weeks.splice(wi, 1); renumberWeeks(); drawWeeks(); } }, t('planCycles.removeWeek')),
        ]),
      ]));
      const dayGrid = el('div', { class: 'grid grid-2' });
      WEEKDAY_KEYS.forEach((key, dayOfWeek) => {
        const existing = week.days.find(d => d.dayOfWeek === dayOfWeek);
        const sel = selectInput([{ value: '', label: t('planCycles.noTraining') }, ...templates.map(tpl => ({ value: tpl.id, label: tpl.name }))], existing?.templateId || '', {
          onchange: (e) => {
            const idx = week.days.findIndex(d => d.dayOfWeek === dayOfWeek);
            if (e.target.value) {
              if (idx >= 0) week.days[idx].templateId = e.target.value;
              else week.days.push({ dayOfWeek, templateId: e.target.value });
            } else if (idx >= 0) {
              week.days.splice(idx, 1);
            }
          },
        });
        dayGrid.appendChild(field(t('weekdays.' + key), sel));
      });
      block.appendChild(dayGrid);
      weeksHost.appendChild(block);
    });
  }
  drawWeeks();
  weeksWrap.appendChild(el('button', { type: 'button', class: 'btn btn-accent btn-sm', style: 'margin-top:8px', onclick: () => { data.weeks.push({ weekOffset: data.weeks.length, label: '', days: [] }); drawWeeks(); } }, t('planCycles.addWeek')));

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create'), spanFull: false }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('planCycles.validationName'), 'error'); return; }
    await put('planCycles', { ...data, name: fName.value.trim(), description: fDesc.value.trim(), weeks: data.weeks });
    toast(isEdit ? t('planCycles.savedEdit') : t('planCycles.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('planCycles.modalEdit') : t('planCycles.modalCreate'), bodyNode: form, wide: true });
}

function openApplyCycleModal(cycle, templates, groups) {
  if (groups.length === 0) { toast(t('planCycles.noGroupsForApply'), 'error'); return; }

  const form = el('form', { class: 'form-grid single' });
  const fStart = dateInput(todayISO());
  const fGroup = selectInput([{ value: '', label: t('planCycles.selectGroup') }, ...groups.map(g => ({ value: g.id, label: g.name }))], '');
  form.appendChild(field(t('planCycles.formStartDate'), fStart));
  form.appendChild(field(t('planCycles.formTargetGroup'), fGroup));
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: t('planCycles.apply'), spanFull: false }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fGroup.value) { toast(t('planCycles.validationGroup'), 'error'); return; }
    const plans = buildPlansFromCycle(cycle, templates, fStart.value, fGroup.value);
    for (const p of plans) {
      await put('plans', { ...p, weekStart: toIsoDateTime(p.weekStart), days: p.days.map(d => ({ ...d, date: toIsoDateTime(d.date) })) });
    }
    toast(t('planCycles.applied', { count: plans.length }));
    close();
    navigate('plans');
  });
  const { close } = openModal({ title: t('planCycles.applyModalTitle', { name: cycle.name }), bodyNode: form });
}
