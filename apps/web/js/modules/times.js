// ============================================================
// modules/times.js — Zeiten- und Leistungserfassung
// ============================================================
import { getAll, put, remove } from '../db.js';
import { el, clear, fullName, fmtDateShort, todayISO, field, textInput, selectInput,
  openModal, confirmAction, toast, badge, emptyState, laneWave, secToTime, timeToSec,
  groupBy, svgLineChart, beginRender,
} from '../utils.js';
import { EVENTS, COURSES } from '../refdata.js';
import { t, trCode, trOptions, trOptionsFlat } from '../i18n.js';

export const timesModule = {
  id: 'times',
  roles: ['trainer', 'admin', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/><path d="M12 2v3"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [athletes, results] = await Promise.all([getAll('athletes'), getAll('results')]);
    if (!isCurrent()) return;
    renderView(container, athletes, results);
  }
};

function renderView(container, athletes, results) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('times.eyebrow', { count: results.length })), el('h1', { class: 'mt-0' }, t('times.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openTimeModal(null, athletes, refresh) }, t('times.addTime'))]),
  ]));
  wrap.appendChild(laneWave());

  // Filters
  let athleteFilter = 'all', eventFilter = 'all';
  const filterRow = el('div', { class: 'grid grid-2 mb-16' }, [
    field(t('times.filterAthlete'), selectInput([{ value: 'all', label: t('times.allAthletes') }, ...athletes.map(a => ({ value: a.id, label: fullName(a) }))], 'all', { onchange: (e) => { athleteFilter = e.target.value; draw(); } })),
    field(t('times.filterEvent'), selectInput([{ value: 'all', label: t('times.allEvents') }, ...trOptionsFlat(EVENTS, 'events')], 'all', { onchange: (e) => { eventFilter = e.target.value; draw(); } })),
  ]);
  wrap.appendChild(filterRow);

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function draw() {
    clear(host);
    let filtered = results;
    if (athleteFilter !== 'all') filtered = filtered.filter(r => r.athleteId === athleteFilter);
    if (eventFilter !== 'all') filtered = filtered.filter(r => r.event === eventFilter);

    if (athleteFilter !== 'all' && eventFilter !== 'all') {
      const series = filtered.slice().sort((a, b) => a.date.localeCompare(b.date));
      if (series.length >= 2) {
        const chartCard = el('div', { class: 'card mb-16' }, [el('h3', {}, t('times.progressTitle', { event: trCode(eventFilter, 'events') }))]);
        chartCard.appendChild(svgLineChart({
          points: series.map(r => ({ y: r.time, label: fmtDateShort(r.date) })),
          yFormat: secToTime, invertY: true, color: 'var(--c-chlorine-d)',
        }));
        chartCard.appendChild(el('p', { class: 'text-sm', style: 'margin-top:8px' }, t('times.progressHint')));
        host.appendChild(chartCard);
      }
    }

    if (filtered.length === 0) { host.appendChild(emptyState(t('common.nothingHereTitle'), t('times.noTimes'), null)); return; }

    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('times.colDate')), el('th', {}, t('times.colAthlete')), el('th', {}, t('times.colEvent')), el('th', {}, t('times.colTime')), el('th', {}, t('times.colContext')), el('th', {}, '')])));
    const tbody = el('tbody');
    filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(r => {
      const athlete = athletes.find(a => a.id === r.athleteId);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, fmtDateShort(r.date)), el('td', {}, fullName(athlete)), el('td', {}, trCode(r.event, 'events')),
        el('td', { class: 'data' }, [secToTime(r.time), r.isPB ? ' ' : '', r.isPB ? badge('PB', 'pb') : '']),
        el('td', {}, r.competitionId ? badge(t('times.contextComp'), 'neutral') : badge(t('times.contextTraining'), 'neutral')),
        el('td', {}, [
          el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openTimeModal(r, athletes, refresh) }, t('common.edit')),
          ' ',
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('times.deleteConfirm'), async () => { await remove('results', r.id); toast(t('times.deleted')); refresh(); }) }, t('common.delete')),
        ]),
      ]));
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }
  draw();

  async function refresh() {
    const [a2, r2] = await Promise.all([getAll('athletes'), getAll('results')]);
    clear(container);
    renderView(container, a2, r2);
  }
}

function openTimeModal(result, athletes, onSaved) {
  const isEdit = !!result;
  const data = result ? { ...result } : { athleteId: athletes[0]?.id || '', event: EVENTS[0], time: '', date: todayISO(), course: 'LCM', isPB: false, competitionId: null };
  const form = el('form', { class: 'form-grid' });
  const fAthlete = selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), data.athleteId);
  const fEvent = selectInput(trOptionsFlat(EVENTS, 'events'), data.event);
  const fTime = textInput(data.time ? secToTime(data.time) : '', { placeholder: 'mm:ss.cc', required: true });
  const fDate = el('input', { type: 'date', value: data.date });
  const fCourse = selectInput(trOptions(COURSES, 'courses'), data.course);
  const fPB = el('input', { type: 'checkbox' }); fPB.checked = !!data.isPB;
  form.appendChild(field(t('times.formAthlete'), fAthlete, { span2: true }));
  form.appendChild(field(t('times.formEvent'), fEvent));
  form.appendChild(field(t('times.formTime'), fTime, { hint: t('times.formTimeHint') }));
  form.appendChild(field(t('times.formDate'), fDate));
  form.appendChild(field(t('times.formCourse'), fCourse));
  form.appendChild(field(t('times.formIsPB'), el('div', { class: 'flex items-center gap-8' }, [fPB, el('span', { class: 'text-sm' }, t('times.formIsPBYes'))]), { span2: true }));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, t('common.save')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sec = timeToSec(fTime.value);
    if (!sec || isNaN(sec)) { toast(t('times.validationTime'), 'error'); return; }
    await put('results', { ...data, athleteId: fAthlete.value, event: fEvent.value, time: sec, date: fDate.value, course: fCourse.value, isPB: fPB.checked });
    toast(t('times.saved'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('times.modalEdit') : t('times.modalCreate'), bodyNode: form, wide: true });
}
