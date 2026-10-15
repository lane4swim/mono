// Fristen eines Wettkampfs (reine Logik, ohne DOM — direkt testbar):
//   - entryDeadline:     externer Meldeschluss (Abgabe der Startliste beim
//                        Veranstalter), optional;
//   - selectionDeadline: interne Frist für die Auswahl der Starts, optional.
//
// Vorschlagswert für die interne Frist: eine Woche vor dem Meldeschluss,
// ohne Meldeschluss drei Wochen vor dem Wettkampf. Er wird nur im Formular
// vorbelegt (modules/competitions.js) — gespeichert wird, was dort steht.
import { dateOnly, isoAddDays } from '../dates.js';

export const SELECTION_DAYS_BEFORE_ENTRY_DEADLINE = 7;
export const SELECTION_DAYS_BEFORE_COMPETITION = 21;

// Liefert "YYYY-MM-DD" oder '' (weder Wettkampfdatum noch Meldeschluss).
export function defaultSelectionDeadline({ date, entryDeadline } = {}) {
  if (entryDeadline) return isoAddDays(entryDeadline, -SELECTION_DAYS_BEFORE_ENTRY_DEADLINE);
  if (date) return isoAddDays(date, -SELECTION_DAYS_BEFORE_COMPETITION);
  return '';
}

// Fehlerschlüssel (i18n, competitions.*) oder null. Beide Fristen dürfen
// fehlen; gesetzt dürfen sie nicht nach dem Wettkampf liegen, und die
// interne Auswahl nicht nach dem externen Meldeschluss.
export function validateDeadlines({ date, entryDeadline, selectionDeadline } = {}) {
  const d = dateOnly(date);
  const entry = dateOnly(entryDeadline);
  const selection = dateOnly(selectionDeadline);
  if (entry && d && entry > d) return 'validationEntryDeadline';
  if (selection && d && selection > d) return 'validationSelectionDeadline';
  if (selection && entry && selection > entry) return 'validationSelectionAfterEntry';
  return null;
}
