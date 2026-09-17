// Trainingsmodus ("live mode") für Trainingspläne, analog zum
// Wettkampfmodus in competitionLive.js (Issue #78). Nur für Trainer:innen/
// Admins (Rollenprüfung sitzt beim Aufrufer, siehe plans.js) — im
// Unterschied zum Wettkampfmodus, dessen Lauf-Position über die URL
// reload-fest ist (siehe dortiger Dateikopf), gilt das hier NUR für die
// Plan-/Tagauswahl: welche Sätze eines Trainingstages bereits abgehakt
// sind, lebt bewusst ausschließlich als In-Memory-Zustand in diesem
// Render-Aufruf (buildDayChecklist()/buildSetCard() unten) und ist beim
// Verlassen des Trainingsmodus — auch bei einem bloßen Reload — wieder
// weg, wie in Issue #78 gefordert ("wird nicht dauerhaft gespeichert").
import { getAll } from '../db.js';
import { el, beginRender } from '../dom.js';
import { badge, emptyState, laneWave } from '../ui.js';
import { fmtDateLong } from '../dates.js';
import { navigate } from '../router.js';
import { t, trLabel } from '../i18n.js';
import { EQUIPMENT_ITEMS } from '../refdata.js';
import { equipmentForEntry, formatDuration } from './setEditor.js';
import { acquireWakeLock } from '../wakeLock.js';

// Flacht die (ggf. verschachtelten) Einträge eines Trainingstages auf eine
// einfache Liste einzeln abhakbarer Sätze ab. Wiederholungsblöcke und
// Abschnitte sind reine Anzeige-/Gruppierungskonstrukte (siehe setEditor.js
// Dateikopf) — im Trainingsmodus zählt jeder enthaltene Satz für sich als
// EIN abhakbarer Eintrag, unabhängig von `reps` (Wiederholungen
// INNERHALB eines Satzes) oder dem `repeatCount` eines umgebenden Blocks
// (Wiederholungen des GANZEN Blocks): beides bleibt reine Anzeigeangabe
// auf der Karte, exakt wie in der bestehenden schreibgeschützten
// Plananzeige (appendEntryRows() in plans.js), die dieselbe Distanz/Zeit
// ebenfalls nur als eine Zeile zeigt statt sie zu vervielfachen.
export function buildDayChecklist(items, sectionHeading = null) {
  const rows = [];
  (items || []).forEach(entry => {
    if (entry.kind === 'block') {
      buildDayChecklist(entry.sets || [], sectionHeading).forEach(row => rows.push({
        ...row, blockLabel: entry.label, blockRepeatCount: entry.repeatCount || 1,
      }));
    } else if (entry.kind === 'section') {
      rows.push(...buildDayChecklist(entry.entries || [], entry.heading));
    } else {
      rows.push({ id: entry.id, entry, sectionHeading, blockLabel: null, blockRepeatCount: null });
    }
  });
  return rows;
}

export async function renderLiveMode(container, planId, dayIndex) {
  // Issue #78: der Trainingsmodus läuft am Beckenrand, wo niemand
  // zwischen zwei Sätzen Zeit hat, den Bildschirm manuell wieder
  // einzuschalten — siehe wakeLock.js zur zentralen Freigabe beim
  // Verlassen (shell.js: renderRoute()).
  acquireWakeLock();
  // Code-Review: zwei sequenzielle awaits unten (getAll('plans'), dann
  // bedingt getAll('exercises')) — ein überholter, langsamerer Aufruf
  // (schnelles Doppelklicken auf "Nächster Tag"/Vor-Zurück-Navigation)
  // darf nach einem neueren Render nicht mehr selbst ins DOM schreiben,
  // siehe dom.js: beginRender().
  const isCurrent = beginRender(container);
  const plans = await getAll('plans');
  if (!isCurrent()) return;
  const plan = plans.find(p => p.id === planId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('plans', planId) }, t('plans.backToPlan')));

  if (!plan) {
    wrap.appendChild(emptyState(t('common.notFoundTitle'), t('plans.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('plans') }, t('common.back'))));
    container.appendChild(wrap);
    return;
  }

  const exercises = await getAll('exercises');
  if (!isCurrent()) return;
  const days = (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, plan.name), el('h1', { class: 'mt-0' }, t('plans.liveModeTitle'))]),
  ]));
  wrap.appendChild(laneWave());

  if (days.length === 0) {
    wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('plans.liveModeNoDays'), null));
    container.appendChild(wrap);
    return;
  }

  const idx = Math.min(Math.max(dayIndex, 0), days.length - 1);
  const day = days[idx];
  const isLast = idx >= days.length - 1;

  const headerCard = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center', style: 'flex-wrap:wrap;gap:12px' }, [
      el('div', {}, [
        el('div', { class: 'page-eyebrow' }, t('plans.liveModePosition', { current: idx + 1, total: days.length })),
        el('h2', { class: 'mt-0', style: 'margin-bottom:0' }, fmtDateLong(day.date)),
      ]),
      isLast
        ? badge(t('plans.liveModeLastDay'), 'done')
        : el('button', { class: 'btn btn-primary', onclick: () => navigate('plans', planId, 'live', String(idx + 1)) }, t('plans.liveModeNextDay')),
    ]),
  ]);
  wrap.appendChild(headerCard);

  const rows = buildDayChecklist(day.sets || []);
  if (rows.length === 0) {
    wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('plans.noSetsPlanned'), null));
  } else {
    const cardsGrid = el('div', { class: 'grid grid-3' });
    // Bewusst NICHT über put() persistiert (siehe Dateikopf) — lebt nur,
    // solange dieser Render-Aufruf besteht.
    const checkedIds = new Set();
    rows.forEach(row => cardsGrid.appendChild(buildSetCard(row, exercises, checkedIds)));
    wrap.appendChild(cardsGrid);
  }

  wrap.appendChild(el('button', { class: 'btn btn-ghost mt-16', onclick: () => navigate('plans', planId) }, t('plans.liveModeEnd')));

  container.appendChild(wrap);
}

// Eine Karte je abhakbarem Satz — Klassen/Optik bewusst identisch zum
// Wettkampfmodus (live-athlete-card/live-card-done, siehe
// competitionLive.js: buildAthleteCard()), wie in Issue #78 verlangt
// ("checked off sets should resemble competition mode").
function buildSetCard(row, exercises, checkedIds) {
  const { entry } = row;
  const equipment = equipmentForEntry(entry, exercises);
  const card = el('div', { class: 'card live-athlete-card' });

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) checkedIds.add(row.id); else checkedIds.delete(row.id);
    card.classList.toggle('live-card-done', checkbox.checked);
  });

  card.appendChild(el('label', { class: 'flex items-center gap-8', style: 'cursor:pointer' }, [
    checkbox,
    el('strong', {}, entry.description || t('plans.liveModeUnnamedSet')),
  ]));

  const context = [row.sectionHeading, row.blockLabel ? `${t('plans.repeatBlockLabel', { n: row.blockRepeatCount })} ${row.blockLabel}` : null].filter(Boolean);
  if (context.length > 0) card.appendChild(el('p', { class: 'text-sm hint', style: 'margin:4px 0' }, context.join(' · ')));

  card.appendChild(el('p', { class: 'data', style: 'margin:6px 0' }, `${entry.distance ?? '—'} m${(entry.reps || 1) > 1 ? ` × ${entry.reps}` : ''}`));
  if (entry.durationSec != null) card.appendChild(el('p', { class: 'text-sm' }, formatDuration(entry.durationSec)));
  if (equipment.length > 0) {
    card.appendChild(el('div', { class: 'pill-group', style: 'margin-top:6px' }, equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'))));
  }
  return card;
}
