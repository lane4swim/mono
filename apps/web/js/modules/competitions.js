// ============================================================
// modules/competitions.js — Wettkampfmanagement (CRUD: Liste, Detail,
// Start-/Ergebnisliste, drei Formular-Modals).
//
// Code-Review, Befund L3: war 675 Zeilen mit drei kaum verwandten
// Zuständigkeiten (CRUD hier; Wettkampfmodus jetzt in
// competitionLive.js; die Stoppuhr-Widgets jetzt in stopwatch.js). Diese
// Datei behält nur noch die Vereinsverwaltung der Wettkämpfe selbst.
// ============================================================
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { fmtDateLong, todayISO, toIsoDateTime } from '../dates.js';
import { secToTime, timeToSec } from '../swimTime.js';
import { fullName, toast, badge, emptyState, laneWave } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { EVENTS, COURSES } from '../refdata.js';
import { navigate } from '../router.js';
import { t, trCode, trOptions, trOptionsFlat } from '../i18n.js';
import { buildLiveGroups, renderLiveMode, buildResultIndex, findResultForEntry } from './competitionLive.js';
import { buildStopwatchPanel } from './stopwatch.js';
import { resultsImportButton } from './resultsImportUI.js';

export const competitionsModule = {
  id: 'competitions',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M6 4h12v4a6 6 0 01-12 0V4z"/><path d="M6 5H3a4 4 0 004 4"/><path d="M18 5h3a4 4 0 01-4 4"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    if (params[0] && params[1] === 'live') {
      return renderLiveMode(container, params[0], parseInt(params[2], 10) || 0);
    }
    const competitions = await getAll('competitions');
    if (!isCurrent()) return;
    if (params[0]) return renderDetail(container, params[0]);
    renderList(container, competitions);
  }
};

function renderList(container, competitions) {
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
    const c2 = await getAll('competitions');
    clear(container);
    renderList(container, c2);
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
  // Ineffizienz-Korrektur: EINMAL je Render aufgebaut statt einmal je
  // Tabellenzeile linear gesucht. Beide Tabellen dieser Seite
  // (Ergebnisliste und Startliste) haben je Zeile eine Athlet:innen-
  // Zuordnung, die Startliste zusätzlich eine Ergebnis-Zuordnung über den
  // GESAMTEN, über Jahre wachsenden Ergebnisbestand des Vereins (siehe
  // buildResultIndex() in competitionLive.js) — das Rendern einer
  // Wettkampfseite war damit quadratisch in der Zahl der Startplätze.
  const athleteById = new Map(athletes.map(a => [a.id, a]));
  const resultIndex = buildResultIndex(results);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('competitions') }, t('competitions.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, fmtDateLong(comp.date)), el('h1', { class: 'mt-0' }, comp.name)]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-primary', onclick: () => navigate('competitions', compId, 'live', '0') }, t('competitions.liveModeStart')),
      el('button', { class: 'btn btn-ghost', onclick: () => openCompModal(comp, refreshDetail) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('competitions.deleteCompConfirm'), async () => { await remove('competitions', compId); for (const r of compResults) await remove('results', r.id); for (const en of compEntries) await remove('entries', en.id); toast(t('competitions.deleted')); navigate('competitions'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, `${comp.location || t('competitions.unknownLocation')} · ${trCode(comp.course, 'courses')}${comp.notes ? ' · ' + comp.notes : ''}`));

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('competitions.resultsTitle')),
      el('div', { class: 'flex gap-8' }, [
        resultsImportButton(comp, refreshDetail),
        el('button', { class: 'btn btn-accent btn-sm', onclick: () => openResultModal(null, comp, athletes, refreshDetail) }, t('competitions.addResult')),
      ]),
    ]),
  ]);
  if (compResults.length === 0) card.appendChild(el('p', {}, t('competitions.noResults')));
  else {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('competitions.colAthlete')), el('th', {}, t('competitions.colEvent')), el('th', {}, t('competitions.colTime')), el('th', {}, t('competitions.colPlace')), el('th', {}, t('competitions.colPB')), el('th', {}, '')])));
    const tbody = el('tbody');
    compResults.sort((a, b) => a.event.localeCompare(b.event)).forEach(r => {
      const athlete = athleteById.get(r.athleteId);
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
    // Maps an entry to its position in the Wettkampfmodus sequence, so each
    // row can link straight into that heat — the start list itself groups
    // rows by Lauf-Nummer only (see groupByHeat), which can bundle several
    // Wettkampfnummern under the same "Lauf N" heading, so this needs to be
    // resolved per entry (eventNumber+heat), not per heading.
    const liveGroups = buildLiveGroups(compEntries);
    const liveIndexByKey = new Map(liveGroups.map((g, i) => [`${g.eventNumber}__${g.heat}`, i]));

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
        const liveIndex = liveIndexByKey.get(`${entry.eventNumber}__${entry.heat}`);
        appendEntryRows(tbody, entry, comp, athletes, athleteById, results, resultIndex, refreshDetail, liveIndex);
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

// Appends two <tr> per start-list entry: the main row (lane/number/athlete/
// event/seed time/quick result capture), and a companion, initially hidden
// row holding an inline stopwatch panel with lap ("Runde") splits — toggled
// via the ⏱ button. Recorded laps are documented alongside the result
// (results.laps) once "Zeit übernehmen" is used and the row is saved, so a
// captured time immediately shows up in Times & Statistics as before, now
// optionally with its splits. `liveIndex` (from renderDetail's
// liveIndexByKey lookup) is the entry's position in the Wettkampfmodus
// sequence, undefined if it's missing eventNumber/heat and therefore isn't
// part of that sequence at all (see buildLiveGroups in competitionLive.js).
// `athletes` (das volle Array) wird weiterhin durchgereicht, weil die
// Modale unten (openEntryModal/openItemModal) eine Auswahlliste über ALLE
// Athlet:innen brauchen; `athleteById`/`resultIndex` bedienen nur die
// Zuordnung dieser einen Zeile (siehe renderDetail oben).
function appendEntryRows(tbody, entry, comp, athletes, athleteById, results, resultIndex, onChanged, liveIndex) {
  const athlete = athleteById.get(entry.athleteId);
  const existingResult = findResultForEntry(resultIndex, entry);
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

  const liveModeLink = liveIndex != null
    ? el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', title: t('competitions.liveModeStart'),
        onclick: () => navigate('competitions', comp.id, 'live', String(liveIndex)),
      }, '▶ ' + t('competitions.liveModeShort'))
    : null;

  const mainRow = el('tr', {}, [
    el('td', { class: 'data' }, entry.lane != null ? String(entry.lane) : '—'),
    el('td', { class: 'data' }, entry.eventNumber || '—'),
    el('td', {}, fullName(athlete)),
    el('td', {}, trCode(entry.event, 'events')),
    el('td', { class: 'data' }, entry.seedTime ? secToTime(entry.seedTime) : '—'),
    el('td', {}, [timeInput, ' ', saveBtn, existingResult?.isPB ? ' ' : null, existingResult?.isPB ? badge('PB', 'pb') : null, recordedLaps.length > 0 ? ' ' : null, recordedLaps.length > 0 ? badge(t('competitions.stopwatchLapCount', { count: recordedLaps.length }), 'neutral') : null]),
    el('td', {}, placeInput),
    el('td', {}, [
      liveModeLink, liveModeLink ? ' ' : null,
      stopwatchBtn, ' ',
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openEntryModal(entry, comp, athletes, onChanged) }, t('common.edit')),
      ' ',
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('competitions.entryDeleteConfirm'), async () => { await remove('entries', entry.id); toast(t('competitions.entryRemoved')); onChanged(); }) }, t('common.remove')),
    ]),
  ]);

  tbody.appendChild(mainRow);
  tbody.appendChild(detailRow);
}

function openCompModal(comp, onSaved) {
  const isEdit = !!comp;
  const data = comp ? { ...comp } : { name: '', date: todayISO(), location: '', course: 'LCM', notes: '' };
  const form = el('form', { class: 'form-grid' });
  const fName = textInput(data.name, { required: true });
  const fDate = dateInput(data.date);
  const fLoc = textInput(data.location);
  const fCourse = selectInput(trOptions(COURSES, 'courses'), data.course);
  const fNotes = el('textarea', {}, data.notes || '');
  form.appendChild(field(t('competitions.formName'), fName, { span2: true }));
  form.appendChild(field(t('competitions.formDate'), fDate));
  form.appendChild(field(t('competitions.formCourse'), fCourse));
  form.appendChild(field(t('competitions.formLocation'), fLoc, { span2: true }));
  form.appendChild(field(t('competitions.formNotes'), fNotes, { span2: true }));
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) { toast(t('competitions.validationName'), 'error'); return; }
    await put('competitions', { ...data, name: fName.value.trim(), date: toIsoDateTime(fDate.value), location: fLoc.value.trim(), course: fCourse.value, notes: fNotes.value.trim() });
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
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') }).row);
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
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: t('common.save') }).row);
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
