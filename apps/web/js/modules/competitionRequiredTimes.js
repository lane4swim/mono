// Karte "Pflichtzeiten" in der Wettkampf-Detailseite: von Hand erfasste
// Pflichtzeiten bearbeiten, aus einer Normtabelle übernehmen oder
// entfernen (docs/Plans/pflichtzeiten-manuell-plan.md, Abschnitte 2.4/3.2).
// Gespeichert wird alles in Competition.manualRequirements; ausgewertet
// wird es in requiredTimes.js zusammen mit den importierten Pflichtzeiten.
import { getAll, put } from '../db.js';
import { el } from '../dom.js';
import { formActions } from '../forms.js';
import { openModal, confirmAction } from '../modal.js';
import { toast } from '../ui.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';
import { manualRules, hasRequiredTimes, requiredTimeLight } from './requiredTimes.js';
import { entrySuggestions, entryFromSuggestion, NEAR_MISS_RATIO } from './requiredTimeSuggestions.js';
import { secToTime } from '../swimTime.js';
import { fullName } from '../ui.js';
import { trCode } from '../i18n.js';
import { buildRequiredTimesEditor } from './requiredTimesEditor.js';

const EMPTY_WINDOW = { from: null, to: null, course: null };

export function importedRuleCount(comp) {
  return (comp.disciplines || []).reduce((n, d) => n + (d.requiredTimes?.length || 0), 0);
}

// Neuer Wert für Competition.manualRequirements.
export function manualRequirementsFrom({ rules, window, set = null }) {
  return {
    // Kopie: eine spätere Änderung der Normtabelle darf nicht auf den
    // Wettkampf durchschlagen (Abschnitt 3.2 des Plans).
    rules: rules.map((r) => ({ ...r })),
    qualifyingWindow: { ...EMPTY_WINDOW, ...(window || {}) },
    sourceSetId: set ? set.id : null,
    sourceSetName: set ? set.name : '',
  };
}

export function requiredTimesCard(comp, onChanged) {
  const manual = manualRules(comp);
  const imported = importedRuleCount(comp);
  const setName = comp.manualRequirements?.sourceSetName;
  const lines = [
    imported > 0 ? t('requiredTimes.importedCount', { count: imported }) : null,
    manual.length > 0 ? t('requiredTimes.manualCount', { count: manual.length }) : t('requiredTimes.none'),
    manual.length > 0 && setName ? t('requiredTimes.fromSet', { name: setName }) : null,
    manual.length > 0 && imported > 0 ? t('requiredTimes.overridesNote') : null,
  ].filter(Boolean);
  return el('div', { class: 'card' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('requiredTimes.cardTitle')),
      el('div', { class: 'flex gap-8' }, [
        hasRequiredTimes(comp) ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openSuggestionsModal(comp, onChanged) }, t('requiredTimes.suggestButton')) : null,
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openApplySetModal(comp, onChanged) }, t('requiredTimes.applySet')),
        el('button', { class: 'btn btn-accent btn-sm', onclick: () => openManualRequirementsModal(comp, onChanged) }, t('requiredTimes.edit')),
      ]),
    ]),
    el('div', { class: 'rt-summary' }, lines.map((line) => el('p', { class: 'text-sm' }, line))),
    manual.length > 0 ? el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => confirmAction(t('requiredTimes.clearConfirm'), async () => {
        await put('competitions', { ...comp, manualRequirements: manualRequirementsFrom({ rules: [], window: EMPTY_WINDOW }) });
        toast(t('requiredTimes.cleared'));
        onChanged?.();
      }, { confirmLabel: t('common.remove') }),
    }, t('requiredTimes.clear')) : null,
  ]);
}

export function openManualRequirementsModal(comp, onSaved) {
  const current = comp.manualRequirements || {};
  const editor = buildRequiredTimesEditor({ rules: current.rules || [], window: current.qualifyingWindow || {} });
  const form = el('form', { class: 'form-grid single' });
  form.appendChild(editor.node);
  const { row } = formActions({ onCancel: () => close(), submitLabel: t('common.save') });
  form.appendChild(row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = editor.collect();
    if (!res.ok) return;
    // Bleiben die Regeln unverändert, bleibt auch der Hinweis auf die
    // Normtabelle; jede Änderung macht sie zu "von Hand erfasst".
    const unchanged = JSON.stringify(res.rules) === JSON.stringify(current.rules || []);
    const set = unchanged && current.sourceSetId ? { id: current.sourceSetId, name: current.sourceSetName } : null;
    await put('competitions', { ...comp, manualRequirements: manualRequirementsFrom({ rules: res.rules, window: res.window, set }) });
    toast(t('requiredTimes.saved'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: t('requiredTimes.modalTitle', { name: comp.name }), bodyNode: form, wide: true });
}

export async function applySet(comp, set) {
  const updated = { ...comp, manualRequirements: manualRequirementsFrom({ rules: set.rules || [], window: set.qualifyingWindow, set }) };
  await put('competitions', updated);
  return updated;
}

export async function openApplySetModal(comp, onApplied) {
  const sets = (await getAll('requiredTimeSets')).sort((a, b) => a.name.localeCompare(b.name));
  const body = el('div');
  const manage = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { close(); navigate('competitions', 'normtables'); } }, t('requiredTimes.applyManage'));
  if (sets.length === 0) {
    body.appendChild(el('p', {}, t('requiredTimes.applyNone')));
  } else {
    const list = el('ul', { style: 'list-style:none;padding:0;margin:0 0 12px' });
    for (const set of sets) {
      list.appendChild(el('li', { class: 'flex justify-between items-center gap-12', style: 'padding:8px 0;border-bottom:1px solid var(--c-line)' }, [
        el('div', {}, [
          el('strong', {}, set.name),
          el('div', { class: 'text-sm' }, [t('requiredTimes.setRulesCount', { count: (set.rules || []).length }), set.description ? ` · ${set.description}` : ''].join('')),
        ]),
        el('button', {
          class: 'btn btn-accent btn-sm',
          onclick: () => {
            const doApply = async () => {
              await applySet(comp, set);
              toast(t('requiredTimes.applied', { count: (set.rules || []).length, name: set.name }));
              close(); onApplied?.();
            };
            if (manualRules(comp).length > 0) confirmAction(t('requiredTimes.applyReplaceConfirm', { name: set.name }), doApply, { confirmLabel: t('requiredTimes.apply') });
            else doApply();
          },
        }, t('requiredTimes.apply')),
      ]));
    }
    body.appendChild(list);
  }
  body.appendChild(el('div', { class: 'form-actions' }, [manage]));
  const { close } = openModal({ title: t('requiredTimes.applyTitle'), bodyNode: body });
}

function targetHeading(target) {
  const parts = [trCode(target.event, 'events')];
  if (target.gender === 'W' || target.gender === 'M') parts.push(t(`requiredTimes.gender${target.gender}`));
  if (target.eventNumber) parts.push(t('requiredTimes.eventNumberLabel', { nr: target.eventNumber }));
  return parts.join(' · ');
}

function marginText(margin) {
  return margin >= 0 ? t('requiredTimes.suggestFaster', { delta: margin.toFixed(2) }) : t('requiredTimes.suggestMissing', { delta: (-margin).toFixed(2) });
}

// Meldevorschläge (Plan, Abschnitt 6.1): je Disziplin, wer die Pflichtzeit
// erfüllt oder knapp verfehlt; "Melden" legt den Startlisten-Eintrag an.
// Der Dialog bleibt offen und zeichnet sich nach jeder Meldung neu.
export async function openSuggestionsModal(comp, onChanged) {
  const body = el('div', { class: 'rt-suggest' });
  const { close } = openModal({ title: t('requiredTimes.suggestTitle', { name: comp.name }), bodyNode: body, wide: true });

  async function enter(target, list) {
    for (const s of list) await put('entries', entryFromSuggestion(comp, target, s));
    toast(list.length === 1
      ? t('requiredTimes.suggestAdded', { name: fullName(list[0].athlete), event: trCode(target.event, 'events') })
      : t('requiredTimes.suggestAddedAll', { count: list.length }));
    onChanged?.();
    await draw();
  }

  async function draw() {
    const [athletes, results, entries] = await Promise.all([getAll('athletes'), getAll('results'), getAll('entries')]);
    const groups = entrySuggestions({ comp, athletes, results, entries }).filter((g) => g.suggestions.length > 0);
    body.replaceChildren();
    body.appendChild(el('p', { class: 'hint' }, t('requiredTimes.suggestIntro', { percent: Math.round(NEAR_MISS_RATIO * 100) })));
    if (groups.length === 0) { body.appendChild(el('p', {}, t('requiredTimes.suggestNone'))); return; }
    for (const { target, suggestions } of groups) {
      const open = suggestions.filter((s) => s.kind === 'met' && !s.entered);
      body.appendChild(el('div', { class: 'flex justify-between items-center rt-suggest-head' }, [
        el('h4', {}, targetHeading(target)),
        open.length > 1 ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => enter(target, open) }, t('requiredTimes.suggestEnterAll', { count: open.length })) : null,
      ]));
      const tbody = el('tbody');
      for (const s of suggestions) {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, fullName(s.athlete)),
          el('td', {}, requiredTimeLight(s.evaluation, comp)),
          el('td', { class: 'data' }, secToTime(Number.isFinite(s.seedTime) ? s.seedTime : null)),
          el('td', { class: 'text-sm' }, [marginText(s.margin), s.kind === 'near' ? ` · ${t('requiredTimes.suggestNear')}` : ''].join('')),
          el('td', { class: 'rt-row-actions' }, s.entered
            ? el('span', { class: 'badge badge-neutral' }, t('requiredTimes.suggestEntered'))
            : el('button', { class: `btn btn-sm ${s.kind === 'met' ? 'btn-accent' : 'btn-ghost'}`, onclick: () => enter(target, [s]) }, t('requiredTimes.suggestEnter'))),
        ]));
      }
      body.appendChild(el('div', { class: 'table-wrap' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [t('competitions.colAthlete'), t('requiredTimes.colRequired'), t('requiredTimes.colBest'), t('requiredTimes.colMargin'), ''].map((h) => el('th', {}, h)))),
        tbody,
      ])));
    }
    body.appendChild(el('div', { class: 'form-actions' }, el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.close'))));
  }
  await draw();
}
