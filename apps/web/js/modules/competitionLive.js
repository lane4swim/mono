// ============================================================
// modules/competitionLive.js — Wettkampfmodus ("live mode").
//
// Code-Review, Befund L3: extracted out of competitions.js (was 675
// lines mixing three unrelated features — CRUD, this live timekeeping
// flow, and three form modals). A dedicated, full-screen timekeeping flow
// for running an actual meet: starts at the first seeded event/heat
// (lowest Wettkampfnummer, then lowest Lauf), shows one shared stopwatch
// for the whole heat plus one capture card per athlete in that heat, and
// a button to advance to the next event/heat. Position is encoded in the
// URL (params[2]) rather than kept in a JS closure, consistent with the
// rest of this app's hash-router-driven state — reloading/bookmarking
// mid-meet resumes at the same heat instead of losing progress.
//
// No logic change from the extraction itself — this is the same code
// that lived in competitions.js, split along the seam the original review
// already described. modules/competitions.js imports buildLiveGroups()
// from here for its start-list "jump into live mode" links, since that
// grouping is exactly the running order this module renders.
// ============================================================
import { getAll, put } from '../db.js';
import { el, clear } from '../dom.js';
import { secToTime } from '../swimTime.js';
import { fullName, badge, emptyState, laneWave, toast } from '../ui.js';
import { navigate } from '../router.js';
import { t, trCode } from '../i18n.js';
import { openItemModal, fetchAssignableTrainers } from './actionItems.js';
import { buildSharedStopwatch } from './stopwatch.js';

// Exportiert für competitions.js: appendEntryRows() (Startliste, CRUD)
// braucht dieselbe Zuordnung "Startlisteneintrag -> bereits vorhandenes
// Ergebnis" wie buildAthleteCard() hier. Lebt hier statt dort, damit der
// Importpfad einseitig bleibt (competitions.js -> competitionLive.js, wie
// bei buildLiveGroups()/renderLiveMode() unten) statt einen Zyklus
// zwischen beiden Dateien zu erzeugen.
//
// Ineffizienz-Korrektur: war vormals ein `results.find(...)`, das BEIDE
// Aufrufer je Startlisteneintrag erneut über den KOMPLETTEN Ergebnisbestand
// des Vereins laufen ließen (Startliste: einmal je Zeile; Wettkampfmodus:
// einmal je Bahn). `results` umfasst alle je erfassten Zeiten — es wächst
// über Jahre, während die Startliste eines Wettkampfs mehrere hundert
// Einträge haben kann; das Rendern einer Wettkampfdetailseite war damit
// quadratisch (Einträge × Ergebnisse). Der Index wird jetzt EINMAL je
// Render aufgebaut und danach je Eintrag in konstanter Zeit abgefragt.
const resultKey = (competitionId, athleteId, event) => `${competitionId}\u0000${athleteId}\u0000${event}`;

export function buildResultIndex(results) {
  const index = new Map();
  for (const r of results) {
    const key = resultKey(r.competitionId, r.athleteId, r.event);
    // Erster Treffer gewinnt — identisch zum vorherigen Array.find().
    if (!index.has(key)) index.set(key, r);
  }
  return index;
}

export function findResultForEntry(resultIndex, entry) {
  return resultIndex.get(resultKey(entry.competitionId, entry.athleteId, entry.event)) || null;
}

// Groups a competition's start-list entries by (Wettkampfnummer, Lauf) and
// sorts the groups in running order. Entries missing either value can't be
// placed unambiguously in that order and are excluded (see renderLiveMode's
// empty state) — Wettkampfnummer is free text (per the start-list form), so
// numeric values sort numerically and any non-numeric ones sort after,
// alphabetically, rather than silently coercing to NaN/0.
export function buildLiveGroups(compEntries) {
  const map = new Map();
  compEntries.forEach(e => {
    if (!e.eventNumber || e.heat == null || e.heat === '') return;
    const key = `${e.eventNumber}__${e.heat}`;
    if (!map.has(key)) map.set(key, { eventNumber: e.eventNumber, heat: e.heat, event: e.event, entries: [] });
    map.get(key).entries.push(e);
  });
  const groups = [...map.values()];
  groups.forEach(g => g.entries.sort((a, b) => (a.lane ?? 99) - (b.lane ?? 99)));
  groups.sort((a, b) => {
    const an = parseFloat(a.eventNumber), bn = parseFloat(b.eventNumber);
    const aNum = isNaN(an) ? Infinity : an, bNum = isNaN(bn) ? Infinity : bn;
    if (aNum !== bNum) return aNum - bNum;
    if (aNum === Infinity) { const c = String(a.eventNumber).localeCompare(String(b.eventNumber)); if (c) return c; }
    return (a.heat ?? 0) - (b.heat ?? 0);
  });
  return groups;
}

export async function renderLiveMode(container, compId, groupIndex) {
  const [competitions, athletes, entries, results, trainers] = await Promise.all([
    getAll('competitions'), getAll('athletes'), getAll('entries'), getAll('results'), fetchAssignableTrainers(),
  ]);
  const comp = competitions.find(c => c.id === compId);
  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('competitions', compId) }, t('competitions.backToComp')));

  if (!comp) {
    wrap.appendChild(emptyState(t('common.notFoundTitle'), t('competitions.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('competitions') }, t('common.back'))));
    container.appendChild(wrap);
    return;
  }

  const compEntries = entries.filter(e => e.competitionId === compId);
  const groups = buildLiveGroups(compEntries);

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, comp.name), el('h1', { class: 'mt-0' }, t('competitions.liveModeTitle'))]),
  ]));
  wrap.appendChild(laneWave());

  if (groups.length === 0) {
    wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('competitions.liveModeNoEntries'), null));
    container.appendChild(wrap);
    return;
  }

  const idx = Math.min(Math.max(groupIndex, 0), groups.length - 1);
  const group = groups[idx];
  const isLast = idx >= groups.length - 1;

  const headerCard = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center', style: 'flex-wrap:wrap;gap:12px' }, [
      el('div', {}, [
        el('div', { class: 'page-eyebrow' }, t('competitions.liveModePosition', { current: idx + 1, total: groups.length })),
        el('h2', { class: 'mt-0', style: 'margin-bottom:0' }, t('competitions.liveModeHeatTitle', { nr: group.eventNumber, event: trCode(group.event, 'events'), heat: group.heat })),
      ]),
      isLast
        ? badge(t('competitions.liveModeLastHeat'), 'done')
        : el('button', { class: 'btn btn-primary', onclick: () => navigate('competitions', compId, 'live', String(idx + 1)) }, t('competitions.liveModeNext')),
    ]),
  ]);
  wrap.appendChild(headerCard);

  const timerCard = el('div', { class: 'card mb-16' });
  wrap.appendChild(timerCard);
  const sharedClock = buildSharedStopwatch(timerCard);

  const cardsGrid = el('div', { class: 'grid grid-3' });
  const resultIndex = buildResultIndex(results);
  group.entries.forEach(entry => cardsGrid.appendChild(buildAthleteCard(entry, comp, athletes, results, resultIndex, sharedClock, trainers)));
  wrap.appendChild(cardsGrid);

  container.appendChild(wrap);
}

// Code-Review, Befund L6: buildAthleteCard() mischte DOM-Aufbau und
// Ereignislogik (u. a. das Persistieren des Ergebnisses samt PB-Ermittlung
// direkt im "Ziel"-Klick-Handler). saveHeatResult() unten trägt jetzt
// genau diese Persistenz-/Geschäftslogik — eine reine Datenoperation ohne
// DOM-Bezug — separat, sodass der onclick-Handler in buildAthleteCard nur
// noch orchestriert (aufrufen, dann die UI entsprechend aktualisieren).
//
// Ermittelt beim Speichern eines Zieleinlaufs, ob die Zeit eine neue
// persönliche Bestzeit ist (kein bisheriges Ergebnis für dieselbe Person +
// Disziplin, oder schneller als alle bisherigen), und persistiert das
// Ergebnis. `savedResult` ist der ggf. bereits vorhandene Datensatz dieser
// Karte (wird dann aktualisiert statt dupliziert).
async function saveHeatResult(entry, comp, allResults, savedResult, laps, finalTime) {
  const others = allResults.filter(r => r.athleteId === entry.athleteId && r.event === entry.event && r.id !== savedResult?.id);
  const isPB = others.length === 0 || others.every(r => finalTime < r.time);
  const saved = await put('results', {
    ...(savedResult || {}), athleteId: entry.athleteId, event: entry.event, time: finalTime,
    date: comp.date, course: comp.course, competitionId: comp.id, isPB,
    place: savedResult?.place ?? null, laps: laps.slice(),
  });
  return { saved, isPB };
}

// One card per athlete in the current heat: shows lane/name/seed time,
// captured lap splits, the finish time once set, a "Runde" (lap) button
// that only records a split, a "Ziel" (finish) button that records the
// final time AND persists the result immediately (no separate "Speichern"
// step — during a live heat there's no time to remember one), a small
// reset for mis-clicks, and a shortcut to log a Handlungsfeld for that
// athlete without leaving the screen.
function buildAthleteCard(entry, comp, athletes, allResults, resultIndex, sharedClock, trainers) {
  const athlete = athletes.find(a => a.id === entry.athleteId);
  // Mutable, not the initial findResultForEntry() snapshot: reassigned to
  // the freshly saved record after each "Ziel" press so a later save (e.g.
  // after a mis-click + Zurücksetzen) UPDATEs that same row instead of
  // creating a duplicate result, and so "Zurücksetzen" reverts to the
  // actually-persisted state rather than the pre-render one.
  let savedResult = findResultForEntry(resultIndex, entry);
  let laps = savedResult?.laps ? [...savedResult.laps] : [];
  let done = savedResult?.time != null;

  const timeDisplay = el('span', { class: 'data', style: 'font-size:1.3rem;font-weight:700' }, done ? secToTime(savedResult.time) : '—');
  const pbHost = el('span');
  const lapsHost = el('div', { class: 'flex gap-6', style: 'flex-wrap:wrap;margin:10px 0;min-height:24px' });

  function drawLaps() {
    clear(lapsHost);
    if (laps.length === 0) { lapsHost.appendChild(el('span', { class: 'hint' }, t('competitions.stopwatchNoLaps'))); return; }
    laps.forEach((cum, i) => lapsHost.appendChild(badge(`${i + 1}. ${secToTime(cum)}`, 'neutral')));
  }
  drawLaps();
  if (savedResult?.isPB) pbHost.appendChild(badge('PB', 'pb'));

  function upsertLocal(saved) {
    const i = allResults.findIndex(r => r.id === saved.id);
    if (i >= 0) allResults[i] = saved; else allResults.push(saved);
  }

  const lapBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    laps.push(sharedClock.elapsed());
    drawLaps();
  } }, t('competitions.stopwatchLap'));

  const finishBtn = el('button', { type: 'button', class: 'btn btn-accent btn-sm', onclick: async () => {
    const finalTime = sharedClock.elapsed();
    if (laps.length === 0 || Math.abs(laps[laps.length - 1] - finalTime) > 0.01) laps.push(finalTime);
    const { saved, isPB } = await saveHeatResult(entry, comp, allResults, savedResult, laps, finalTime);
    upsertLocal(saved); // keeps later isPB comparisons (this card's own re-save, or other cards in this heat) aware of the save
    savedResult = saved;
    done = true;
    timeDisplay.textContent = secToTime(finalTime);
    drawLaps();
    clear(pbHost);
    if (isPB) pbHost.appendChild(badge('PB', 'pb'));
    refreshEnabled();
    resetBtn.disabled = false;
    card.classList.add('live-card-done');
    toast(isPB ? t('competitions.resultSavedPB') : t('competitions.resultSaved'));
  } }, t('competitions.liveModeFinish'));

  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !done, title: t('competitions.liveModeResetCard') }, '↺');
  resetBtn.addEventListener('click', () => {
    laps = savedResult?.laps ? [...savedResult.laps] : [];
    done = savedResult?.time != null;
    timeDisplay.textContent = done ? secToTime(savedResult.time) : '—';
    clear(pbHost);
    if (savedResult?.isPB) pbHost.appendChild(badge('PB', 'pb'));
    drawLaps();
    resetBtn.disabled = !done;
    refreshEnabled();
    card.classList.toggle('live-card-done', done);
  });

  function refreshEnabled() {
    const enabled = !done && sharedClock.canCapture();
    lapBtn.disabled = !enabled;
    finishBtn.disabled = !enabled;
  }
  refreshEnabled();
  sharedClock.onChange(refreshEnabled);

  const actionBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm',
    onclick: () => openItemModal(null, athletes, trainers, () => toast(t('actionitems.savedCreate')), entry.athleteId),
  }, '+ ' + t('competitions.liveModeAddActionItem'));

  const card = el('div', { class: `card live-athlete-card ${done ? 'live-card-done' : ''}` }, [
    el('div', { class: 'flex justify-between items-center' }, [
      el('div', { class: 'flex items-center gap-8' }, [
        badge(entry.lane != null ? t('competitions.liveModeLaneShort', { n: entry.lane }) : '—', 'neutral'),
        el('strong', {}, fullName(athlete)),
      ]),
      pbHost,
    ]),
    el('p', { class: 'text-sm hint', style: 'margin:4px 0 10px' }, entry.seedTime ? t('competitions.liveModeSeed', { time: secToTime(entry.seedTime) }) : t('competitions.liveModeNoSeed')),
    timeDisplay,
    lapsHost,
    el('div', { class: 'flex gap-8', style: 'margin-top:10px;flex-wrap:wrap' }, [lapBtn, finishBtn, resetBtn]),
    el('div', { style: 'margin-top:8px' }, actionBtn),
  ]);
  return card;
}
