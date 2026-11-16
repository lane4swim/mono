// Karte "Pflichtzeiten" auf der Detailseite einer Athlet:in
// (docs/Plans/pflichtzeiten-manuell-plan.md, Abschnitt 6.2): für anstehende
// Wettkämpfe und Normtabellen, welche Pflichtzeiten gelten und ob sie
// erfüllt sind — bewertet mit derselben Ampel wie die Startliste.
import { el } from '../dom.js';
import { fmtDateLong } from '../dates.js';
import { secToTime } from '../swimTime.js';
import { navigate } from '../router.js';
import { t, trCode } from '../i18n.js';
import { requiredTimeLight } from './requiredTimes.js';
import { athleteRequirementOverview, metCount } from './requiredTimeSuggestions.js';

function rowsTable(rows, comp, { showEntered }) {
  const best = (ev) => [ev.official, ev.training].filter((x) => x != null).reduce((a, b) => Math.min(a, b), Infinity);
  return el('div', { class: 'table-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, t('competitions.colEvent')), el('th', {}, t('requiredTimes.colRequired')), el('th', {}, t('requiredTimes.colBest')),
      showEntered ? el('th', {}, '') : null,
    ].filter(Boolean))),
    el('tbody', {}, rows.map(({ target, evaluation, entered }) => el('tr', {}, [
      el('td', {}, trCode(target.event, 'events')),
      el('td', {}, requiredTimeLight(evaluation, comp)),
      el('td', { class: 'data' }, secToTime(Number.isFinite(best(evaluation)) ? best(evaluation) : null)),
      showEntered ? el('td', {}, entered ? el('span', { class: 'badge badge-neutral' }, t('requiredTimes.suggestEntered')) : '') : null,
    ].filter(Boolean)))),
  ]));
}

function sectionHead(title, sub, rows, onClick) {
  return el('div', { class: 'flex justify-between items-center rt-suggest-head' }, [
    el('h4', {}, onClick ? el('button', { class: 'btn btn-ghost btn-sm', onclick: onClick }, title) : title),
    el('span', { class: 'text-sm' }, [sub, t('requiredTimes.athleteMet', { met: metCount(rows), total: rows.length })].filter(Boolean).join(' · ')),
  ]);
}

// null, wenn für die Athlet:in nirgends eine Pflichtzeit gilt.
export function athleteRequiredTimesCard({ athlete, competitions, sets, results, entries, today }) {
  const overview = athleteRequirementOverview({ athlete, competitions, sets, results, entries, today });
  if (overview.competitions.length === 0 && overview.sets.length === 0) return null;
  const card = el('div', { class: 'card rt-athlete' }, [el('h3', {}, t('requiredTimes.cardTitle'))]);
  if (overview.competitions.length > 0) {
    card.appendChild(el('h4', { class: 'text-slate' }, t('requiredTimes.athleteUpcoming')));
    for (const { comp, rows } of overview.competitions) {
      card.appendChild(sectionHead(comp.name, fmtDateLong(comp.date), rows, () => navigate('competitions', comp.id)));
      card.appendChild(rowsTable(rows, comp, { showEntered: true }));
    }
  }
  if (overview.sets.length > 0) {
    card.appendChild(el('h4', { class: 'text-slate' }, t('requiredTimes.athleteSets')));
    card.appendChild(el('p', { class: 'hint' }, t('requiredTimes.athleteSetsHint')));
    for (const { set, comp, rows } of overview.sets) {
      card.appendChild(sectionHead(set.name, '', rows, null));
      card.appendChild(rowsTable(rows, comp, { showEntered: false }));
    }
  }
  return card;
}
