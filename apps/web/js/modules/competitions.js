// ============================================================
// modules/competitions.js — Wettkampfmanagement
// ============================================================
import { getAll, put, remove } from '../db.js';
import {
  el, clear, fullName, fmtDateLong, todayISO, field, textInput, selectInput,
  openModal, confirmAction, toast, badge, emptyState, laneWave, secToTime, timeToSec,
} from '../utils.js';
import { EVENTS, COURSES } from '../refdata.js';
import { navigate } from '../router.js';
import { getRole } from '../state.js';
import { t, trCode, trOptions, trOptionsFlat } from '../i18n.js';
import { beginRender } from '../utils.js';

export const competitionsModule = {
  id: 'competitions',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M6 4h12v4a6 6 0 01-12 0V4z"/><path d="M6 5H3a4 4 0 004 4"/><path d="M18 5h3a4 4 0 01-4 4"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    const [competitions, athletes] = await Promise.all([getAll('competitions'), getAll('athletes')]);
    if (!isCurrent()) return;
    if (params[0]) return renderDetail(container, params[0]);
    renderList(container, competitions, athletes);
  }
};

function renderList(container, competitions, athletes) {
  const today = todayISO();
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('competitions.eyebrow', { count: competitions.length })), el('h1', { class: 'mt-0' }, t('competitions.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openCompModal(null, () => refresh()) }, t('competitions.addComp'))]),
  ]));
  wrap.appendChild(laneWave());

  const upcoming = competitions.filter(c => c.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = competitions.filter(c => c.date < today).sort((a, b) => b.date.localeCompare(a.date));

  wrap.appendChild(el('h3', {}, t('competitions.upcoming')));
  wrap.appendChild(renderCompTable(upcoming, t('competitions.noUpcoming')));
  wrap.appendChild(el('h3', { style: 'margin-top:26px' }, t('competitions.past')));
  wrap.appendChild(renderCompTable(past, t('competitions.noPast')));

  container.appendChild(wrap);

  async function refresh() {
    const [c2, a2] = await Promise.all([getAll('competitions'), getAll('athletes')]);
    clear(container);
    renderList(container, c2, a2);
  }
}

function renderCompTable(list, emptyMsg) {
  if (list.length === 0) return emptyState(t('common.nothingHereTitle'), emptyMsg, null);
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('competitions.colName')), el('th', {}, t('competitions.colDate')), el('th', {}, t('competitions.colLocation')), el('th', {}, t('competitions.colCourse')), el('th', {}, '')])));
  const tbody = el('tbody');
  list.forEach(c => tbody.appendChild(el('tr', { class: 'row-click', onclick: () => navigate('competitions', c.id) }, [
    el('td', {}, c.name), el('td', {}, fmtDateLong(c.date)), el('td', {}, c.location || '—'),
    el('td', {}, badge(trCode(c.course, 'courses'), 'neutral')),
    el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); navigate('competitions', c.id); } }, t('common.open'))),
  ])));
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap card' }, table);
}

async function renderDetail(container, compId) {
  const [competitions, athletes, results, entries] = await Promise.all([getAll('competitions'), getAll('athletes'), getAll('results'), getAll('entries')]);
  const comp = competitions.find(c => c.id === compId);
  if (!comp) { container.appendChild(emptyState(t('common.notFoundTitle'), t('competitions.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('competitions') }, t('common.back')))); return; }
  const compResults = results.filter(r => r.competitionId === compId);
  const compEntries = entries.filter(e => e.competitionId === compId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('competitions') }, t('competitions.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, fmtDateLong(comp.date)), el('h1', { class: 'mt-0' }, comp.name)]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openCompModal(comp, () => renderDetail(container, compId) & clear(container)) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('competitions.deleteCompConfirm'), async () => { await remove('competitions', compId); for (const r of compResults) await remove('results', r.id); for (const en of compEntries) await remove('entries', en.id); toast(t('competitions.deleted')); navigate('competitions'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, `${comp.location || t('competitions.unknownLocation')} · ${trCode(comp.course, 'courses')}${comp.notes ? ' · ' + comp.notes : ''}`));

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('competitions.resultsTitle')),
      el('button', { class: 'btn btn-accent btn-sm', onclick: () => openResultModal(null, comp, athletes, refreshDetail) }, t('competitions.addResult')),
    ]),
  ]);
  if (compResults.length === 0) card.appendChild(el('p', {}, t('competitions.noResults')));
  else {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('competitions.colAthlete')), el('th', {}, t('competitions.colEvent')), el('th', {}, t('competitions.colTime')), el('th', {}, t('competitions.colPlace')), el('th', {}, t('competitions.colPB')), el('th', {}, '')])));
    const tbody = el('tbody');
    compResults.sort((a, b) => a.event.localeCompare(b.event)).forEach(r => {
      const athlete = athletes.find(a => a.id === r.athleteId);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, fullName(athlete)), el('td', {}, trCode(r.event, 'events')), el('td', { class: 'data' }, secToTime(r.time)),
        el('td', {}, r.place ? `${r.place}.` : '—'), el('td', {}, [r.isPB ? badge('PB', 'pb') : null, r.laps?.length > 0 ? ' ' : null, r.laps?.length > 0 ? badge(t('competitions.stopwatchLapCount', { count: r.laps.length }), 'neutral') : null].filter(Boolean)),
        el('td', {}, el('button', { class: 'btn btn-danger btn-sm', onclick: async () => { await remove('results', r.id); toast(t('competitions.deleteResultDone')); refreshDetail(); } }, t('common.remove'))),
      ]));
    });
    table.appendChild(tbody);
    card.appendChild(el('div', { class: 'table-wrap' }, table));
  }
  wrap.appendChild(card);

  const startListCard = el('div', { class: 'card' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('competitions.startListTitle')),
      el('button', { class: 'btn btn-accent btn-sm', onclick: () => openEntryModal(null, comp, athletes, refreshDetail) }, t('competitions.addEntry')),
    ]),
  ]);
  if (compEntries.length === 0) {
    startListCard.appendChild(el('p', {}, t('competitions.noEntries')));
  } else {
    const groups = groupByHeat(compEntries);
    const heatKeys = Object.keys(groups).sort((a, b) => a === '__none__' ? 1 : b === '__none__' ? -1 : Number(a) - Number(b));
    heatKeys.forEach(key => {
      startListCard.appendChild(el('h4', { style: 'margin:18px 0 8px' }, key === '__none__' ? t('competitions.noHeatAssigned') : t('competitions.heatLabel', { n: key })));
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, t('competitions.colLane')), el('th', {}, t('competitions.colNumber')), el('th', {}, t('competitions.colAthlete')), el('th', {}, t('competitions.colEvent')),
        el('th', {}, t('competitions.colSeed')), el('th', {}, t('competitions.colResultTime')), el('th', {}, t('competitions.placeHeader')), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      groups[key].sort((a, b) => (a.lane ?? 99) - (b.lane ?? 99)).forEach(entry => {
        appendEntryRows(tbody, entry, comp, athletes, results, refreshDetail);
      });
      table.appendChild(tbody);
      startListCard.appendChild(el('div', { class: 'table-wrap mb-8' }, table));
    });
  }
  wrap.appendChild(startListCard);

  container.appendChild(wrap);

  async function refreshDetail() { clear(container); renderDetail(container, compId); }
}

function groupByHeat(entries) {
  const groups = {};
  entries.forEach(e => {
    const key = e.heat != null && e.heat !== '' ? String(e.heat) : '__none__';
    (groups[key] ||= []).push(e);
  });
  return groups;
}

function findResultForEntry(results, entry) {
  return results.find(r => r.competitionId === entry.competitionId && r.athleteId === entry.athleteId && r.event === entry.event) || null;
}

// Appends two <tr> per start-list entry: the main row (lane/number/athlete/
// event/seed time/quick result capture), and a companion, initially hidden
// row holding an inline stopwatch panel with lap ("Runde") splits — toggled
// via the ⏱ button. Recorded laps are documented alongside the result
// (results.laps) once "Zeit übernehmen" is used and the row is saved, so a
// captured time immediately shows up in Times & Statistics as before, now
// optionally with its splits.
function appendEntryRows(tbody, entry, comp, athletes, results, onChanged) {
  const athlete = athletes.find(a => a.id === entry.athleteId);
  const existingResult = findResultForEntry(results, entry);
  let recordedLaps = existingResult?.laps ? [...existingResult.laps] : [];

  const timeInput = textInput(existingResult ? secToTime(existingResult.time) : '', { placeholder: 'mm:ss.cc', style: 'width:100px' });
  const saveBtn = el('button', { class: 'btn btn-accent btn-sm', title: t('competitions.quickSaveTitle'), onclick: async () => {
    const sec = timeToSec(timeInput.value);
    if (!sec || isNaN(sec)) { toast(t('competitions.validationTime'), 'error'); return; }
    const others = results.filter(r => r.athleteId === entry.athleteId && r.event === entry.event && r.id !== existingResult?.id);
    const isPB = others.length === 0 || others.every(r => sec < r.time);
    await put('results', {
      ...(existingResult || {}), athleteId: entry.athleteId, event: entry.event, time: sec,
      date: comp.date, course: comp.course, competitionId: comp.id, isPB,
      place: existingResult?.place ?? null,
      laps: recordedLaps.length > 0 ? recordedLaps : undefined,
    });
    toast(isPB ? t('competitions.resultSavedPB') : t('competitions.resultSaved'));
    onChanged();
  } });
  timeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } });

  const placeInput = el('input', {
    type: 'number', min: '1', value: existingResult?.place ?? '', style: 'width:56px', title: t('competitions.placeHeader'),
    onchange: async (e) => {
      if (!existingResult) { toast(t('competitions.placeNeedsTimeFirst'), 'error'); e.target.value = ''; return; }
      await put('results', { ...existingResult, place: e.target.value ? parseInt(e.target.value) : null });
      onChanged();
    },
  });

  const detailRow = el('tr', { hidden: true });
  const detailTd = el('td', { colspan: '8' });
  detailRow.appendChild(detailTd);
  buildStopwatchPanel(detailTd, {
    initialLaps: recordedLaps,
    onApply: (totalSeconds, laps) => {
      timeInput.value = secToTime(totalSeconds);
      recordedLaps = laps.slice();
      toast(t('competitions.stopwatchApplied'));
    },
  });

  const stopwatchBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', title: t('competitions.stopwatchToggle'),
    onclick: () => { detailRow.hidden = !detailRow.hidden; },
  }, '⏱ ' + t('competitions.stopwatchToggle'));

  const mainRow = el('tr', {}, [
    el('td', { class: 'data' }, entry.lane != null ? String(entry.lane) : '—'),
    el('td', { class: 'data' }, entry.eventNumber || '—'),
    el('td', {}, fullName(athlete)),
    el('td', {}, trCode(entry.event, 'events')),
    el('td', { class: 'data' }, entry.seedTime ? secToTime(entry.seedTime) : '—'),
    el('td', {}, [timeInput, ' ', saveBtn, existingResult?.isPB ? ' ' : null, existingResult?.isPB ? badge('PB', 'pb') : null, recordedLaps.length > 0 ? ' ' : null, recordedLaps.length > 0 ? badge(t('competitions.stopwatchLapCount', { count: recordedLaps.length }), 'neutral') : null]),
    el('td', {}, placeInput),
    el('td', {}, [
      stopwatchBtn, ' ',
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openEntryModal(entry, comp, athletes, onChanged) }, t('common.edit')),
      ' ',
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('competitions.entryDeleteConfirm'), async () => { await remove('entries', entry.id); toast(t('competitions.entryRemoved')); onChanged(); }) }, t('common.remove')),
    ]),
  ]);

  tbody.appendChild(mainRow);
  tbody.appendChild(detailRow);
}

// Self-contained stopwatch widget: Start / Runde (lap) / Stopp / Zurücksetzen,
// live-updating elapsed-time display, and a table of recorded lap splits.
// `initialLaps` (seconds, cumulative) lets a previously documented set of
// splits be shown when the panel is reopened, without starting a new run.
// `onApply(totalSeconds, laps)` is called when "Zeit übernehmen" is clicked.
function buildStopwatchPanel(container, { initialLaps = [], onApply }) {
  let running = false;
  let startTs = null;
  let laps = [...initialLaps];
  let intervalId = null;

  const display = el('div', { class: 'data', style: 'font-size:1.7rem;font-weight:700;margin-bottom:10px' }, secToTime(laps.length ? laps[laps.length - 1] : 0));
  const lapsHost = el('div');

  const startBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, t('competitions.stopwatchStart'));
  const lapBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: true }, t('competitions.stopwatchLap'));
  const stopBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', disabled: true }, t('competitions.stopwatchStop'));
  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, t('competitions.stopwatchReset'));
  const applyBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm', disabled: laps.length === 0 }, t('competitions.stopwatchApply'));

  function currentElapsed() {
    if (running) return (performance.now() - startTs) / 1000;
    return laps.length ? laps[laps.length - 1] : 0;
  }
  function updateDisplay() { display.textContent = secToTime(currentElapsed()); }

  function drawLaps() {
    clear(lapsHost);
    if (laps.length === 0) { lapsHost.appendChild(el('p', { class: 'hint' }, t('competitions.stopwatchNoLaps'))); return; }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('competitions.stopwatchLapNr')), el('th', {}, t('competitions.stopwatchLapSplit')), el('th', {}, t('competitions.stopwatchLapTotal')),
    ])));
    const tbody = el('tbody');
    laps.forEach((cum, i) => {
      const prev = i === 0 ? 0 : laps[i - 1];
      tbody.appendChild(el('tr', {}, [el('td', {}, String(i + 1)), el('td', { class: 'data' }, secToTime(cum - prev)), el('td', { class: 'data' }, secToTime(cum))]));
    });
    table.appendChild(tbody);
    lapsHost.appendChild(el('div', { class: 'table-wrap' }, table));
  }

  startBtn.addEventListener('click', () => {
    running = true; startTs = performance.now(); laps = [];
    startBtn.disabled = true; lapBtn.disabled = false; stopBtn.disabled = false; applyBtn.disabled = true;
    drawLaps(); updateDisplay();
    intervalId = setInterval(updateDisplay, 30);
  });
  lapBtn.addEventListener('click', () => {
    if (!running) return;
    laps.push(currentElapsed());
    drawLaps();
  });
  stopBtn.addEventListener('click', () => {
    if (!running) return;
    const final = currentElapsed();
    if (laps.length === 0 || Math.abs(laps[laps.length - 1] - final) > 0.01) laps.push(final);
    running = false;
    clearInterval(intervalId);
    startBtn.disabled = false; lapBtn.disabled = true; stopBtn.disabled = true; applyBtn.disabled = false;
    updateDisplay(); drawLaps();
  });
  resetBtn.addEventListener('click', () => {
    running = false; clearInterval(intervalId); laps = []; startTs = null;
    startBtn.disabled = false; lapBtn.disabled = true; stopBtn.disabled = true; applyBtn.disabled = true;
    updateDisplay(); drawLaps();
  });
  applyBtn.addEventListener('click', () => { onApply(currentElapsed(), laps); });

  container.appendChild(el('div', { style: 'padding:12px 4px' }, [
    display,
    el('div', { class: 'flex gap-8 mb-8', style: 'flex-wrap:wrap' }, [startBtn, lapBtn, stopBtn, resetBtn, applyBtn]),
    lapsHost,
  ]));
  drawLaps();
}

function openCompModal(comp, onSaved) {
  const isEdit = !!comp;
  const data = comp ? { ...comp } : { name: '', date: todayISO(), location: '', course: 'LCM', notes: '' };
  const form = el('form', { class: 'form-grid' });
  const fName = textInput(data.name, { required: true });
  const fDate = el('input', { type: 'date', value: data.date });
  const fLoc = textInput(data.location);
  const fCourse = selectInput(trOptions(COURSES, 'courses'), data.course);
  const fNotes = el('textarea', {}, data.notes || '');
  form.appendChild(field(t('competitions.formName'), fName, { span2: true }));
  form.appendChild(field(t('competitions.formDate'), fDate));
  form.appendChild(field(t('competitions.formCourse'), fCourse));
  form.appendChild(field(t('competitions.formLocation'), fLoc, { span2: true }));
  form.appendChild(field(t('competitions.formNotes'), fNotes, { span2: true }));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('competitions.validationName'), 'error'); return; }
    await put('competitions', { ...data, name: fName.value.trim(), date: fDate.value, location: fLoc.value.trim(), course: fCourse.value, notes: fNotes.value.trim() });
    toast(isEdit ? t('competitions.savedEdit') : t('competitions.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('competitions.modalEditTitle') : t('competitions.modalCreateTitle'), bodyNode: form, wide: true });
}

function openEntryModal(entry, comp, athletes, onSaved) {
  const isEdit = !!entry;
  const data = entry ? { ...entry } : { competitionId: comp.id, athleteId: athletes[0]?.id || '', event: EVENTS[0], eventNumber: '', heat: '', lane: '', seedTime: null };
  const form = el('form', { class: 'form-grid' });
  const fAthlete = selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), data.athleteId);
  const fEvent = selectInput(trOptionsFlat(EVENTS, 'events'), data.event);
  const fNr = textInput(data.eventNumber || '', { placeholder: 'e.g. 12' });
  const fHeat = el('input', { type: 'number', min: '1', value: data.heat ?? '', placeholder: 'e.g. 3' });
  const fLane = el('input', { type: 'number', min: '1', max: '10', value: data.lane ?? '', placeholder: 'e.g. 4' });
  const fSeed = textInput(data.seedTime ? secToTime(data.seedTime) : '', { placeholder: 'mm:ss.cc' });
  form.appendChild(field(t('competitions.colAthlete'), fAthlete, { span2: true }));
  form.appendChild(field(t('competitions.colEvent'), fEvent));
  form.appendChild(field(t('competitions.formEventNumber'), fNr, { hint: t('competitions.formEventNumberHint') }));
  form.appendChild(field(t('competitions.formHeat'), fHeat));
  form.appendChild(field(t('competitions.formLane'), fLane));
  form.appendChild(field(t('competitions.formSeedTime'), fSeed, { hint: t('competitions.formSeedTimeHint') }));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seedSec = fSeed.value.trim() ? timeToSec(fSeed.value) : null;
    if (fSeed.value.trim() && (!seedSec || isNaN(seedSec))) { toast(t('competitions.validationSeedTime'), 'error'); return; }
    await put('entries', {
      ...data, competitionId: comp.id, athleteId: fAthlete.value, event: fEvent.value,
      eventNumber: fNr.value.trim(), heat: fHeat.value ? parseInt(fHeat.value) : null,
      lane: fLane.value ? parseInt(fLane.value) : null, seedTime: seedSec,
    });
    toast(isEdit ? t('competitions.entrySavedEdit') : t('competitions.entrySaved'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('competitions.entryModalEdit') : t('competitions.entryModalCreate'), bodyNode: form, wide: true });
}

function openResultModal(result, comp, athletes, onSaved) {
  const isEdit = !!result;
  const data = result ? { ...result } : { athleteId: athletes[0]?.id || '', event: EVENTS[0], time: '', place: '', isPB: false, date: comp.date, competitionId: comp.id, course: comp.course };
  const form = el('form', { class: 'form-grid' });
  const fAthlete = selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), data.athleteId);
  const fEvent = selectInput(trOptionsFlat(EVENTS, 'events'), data.event);
  const fTime = textInput(data.time ? secToTime(data.time) : '', { placeholder: 'mm:ss.cc', required: true });
  const fPlace = el('input', { type: 'number', min: '1', value: data.place || '' });
  const fPB = el('input', { type: 'checkbox' }); fPB.checked = !!data.isPB;
  form.appendChild(field(t('competitions.colAthlete'), fAthlete, { span2: true }));
  form.appendChild(field(t('competitions.colEvent'), fEvent));
  form.appendChild(field(t('competitions.formTime'), fTime, { hint: t('competitions.formTimeHint') }));
  form.appendChild(field(t('competitions.formPlace'), fPlace));
  form.appendChild(field(t('competitions.formIsPB'), el('div', { class: 'flex items-center gap-8' }, [fPB, el('span', { class: 'text-sm' }, t('competitions.formIsPBYes'))])));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, t('common.save')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sec = timeToSec(fTime.value);
    if (!sec || isNaN(sec)) { toast(t('competitions.validationTime'), 'error'); return; }
    await put('results', { ...data, athleteId: fAthlete.value, event: fEvent.value, time: sec, place: fPlace.value ? parseInt(fPlace.value) : null, isPB: fPB.checked });
    toast(t('competitions.resultSaved'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('competitions.resultModalEdit') : t('competitions.resultModalCreate'), bodyNode: form, wide: true });
}
