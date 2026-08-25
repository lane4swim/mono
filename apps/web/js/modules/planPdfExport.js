// ============================================================
// modules/planPdfExport.js — "Als PDF exportieren" für Trainingspläne.
//
// Kein PDF-Vendor-Code nötig: baut eine eigene, druckoptimierte Ansicht
// des Plans auf (großer, kontrastreicher Text, Wiederholungsblöcke als
// eigene Boxen) und ruft window.print() auf — der Nutzer wählt im
// Druckdialog "Als PDF speichern". Funktioniert komplett offline, ohne
// zusätzliche Bibliothek und ohne Build-Schritt.
//
// "Einseitig" wird durch Messen + notfalls Herunterskalieren erzwungen:
// der Inhalt wird zunächst in natürlicher Größe aufgebaut, dann gegen
// die verfügbare A4-Druckhöhe geprüft; passt er nicht, wird er per
// CSS-zoom so weit verkleinert, dass er auf eine Seite passt.
//
// Neben dem ganzen Wochenplan (exportPlanToPdf) lässt sich auch ein
// einzelner Trainingstag drucken (exportDayToPdf) — z. B. um nur den
// heutigen Zettel poolside auszudrucken statt der ganzen Woche. Der
// Einzeltag bekommt die volle Seitenbreite statt der Mehrspalten-Ansicht,
// dadurch bleiben Übungsname/Distanz/Wiederholungen noch größer.
// ============================================================
import { el, clear } from '../dom.js';
import { fmtDateLong } from '../dates.js';
import { totalDistance } from './setEditor.js';
import { t } from '../i18n.js';

const MM_TO_PX = 96 / 25.4;
const PAGE_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 12;
// Muss zur Breite von .plan-print-sheet in css/styles.css passen.
const SHEET_WIDTH_MM = 190;

let printRoot = null;
function getPrintRoot() {
  if (!printRoot) {
    printRoot = el('div', { class: 'plan-print-root' });
    document.body.appendChild(printRoot);
  }
  return printRoot;
}

export function exportPlanToPdf(plan, group, exercises) {
  printSheet(buildSheet(plan, group, exercises));
}

export function exportDayToPdf(plan, day, group, exercises) {
  printSheet(buildDaySheet(plan, day, group, exercises));
}

function printSheet(sheet) {
  const root = getPrintRoot();
  clear(root);
  root.appendChild(sheet);

  // Erst ungeskaliert messen, dann nur bei Bedarf verkleinern — so bleibt
  // der Text für kurze Pläne/Tage maximal groß. Kein unterer Anschlag für
  // den Skalierungsfaktor: "einseitig" ist eine harte Anforderung, ein
  // sehr umfangreicher Plan mit kleinerer Schrift ist besser als eine
  // zweite Seite. Bewusst `zoom` statt `transform: scale()`: transform
  // ist reines Paint-scaling und ändert die Layout-Box nicht, wodurch
  // Chromiums Druck-Paginierung weiterhin mit der ungeskalierten Höhe
  // rechnet und trotzdem eine zweite Seite anlegt — zoom verkleinert die
  // Box auch für die Seitenumbruch-Berechnung. Der 3%-Sicherheitsabschlag
  // fängt ab, dass die gemessene Breite (190mm) minimal von der
  // tatsächlichen Druckbreite abweichen kann.
  const naturalHeight = sheet.scrollHeight;
  const targetHeight = (PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX;
  if (naturalHeight > targetHeight) {
    const scale = (targetHeight / naturalHeight) * 0.97;
    // Breite vor dem Zoomen gegenläufig vergrößern, damit der Inhalt
    // danach wieder die volle Seitenbreite ausfüllt statt zu schrumpfen.
    sheet.style.width = `${SHEET_WIDTH_MM / scale}mm`;
    sheet.style.zoom = String(scale);
  }

  // Safari nimmt den Druck-Snapshot manchmal auf, bevor die obige
  // Style-Änderung (Breite/zoom) tatsächlich in ein neues Layout
  // eingeflossen ist, und druckt dann noch die ungeskalierte Fassung —
  // dadurch laufen gerade lange Trainingstage (die überhaupt erst
  // herunterskaliert werden müssen) auf eine zweite Seite über. Chrome/
  // Firefox layouten vor dem Druck synchron neu, Safari braucht dafür
  // einen Tick Verzögerung.
  setTimeout(() => window.print(), 50);
}

function buildSheet(plan, group, exercises) {
  const days = (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = days.reduce((sum, d) => sum + totalDistance(d.sets || []), 0);

  const sheet = el('div', { class: 'plan-print-sheet' });
  sheet.appendChild(el('div', { class: 'print-head' }, [
    el('h1', { class: 'print-title' }, plan.name),
    el('div', { class: 'print-sub' }, [
      group?.name || t('plans.noGroup'),
      ' · ',
      t('plans.weekFrom', { date: fmtDateLong(plan.weekStart) }),
      ' · ',
      t('plans.totalMeters', { m: total }),
    ]),
  ]));

  const daysHost = el('div', { class: 'print-days' });
  if (days.length === 0) {
    daysHost.appendChild(el('div', { class: 'print-empty' }, t('plans.noSetsPlanned')));
  } else {
    days.forEach(day => daysHost.appendChild(buildDayColumn(day, exercises)));
  }
  sheet.appendChild(daysHost);

  return sheet;
}

// Einzeltag-Ansicht: volle Seitenbreite statt Mehrspalten-Raster, damit
// Übungsname/Distanz/Wiederholungen für einen einzelnen Tag noch größer
// dargestellt werden können als in der Wochenübersicht.
function buildDaySheet(plan, day, group, exercises) {
  const sheet = el('div', { class: 'plan-print-sheet plan-print-sheet-solo' });
  sheet.appendChild(el('div', { class: 'print-head' }, [
    el('h1', { class: 'print-title' }, plan.name),
    el('div', { class: 'print-sub' }, `${group?.name || t('plans.noGroup')} · ${t('plans.weekFrom', { date: fmtDateLong(plan.weekStart) })}`),
  ]));
  const daysHost = el('div', { class: 'print-days-solo' });
  daysHost.appendChild(buildDayColumn(day, exercises));
  sheet.appendChild(daysHost);
  return sheet;
}

function buildDayColumn(day, exercises) {
  const col = el('div', { class: 'print-day' });
  col.appendChild(el('div', { class: 'print-day-head' }, [
    el('span', { class: 'print-day-date' }, fmtDateLong(day.date)),
    el('span', { class: 'print-day-total' }, `${totalDistance(day.sets || [])} m`),
  ]));
  const list = el('div', { class: 'print-entry-list' });
  const sets = day.sets || [];
  if (sets.length === 0) list.appendChild(el('div', { class: 'print-empty' }, t('plans.noSetsPlanned')));
  sets.forEach(entry => list.appendChild(buildEntryNode(entry, exercises)));
  col.appendChild(list);
  return col;
}

// Wiederholungsblöcke ("3x [...]") bekommen eine eigene, umrandete Box
// mit Multiplikator-Kennzeichnung statt in der Liste unterzugehen —
// genau das erwartete visuelle Muster für "Achte auf wiederholte Blöcke".
function buildEntryNode(entry, exercises) {
  if (entry.kind === 'block') {
    const box = el('div', { class: 'print-block' });
    box.appendChild(el('div', { class: 'print-block-head' },
      t('plans.repeatBlockLabel', { n: entry.repeatCount || 1 }) + (entry.label ? ` — ${entry.label}` : '')));
    const inner = el('div', { class: 'print-entry-list print-block-list' });
    (entry.sets || []).forEach(s => inner.appendChild(buildSetRow(s, exercises)));
    box.appendChild(inner);
    return box;
  }
  return buildSetRow(entry, exercises);
}

function buildSetRow(entrySet, exercises) {
  const name = entrySet.description || exerciseName(entrySet, exercises) || '—';
  const row = el('div', { class: 'print-entry' }, [
    el('span', { class: 'print-entry-qty' }, `${entrySet.reps || 1}×${entrySet.distance ?? '—'} m`),
    el('span', { class: 'print-entry-name' }, name),
  ]);
  // Pause nur anzeigen, wenn tatsächlich eine geplant ist — bei 0s (z. B.
  // Ein-/Ausschwimmen) würde "Pause: 0s" auf jeder Zeile nur Rauschen
  // erzeugen, ohne den Trainer:innen etwas Neues zu sagen.
  if (entrySet.restSec > 0) {
    row.appendChild(el('span', { class: 'print-entry-rest' }, `${t('plans.colRest')}: ${entrySet.restSec}s`));
  }
  return row;
}

function exerciseName(entrySet, exercises) {
  if (!entrySet.exerciseId) return '';
  return (exercises || []).find(x => x.id === entrySet.exerciseId)?.name || '';
}
