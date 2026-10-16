// "Plan drucken" für Trainingspläne.
//
// Kein PDF-Vendor-Code nötig: baut eine eigene, druckoptimierte Ansicht
// des Plans auf (großer, kontrastreicher Text, Wiederholungsblöcke als
// eigene Boxen) und ruft window.print() auf — der Nutzer wählt im
// Druckdialog "Als PDF speichern". Funktioniert komplett offline, ohne
// zusätzliche Bibliothek und ohne Build-Schritt.
//
// "Einseitig" wird durch Messen + notfalls Herunterskalieren erzwungen:
// der Inhalt wird zunächst in natürlicher Größe aufgebaut, dann gegen
// die verfügbare A4-Druckhöhe geprüft; passt er nicht, werden Schrift und
// Abstände über --print-scale so weit verkleinert, dass er auf eine Seite
// passt.
//
// Neben dem ganzen Wochenplan (exportPlanToPdf) lässt sich auch ein
// einzelner Trainingstag drucken (exportDayToPdf) — z. B. um nur den
// heutigen Zettel poolside auszudrucken statt der ganzen Woche. Der
// Einzeltag bekommt die volle Seitenbreite statt der Mehrspalten-Ansicht,
// dadurch bleiben Übungsname/Distanz/Wiederholungen noch größer.
import { el, clear } from '../dom.js';
import { fmtDateLong } from '../dates.js';
import { totalDistance, totalDuration, formatTotalDuration, formatQuantity, exerciseById, equipmentForEntry } from './setEditor.js';
import { EQUIPMENT_ITEMS, SET_INTENSITIES, COURSES } from '../refdata.js';
import { t, trLabel } from '../i18n.js';

const MM_TO_PX = 96 / 25.4;
const PAGE_HEIGHT_MM = 297;
// @page-Rand aus css/styles.css. Die Blattbreite (A4 minus diesen Rand,
// 186mm) steht fest in .plan-print-page/.plan-print-sheet dort, damit die
// Vorab-Messung auf derselben Breite läuft wie der Druck (Issue #76).
const PAGE_MARGIN_MM = 12;

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
  const page = el('div', { class: 'plan-print-page' });
  page.appendChild(sheet);
  root.appendChild(page);

  // Erst ungeskaliert messen, dann nur bei Bedarf verkleinern — so bleibt
  // der Text für kurze Pläne/Tage maximal groß. Kein unterer Anschlag für
  // den Skalierungsfaktor: "einseitig" ist eine harte Anforderung, ein
  // sehr umfangreicher Plan mit kleinerer Schrift ist besser als eine
  // zweite Seite. Der 3%-Sicherheitsabschlag fängt verbleibende
  // Rundungsungenauigkeiten zwischen CSS-mm und Druck-px ab.
  //
  // Verkleinert wird über --print-scale (siehe .plan-print-sheet in
  // styles.css), also echtes Layout statt transform: scale(). Mit transform
  // paginierte iOS-Safari die unskalierte Layout-Box, hielt den Inhalt für
  // höher als eine Seite und schob die Übungsliste auf eine zweite Seite.
  // CSS `zoom` scheidet ebenfalls aus, Safari wendet es beim Druck nicht
  // zuverlässig an.
  alignEntryColumns(sheet);
  const naturalHeight = sheet.scrollHeight;
  const targetHeight = (PAGE_HEIGHT_MM - PAGE_MARGIN_MM * 2) * MM_TO_PX;
  const maxHeight = targetHeight * 0.97;
  if (naturalHeight > maxHeight) {
    // Bei gleicher Blattbreite bricht kleinere Schrift seltener um, die
    // Höhe sinkt also mindestens proportional zum Faktor: maxHeight /
    // naturalHeight passt sicher. Per Bisektion zwischen diesem Startwert
    // und 1 den größten Faktor suchen, der noch auf eine Seite passt.
    const fits = (s) => {
      sheet.style.setProperty('--print-scale', String(s));
      return sheet.scrollHeight <= maxHeight;
    };
    let scale = maxHeight / naturalHeight;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = (scale + hi) / 2;
      if (fits(mid)) scale = mid; else hi = mid;
    }
    sheet.style.setProperty('--print-scale', String(scale));
  }
  // Letzte Absicherung, falls ein Browser im Druck doch anders umbricht
  // als hier gemessen: lieber unten abschneiden als eine zweite Seite. Nur
  // max-height statt fester Höhe, damit die Box nicht höher als der Inhalt
  // ist — iOS-Safari verkleinert die Seite für Kopf-/Fußzeile und schob
  // eine volle 273mm-Box sonst knapp auf eine leere zweite Seite.
  page.style.maxHeight = `${targetHeight}px`;
  page.style.overflow = 'hidden';

  // Safari nimmt den Druck-Snapshot manchmal auf, bevor die obigen
  // Style-Änderungen tatsächlich in ein neues Layout eingeflossen sind, und
  // druckt dann noch die ungeskalierte Fassung — dadurch laufen gerade lange
  // Trainingstage (die überhaupt erst herunterskaliert werden müssen) auf
  // eine zweite Seite über. Chrome/Firefox layouten vor dem Druck synchron
  // neu, Safari braucht dafür einen Tick Verzögerung.
  setTimeout(() => window.print(), 50);
}

// Jede .print-entry ist ein eigenes Grid, deren Spalten ohne Hilfe nur
// so breit wären wie Menge/Intensität der jeweiligen Zeile — der
// Übungsname begänne dann in jeder Zeile an einer anderen Stelle. Darum
// einmal die breiteste Menge und Intensität des Blatts messen (beide
// Spans sind per justify-self:start nur so breit wie ihr Text) und als
// gemeinsame Spaltenbreiten setzen (siehe .print-entry in styles.css).
// Läuft vor der Höhenmessung in printSheet() bei --print-scale 1; die
// Breiten werden mit --print-scale multipliziert und skalieren so mit der
// Schrift mit.
function alignEntryColumns(sheet) {
  const maxWidth = (selector) => Math.max(0,
    ...Array.from(sheet.querySelectorAll(selector), node => node.getBoundingClientRect().width));
  const qty = maxWidth('.print-entry-qty');
  const intensity = maxWidth('.print-entry-intensity');
  if (qty === 0 && intensity === 0) return;
  sheet.style.setProperty('--print-qty-w', `calc(${Math.ceil(qty)}px * var(--print-scale, 1))`);
  sheet.style.setProperty('--print-int-w', `calc(${Math.ceil(intensity)}px * var(--print-scale, 1))`);
}

function buildSheet(plan, group, exercises) {
  const days = (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  // Ein Plan mit genau einem Tag bekommt dieselbe Einzeltag-Ansicht wie der
  // explizite "Diesen Tag drucken"-Button (buildDaySheet) statt des
  // Mehrspalten-Rasters unten — sonst reserviert grid-auto-fill weiterhin
  // Platz für nicht vorhandene weitere Spalten, und derselbe Trainingstag
  // sieht je nachdem, über welchen Button er gedruckt wurde, unterschiedlich
  // aus (schmaler/kleiner hier vs. volle Breite/große Schrift dort).
  if (days.length === 1) return buildDaySheet(plan, days[0], group, exercises);
  const total = days.reduce((sum, d) => sum + totalDistance(d.sets || []), 0);
  const totalTime = days.reduce((sum, d) => sum + totalDuration(d.sets || []), 0);

  const sheet = el('div', { class: 'plan-print-sheet' });
  sheet.appendChild(el('div', { class: 'print-head' }, [
    el('h1', { class: 'print-title' }, plan.name),
    el('div', { class: 'print-sub' }, [
      group?.name || t('plans.noGroup'),
      ' · ',
      t('plans.weekFrom', { date: fmtDateLong(plan.weekStart) }),
      ' · ',
      t('plans.totalMeters', { m: total }),
      ...(totalTime > 0 ? [' · ', t('plans.planTotalDuration', { duration: formatTotalDuration(totalTime) })] : []),
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
  const sheet = el('div', { class: 'plan-print-sheet' });
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
  const dayDuration = totalDuration(day.sets || []);
  col.appendChild(el('div', { class: 'print-day-head' }, [
    el('span', { class: 'print-day-date' }, day.poolLength
      ? `${fmtDateLong(day.date)} · ${trLabel(COURSES, day.poolLength, 'courses')}`
      : fmtDateLong(day.date)),
    el('span', { class: 'print-day-total' }, dayDuration > 0
      ? `${totalDistance(day.sets || [])} m · ${formatTotalDuration(dayDuration)}`
      : `${totalDistance(day.sets || [])} m`),
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
// Ein Abschnitt bekommt stattdessen eine Überschriftenzeile mit
// Zwischensumme, gefolgt von seinen eigenen Einträgen (rekursiv über
// buildEntryNode — dadurch werden Blöcke INNERHALB eines Abschnitts genau
// wie auf oberster Ebene als eigene Box dargestellt).
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
  if (entry.kind === 'section') {
    const box = el('div', { class: 'print-section' });
    box.appendChild(el('div', { class: 'print-section-head' }, [
      el('span', { class: 'print-section-heading' }, entry.heading || t('plans.defaultSectionHeading')),
      el('span', { class: 'print-section-total' }, `${totalDistance(entry.entries || [])} m`),
    ]));
    const inner = el('div', { class: 'print-entry-list' });
    (entry.entries || []).forEach(e => inner.appendChild(buildEntryNode(e, exercises)));
    box.appendChild(inner);
    return box;
  }
  return buildSetRow(entry, exercises);
}

function buildSetRow(entrySet, exercises) {
  const name = entrySet.description || exerciseName(entrySet, exercises) || '—';
  const row = el('div', { class: 'print-entry' }, [
    el('span', { class: 'print-entry-qty' }, formatQuantity(entrySet)),
    el('span', { class: 'print-entry-intensity' }, trLabel(SET_INTENSITIES, entrySet.intensity || 'ga1', 'setIntensities')),
    el('span', { class: 'print-entry-name' }, name),
  ]);
  // Pause nur anzeigen, wenn tatsächlich eine geplant ist — bei 0s (z. B.
  // Ein-/Ausschwimmen) würde "Pause: 0s" auf jeder Zeile nur Rauschen
  // erzeugen, ohne den Trainer:innen etwas Neues zu sagen.
  if (entrySet.restSec > 0) {
    row.appendChild(el('span', { class: 'print-entry-rest' }, `${t('plans.colRest')}: ${entrySet.restSec}s`));
  }
  // Material nur anzeigen, wenn tatsächlich welches gebraucht wird — eigene
  // Rasterzeile unter dem Namen (siehe .print-entry-equipment in
  // styles.css), damit eine womöglich lange Materialliste die kompakte
  // erste Zeile (Menge/Intensität/Name/Pause) nicht sprengt.
  const equipment = equipmentForEntry(entrySet, exercises);
  if (equipment.length > 0) {
    row.appendChild(el('span', { class: 'print-entry-equipment' },
      `${t('setEditor.equipmentSummary')} ${equipment.map(eq => trLabel(EQUIPMENT_ITEMS, eq, 'equipment')).join(', ')}`));
  }
  return row;
}

function exerciseName(entrySet, exercises) {
  if (!entrySet.exerciseId) return '';
  return exerciseById(exercises).get(entrySet.exerciseId)?.name || '';
}
