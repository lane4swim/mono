// Disziplinen eines Wettkampfs aus einer DSV7-Wettkampfdefinitionsliste:
// Laden der Datei (Startlisten-Card in modules/competitions.js) und die
// Auswahlliste im Formular für Startlisten-Einträge. Die geladenen
// Disziplinen liegen als `disciplines` am Wettkampf (siehe
// CompetitionDisciplineSchema in packages/shared-types/src/entities.ts) und
// werden mit ihm synchronisiert — alle Trainer:innen des Vereins sehen
// dieselbe Liste.
import { put } from '../db.js';
import { el } from '../dom.js';
import { toast } from '../ui.js';
import { confirmAction } from '../modal.js';
import { t, trCode } from '../i18n.js';
import { DSV7_STROKE_TO_NAME } from '../refdata.js';
import { parseDsv7Wettkampfdefinitionsliste } from '../resultsImport/dsv7DefinitionParser.js';
import { Dsv7ParseError } from '../resultsImport/dsv7Parser.js';

// Reale Wettkampfdefinitionslisten sind wenige KB groß; größere Dateien
// werden gar nicht erst eingelesen.
const MAX_FILE_BYTES = 1024 * 1024;

const ROUND_KEYS = { V: 'roundV', Z: 'roundZ', F: 'roundF', A: 'roundA', N: 'roundN' };
const GENDER_KEYS = { M: 'genderM', W: 'genderW', X: 'genderX', D: 'genderD' };

// "Nr. 3 · 100 Freistil · weiblich · Vorlauf". Die Wettkampfart
// "Entscheidung" (E) ist der Normalfall und wird nicht eigens genannt.
export function disciplineLabel(d) {
  const event = d.event
    ? trCode(d.event, 'events')
    : `${d.relaySize > 1 ? `${d.relaySize}x` : ''}${d.distanceM}m ${DSV7_STROKE_TO_NAME[d.stroke] || d.stroke}`;
  return [
    t('competitions.disciplineNumber', { nr: d.number }),
    event,
    GENDER_KEYS[d.gender] ? t(`competitions.${GENDER_KEYS[d.gender]}`) : null,
    ROUND_KEYS[d.round] ? t(`competitions.${ROUND_KEYS[d.round]}`) : null,
  ].filter(Boolean).join(' · ');
}

// Passt die Disziplin zum Geschlecht der Athlet:in? Offene/gemischte
// Wettkämpfe (X, ohne Angabe) passen immer; für Athlet:innen ohne oder mit
// Geschlecht "d" wird nicht gefiltert (Startrecht ist dort Einzelfallfrage).
export function disciplineMatchesAthlete(d, athlete) {
  const g = athlete?.gender;
  if (!g || g === 'd') return true;
  if (!d.gender || d.gender === 'X') return true;
  return d.gender.toLowerCase() === g;
}

// Index der Disziplin, zu der ein bestehender Startlisten-Eintrag gehört
// (gleiche Wettkampfnummer, bevorzugt auch gleiche Disziplin), sonst -1.
export function findDisciplineIndex(disciplines, entry) {
  if (!entry?.eventNumber) return -1;
  const byNumber = disciplines.map((d, i) => [d, i]).filter(([d]) => d.number === String(entry.eventNumber).trim());
  const exact = byNumber.find(([d]) => d.event === entry.event);
  return (exact || byNumber[0])?.[1] ?? -1;
}

// Button + verstecktes Datei-Input (analog resultsImportButton()) zum
// Laden bzw. Ersetzen der Wettkampfdefinition.
export function disciplinesLoadButton(comp, onLoaded) {
  const fileInput = el('input', {
    type: 'file', accept: '.dsv7,.DSV7', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (file) await loadDefinitionFile(file, comp, onLoaded);
    },
  });
  const label = comp.disciplines?.length ? t('competitions.disciplinesReplace') : t('competitions.disciplinesLoad');
  const btn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileInput.click() }, label);
  return el('span', { style: 'display:inline-flex' }, [btn, fileInput]);
}

async function loadDefinitionFile(file, comp, onLoaded) {
  if (file.size > MAX_FILE_BYTES) { toast(t('competitions.disciplinesFileTooLarge'), 'error'); return; }
  let parsed;
  try {
    parsed = parseDsv7Wettkampfdefinitionsliste(await file.text());
  } catch (err) {
    toast(err instanceof Dsv7ParseError ? err.message : t('competitions.disciplinesParseError'), 'error');
    return;
  }
  if (parsed.disciplines.length === 0) { toast(t('competitions.disciplinesEmpty'), 'error'); return; }
  const save = async () => {
    await put('competitions', { ...comp, disciplines: parsed.disciplines });
    toast(t('competitions.disciplinesLoaded', { count: parsed.disciplines.length, veranstaltung: parsed.meta.veranstaltung || file.name })
      + (parsed.skipped > 0 ? ' ' + t('competitions.disciplinesSkipped', { count: parsed.skipped }) : ''));
    onLoaded?.();
  };
  if (comp.disciplines?.length) {
    confirmAction(t('competitions.disciplinesReplaceConfirm', { count: comp.disciplines.length }), save, { confirmLabel: t('competitions.disciplinesReplace') });
  } else {
    await save();
  }
}

// Kurzinfo für die Startlisten-Card: Anzahl geladener Disziplinen,
// aufklappbare Liste und "Entfernen". `null`, wenn keine geladen sind.
export function disciplinesSummary(comp, onChanged) {
  const disciplines = comp.disciplines || [];
  if (disciplines.length === 0) return null;
  const list = el('ul', { class: 'text-sm' }, disciplines.map(d => el('li', {}, disciplineLabel(d))));
  const removeBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm',
    onclick: () => confirmAction(t('competitions.disciplinesRemoveConfirm'), async () => {
      await put('competitions', { ...comp, disciplines: [] });
      toast(t('competitions.disciplinesRemoved'));
      onChanged?.();
    }, { confirmLabel: t('common.remove') }),
  }, t('common.remove'));
  return el('details', { class: 'mb-16' }, [
    el('summary', {}, [t('competitions.disciplinesSummary', { count: disciplines.length }), ' ', removeBtn]),
    list,
  ]);
}

// Auswahlliste "Disziplin aus Wettkampfdefinition" für das
// Startlisten-Formular. Füllt bei Auswahl Wettkampfnummer und Disziplin
// des Formulars vor (beide bleiben danach von Hand änderbar); eine
// Disziplin, die nicht in EVENTS steht (z. B. "25 Freistil"), wird der
// Disziplin-Auswahl dieses Formulars als Option hinzugefügt.
// `getAthlete()` liefert die aktuell gewählte Athlet:in; `refresh()` am
// Rückgabewert filtert die Optionen nach deren Geschlecht neu.
export function disciplineSelect(disciplines, { entry, eventSelect, numberInput, getAthlete }) {
  const select = el('select');
  let selectedIndex = findDisciplineIndex(disciplines, entry);

  function refresh() {
    const athlete = getAthlete();
    select.replaceChildren(el('option', { value: '' }, t('competitions.disciplineManual')));
    disciplines.forEach((d, i) => {
      if (i !== selectedIndex && !disciplineMatchesAthlete(d, athlete)) return;
      const o = el('option', { value: String(i) }, disciplineLabel(d));
      if (i === selectedIndex) o.setAttribute('selected', '');
      select.appendChild(o);
    });
    select.value = selectedIndex >= 0 ? String(selectedIndex) : '';
  }

  select.addEventListener('change', () => {
    selectedIndex = select.value === '' ? -1 : Number(select.value);
    const d = disciplines[selectedIndex];
    if (!d) return;
    numberInput.value = d.number;
    if (d.event) {
      if (![...eventSelect.options].some(o => o.value === d.event)) {
        eventSelect.appendChild(el('option', { value: d.event }, trCode(d.event, 'events')));
      }
      eventSelect.value = d.event;
    }
  });

  refresh();
  return { select, refresh };
}
