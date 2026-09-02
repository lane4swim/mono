// ============================================================
// modules/resultsImportUI.js — UI-Flow für den DSV7-Ergebnisimport in
// der Wettkampfansicht (siehe docs/dsv7-lenex-import-plan.md Abschnitt
// 6). Verbindet die reine Parser-/Matching-Logik in resultsImport/*.js
// mit einer Abfolge von Modals: Datei wählen -> (Vereinsauswahl, falls
// nicht automatisch erkannt) -> (Event-Auflösung, falls unmappte
// Wettkämpfe vorkommen) -> Vorschau -> Bestätigen.
import { getCurrentUser } from '../state.js';
import { el } from '../dom.js';
import { toast, badge, fullName } from '../ui.js';
import { openModal } from '../modal.js';
import { field, selectInput, formActions } from '../forms.js';
import { EVENTS, DSV7_STROKE_TO_NAME } from '../refdata.js';
import { t, trCode } from '../i18n.js';
import { secToTime } from '../swimTime.js';
import { parseDsv7WettkampfergebnisListe, Dsv7ParseError, unmappedEventKey } from '../resultsImport/dsv7Parser.js';
import { matchOwnClub, filterResultsForClub, buildImportPlan } from '../resultsImport/matching.js';
import { loadImportContext, executeImportPlan } from '../resultsImport/importRunner.js';

const STATUS_LABEL_KEY = { OK: null, DS: 'resultsImport.statusDS', NA: 'resultsImport.statusNA', AB: 'resultsImport.statusAB', AU: 'resultsImport.statusAU', ZU: 'resultsImport.statusZU' };

function statusBadge(status) {
  const key = STATUS_LABEL_KEY[status];
  return key ? badge(t(key), 'warn') : null;
}

// Button + verstecktes Datei-Input, analog zu libraryTransfer.js:
// libraryTransferButtons() — für die Ergebnisse-Card in
// modules/competitions.js: renderDetail().
export function resultsImportButton(comp, onImported) {
  const fileInput = el('input', {
    type: 'file', accept: '.dsv7,.DSV7', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (file) await startImport(file, comp, onImported);
    },
  });
  const importBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileInput.click() }, t('resultsImport.button'));
  return el('span', { style: 'display:inline-flex' }, [importBtn, fileInput]);
}

async function startImport(file, comp, onImported) {
  let text;
  try {
    text = await file.text();
  } catch {
    toast(t('resultsImport.readError'), 'error');
    return;
  }

  let parsed;
  try {
    parsed = parseDsv7WettkampfergebnisListe(text);
  } catch (err) {
    toast(err instanceof Dsv7ParseError ? err.message : t('resultsImport.parseError'), 'error');
    return;
  }
  if (parsed.clubs.length === 0 || parsed.results.length === 0) {
    toast(t('resultsImport.noResults'), 'error');
    return;
  }

  // Automatische Vereinserkennung über Club.nationalID/nationalIDType
  // (Plan Abschnitt 5.1) — bis die Stammdaten-Felder dafür gepflegt sind
  // (bzw. wenn die Datei keine passende Vereinskennzahl trägt), fällt das
  // auf die manuelle Auswahl unten zurück.
  const user = getCurrentUser();
  const localClub = { nationalIDType: user?.clubNationalIDType, nationalID: user?.clubNationalID };
  const autoClub = matchOwnClub(parsed.clubs, localClub);
  if (autoClub) openEventResolutionStep(parsed, autoClub, comp, onImported);
  else openClubSelectStep(parsed, comp, onImported);
}

function openClubSelectStep(parsed, comp, onImported) {
  const form = el('form', { class: 'form-grid' });
  const options = parsed.clubs.map((c) => ({ value: c.name, label: c.name }));
  const fClub = selectInput(options, options[0]?.value);
  form.appendChild(el('p', { style: 'grid-column:1/-1' }, t('resultsImport.clubSelectHint', { veranstaltung: parsed.meta.veranstaltung || '—', ort: parsed.meta.ort || '—' })));
  form.appendChild(field(t('resultsImport.clubSelectLabel'), fClub, { span2: true }));
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: t('resultsImport.continueButton') }).row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const selected = parsed.clubs.find((c) => c.name === fClub.value);
    close();
    openEventResolutionStep(parsed, selected, comp, onImported);
  });
  const { close } = openModal({ title: t('resultsImport.clubSelectTitle'), bodyNode: form, wide: true });
}

// Ein Vorschlagslabel für "neues Event anlegen", nach demselben Muster wie
// refdata.js: dsv7EventLabel() — aber OHNE die EVENTS-Mitgliedschaft zu
// prüfen (das ist hier ja gerade der Zweck: ein Event, das es noch nicht
// gibt). `null`, wenn nicht einmal der Technik-Code bekannt ist (z. B.
// Sonderform "X") — dafür bleibt nur "ignorieren".
function suggestEventLabel({ technik, distanzM, isRelay, relaySize }) {
  const strokeName = DSV7_STROKE_TO_NAME[technik];
  if (!strokeName || !distanzM) return null;
  return isRelay && relaySize > 1 ? `${relaySize}x${distanzM} ${strokeName}` : `${distanzM} ${strokeName}`;
}

function describeEventCode({ technik, distanzM, isRelay, relaySize }) {
  const strokeName = DSV7_STROKE_TO_NAME[technik] || technik;
  return isRelay ? `${relaySize}x${distanzM}m ${strokeName}` : `${distanzM}m ${strokeName}`;
}

// Fragt für jedes nicht automatisch zuordenbare Wettkampf-Profil (Technik/
// Distanz/Staffelgröße) der ausgewählten Vereins-Ergebnisse EINE
// Entscheidung ab (Plan Abschnitt 3.5): bestehendem Event zuordnen, neues
// Event anlegen, oder den Wettkampf beim Import ignorieren. Wird
// übersprungen, wenn es nichts aufzulösen gibt.
function openEventResolutionStep(parsed, selectedClub, comp, onImported) {
  const clubResults = filterResultsForClub(parsed.results, selectedClub);
  const unmapped = new Map(); // key -> eventCode
  for (const r of clubResults) {
    if (!r.eventCode.label) unmapped.set(unmappedEventKey(r.eventCode), r.eventCode);
  }
  if (unmapped.size === 0) {
    openPreviewStep(parsed, selectedClub, clubResults, new Map(), comp, onImported);
    return;
  }

  const form = el('form', { class: 'form-grid' });
  form.appendChild(el('p', { style: 'grid-column:1/-1' }, t('resultsImport.eventResolutionHint')));
  const rowInputs = []; // { key, select, suggested }
  for (const [key, eventCode] of unmapped) {
    const suggested = suggestEventLabel(eventCode);
    const options = [
      { value: 'ignore', label: t('resultsImport.eventActionIgnore') },
      ...(suggested ? [{ value: 'create', label: t('resultsImport.eventActionCreate', { event: suggested }) }] : []),
      ...EVENTS.map((event) => ({ value: `map:${event}`, label: t('resultsImport.eventActionMap', { event: trCode(event, 'events') }) })),
    ];
    const select = selectInput(options, suggested ? 'create' : 'ignore');
    rowInputs.push({ key, select });
    form.appendChild(field(describeEventCode(eventCode), select, { span2: true }));
  }
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: t('resultsImport.continueButton') }).row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const eventResolutions = new Map();
    for (const { key, select } of rowInputs) {
      const value = select.value;
      if (value === 'ignore') eventResolutions.set(key, { action: 'ignore' });
      else if (value === 'create') {
        const newLabel = suggestEventLabel(unmapped.get(key));
        // Session-Erweiterung der Event-Referenzliste: EVENTS ist reine,
        // ungespeicherte Vorschlagsliste ohne eigenen Backend-Store (siehe
        // refdata.js) — Result.event selbst ist ein freies Textfeld ohne
        // Enum-Zwang, das neue Label ist also sofort gültig. Ein Neuladen
        // der Seite setzt die Erweiterung zurück; wer das Event dauerhaft
        // in den Auswahllisten sehen will, ergänzt es regulär in
        // refdata.js.
        if (!EVENTS.includes(newLabel)) EVENTS.push(newLabel);
        eventResolutions.set(key, { action: 'create', event: newLabel });
      } else {
        eventResolutions.set(key, { action: 'map', event: value.slice('map:'.length) });
      }
    }
    close();
    openPreviewStep(parsed, selectedClub, clubResults, eventResolutions, comp, onImported);
  });
  const { close } = openModal({ title: t('resultsImport.eventResolutionTitle'), bodyNode: form, wide: true });
}

function formatTimeCell(time) {
  return time == null ? '—' : secToTime(time);
}

function planRowNode(row) {
  if (row.kind === 'unmatched-athlete') {
    return el('tr', {}, [
      el('td', {}, row.imported.athleteMatchHint.name),
      el('td', { colspan: '4' }, badge(t('resultsImport.rowUnmatchedAthlete'), 'warn')),
    ]);
  }
  if (row.kind === 'unmatched-event') {
    return el('tr', {}, [
      el('td', {}, fullName(row.athlete)),
      el('td', { colspan: '4' }, badge(t('resultsImport.rowUnmatchedEvent'), 'warn')),
    ]);
  }
  const isUpdate = row.kind === 'update';
  const timeChanged = !isUpdate || row.existingResult.time !== row.proposed.time;
  return el('tr', {}, [
    el('td', {}, fullName(row.athlete)),
    el('td', {}, trCode(row.eventLabel, 'events')),
    el('td', { class: 'data' }, isUpdate && timeChanged
      ? `${formatTimeCell(row.existingResult.time)} → ${formatTimeCell(row.proposed.time)}`
      : formatTimeCell(row.proposed.time)),
    el('td', {}, row.proposed.place ? `${row.proposed.place}.` : '—'),
    el('td', {}, [
      badge(isUpdate ? t('resultsImport.rowUpdate') : t('resultsImport.rowNew'), isUpdate ? 'neutral' : 'accent'),
      statusBadge(row.proposed.status),
      row.proposed.comments?.length > 0 ? badge(t('resultsImport.rowCommentsKept', { count: row.proposed.comments.length }), 'neutral') : null,
    ].filter(Boolean)),
  ]);
}

async function openPreviewStep(parsed, selectedClub, clubResults, eventResolutions, comp, onImported) {
  // Pullt hier (in loadImportContext()) den aktuellsten Server-Stand,
  // bevor überhaupt ein Vorschau-Modal geöffnet wird — kein separater
  // "Lädt…"-Zwischenzustand nötig (die App zeigt an anderer Stelle
  // ebenfalls keine Ladeindikatoren für einzelne Aktionen), aber der
  // Button-Klick kann dadurch kurz dauern, bis sich das Modal öffnet.
  let context;
  try {
    context = await loadImportContext(comp.id);
  } catch {
    toast(t('resultsImport.contextLoadError'), 'error');
    return;
  }

  const rows = buildImportPlan({
    importedResults: clubResults,
    athletes: context.athletes,
    existingResults: context.existingResults,
    eventResolutions,
    clubId: getCurrentUser()?.clubId,
    competitionId: comp.id,
    competitionDate: comp.date,
    competitionCourse: comp.course,
  });

  const writable = rows.filter((r) => r.kind === 'new' || r.kind === 'update');
  const newCount = rows.filter((r) => r.kind === 'new').length;
  const updateCount = rows.filter((r) => r.kind === 'update').length;
  const skippedCount = rows.length - writable.length;

  const body = el('div', {}, [
    el('p', {}, t('resultsImport.previewSummary', { new: newCount, update: updateCount, skipped: skippedCount })),
  ]);
  if (rows.length === 0) {
    body.appendChild(el('p', {}, t('resultsImport.previewEmpty')));
  } else {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('competitions.colAthlete')), el('th', {}, t('competitions.colEvent')),
      el('th', {}, t('competitions.colTime')), el('th', {}, t('competitions.colPlace')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    rows.forEach((row) => tbody.appendChild(planRowNode(row)));
    table.appendChild(tbody);
    body.appendChild(el('div', { class: 'table-wrap' }, table));
  }

  // `close` existiert erst NACH dem openModal()-Aufruf unten, wird aber
  // schon jetzt beim Bauen der Buttons gebraucht — daher als Closure über
  // eine Variable statt direkt destrukturiert (analog zum Confirm-Button
  // in modal.js: confirmAction()).
  let close;
  const actions = el('div', { class: 'form-actions' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', {
      class: 'btn btn-primary',
      disabled: writable.length === 0 ? '' : undefined,
      onclick: async () => {
        close();
        try {
          await executeImportPlan(rows, context.allResults);
          toast(t('resultsImport.importDone', { new: newCount, update: updateCount }));
        } catch {
          toast(t('resultsImport.writeError'), 'error');
        }
        onImported?.();
      },
    }, t('resultsImport.confirmButton', { count: writable.length })),
  ]);
  body.appendChild(actions);

  ({ close } = openModal({ title: t('resultsImport.previewTitle'), bodyNode: body, wide: true }));
}
