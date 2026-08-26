// ============================================================
// modules/stopwatch.js — self-contained stopwatch widgets.
//
// Code-Review, Befund L3: extracted out of competitions.js (was 675
// lines mixing three unrelated features) — neither widget here knows
// anything about competitions, entries, or results; both just report
// elapsed time / recorded laps back to the caller via callbacks.
// ============================================================
import { el, clear } from '../dom.js';
import { secToTime } from '../swimTime.js';
import { t } from '../i18n.js';

// Single shared clock for a whole Wettkampfmodus heat — Start/Stop/Reset
// only (no Lap, no Apply): individual athlete cards each capture their own
// splits/finish time by reading this clock's current elapsed() when their
// own buttons are pressed, exactly like several lanes each having their
// own stopwatch hand-synced to the same starting gun. `canCapture()` gates
// the per-athlete buttons so a stray click before the heat has actually
// been started can't record a meaningless ~0.00s time.
export function buildSharedStopwatch(container) {
  let running = false, startTs = null, stoppedAt = null, intervalId = null, everStarted = false;
  const listeners = [];
  const notify = () => listeners.forEach(fn => fn());

  const display = el('div', { class: 'data', style: 'font-size:3rem;font-weight:700;text-align:center;margin-bottom:12px' }, secToTime(0));
  const startBtn = el('button', { type: 'button', class: 'btn btn-primary' }, t('competitions.stopwatchStart'));
  const stopBtn = el('button', { type: 'button', class: 'btn btn-danger', disabled: true }, t('competitions.stopwatchStop'));
  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost', disabled: true }, t('competitions.stopwatchReset'));

  function elapsed() {
    if (running) return (performance.now() - startTs) / 1000;
    return stoppedAt ?? 0;
  }
  function updateDisplay() { display.textContent = secToTime(elapsed()); }

  startBtn.addEventListener('click', () => {
    running = true; everStarted = true; startTs = performance.now(); stoppedAt = null;
    startBtn.disabled = true; stopBtn.disabled = false; resetBtn.disabled = true;
    updateDisplay();
    intervalId = setInterval(updateDisplay, 30);
    notify();
  });
  stopBtn.addEventListener('click', () => {
    if (!running) return;
    stoppedAt = elapsed(); running = false; clearInterval(intervalId);
    startBtn.disabled = true; stopBtn.disabled = true; resetBtn.disabled = false;
    updateDisplay();
    notify();
  });
  resetBtn.addEventListener('click', () => {
    running = false; everStarted = false; clearInterval(intervalId); startTs = null; stoppedAt = null;
    startBtn.disabled = false; stopBtn.disabled = true; resetBtn.disabled = true;
    updateDisplay();
    notify();
  });

  container.appendChild(el('div', {}, [
    display,
    el('div', { class: 'flex gap-8 justify-center' }, [startBtn, stopBtn, resetBtn]),
  ]));

  return { elapsed, isRunning: () => running, canCapture: () => everStarted, onChange: (fn) => listeners.push(fn) };
}

// Self-contained stopwatch widget: Start / Runde (lap) / Stopp / Zurücksetzen,
// live-updating elapsed-time display, and a table of recorded lap splits.
// `initialLaps` (seconds, cumulative) lets a previously documented set of
// splits be shown when the panel is reopened, without starting a new run.
// `onApply(totalSeconds, laps)` is called when "Zeit übernehmen" is clicked.
export function buildStopwatchPanel(container, { initialLaps = [], onApply }) {
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
