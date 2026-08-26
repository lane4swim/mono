// ============================================================
// dates.js — Datumsrechnung/-formatierung.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
import { getLocale } from './i18n.js';

// ---- Datumsangaben ----
export function todayISO() { return new Date().toISOString().slice(0, 10); }
// Reine Datumsfelder (birthdate, joinDate, weekStart, dueDate, …) werden
// serverseitig als vollständiger ISO-Zeitstempel geführt (siehe
// packages/shared-types/src/entities.ts: `isoDate`/`nullableIsoDate` sind
// `z.string().datetime()`, kein reines Datum) — nach einer Synchronisierung
// liegt so ein Feld hier also z. B. als "2026-09-03T00:00:00.000Z" vor,
// während frisch aus einem <input type="date"> stammende Werte weiterhin
// bloß "2026-09-03" sind. `dateOnly()` reduziert BEIDE Formen einheitlich
// auf die reinen 10 Zeichen "YYYY-MM-DD" — das ist der einzige Wert, den
// <input type="date"> als value akzeptiert (ein vollständiger Zeitstempel
// bliebe dort sonst leer), und die sichere Grundlage für die folgenden
// Datums-Hilfsfunktionen. Das Gegenstück `toIsoDateTime()` (siehe unten)
// wandelt einen aus einem <input type="date"> stammenden Wert vor dem
// Speichern zurück in das kanonische, vom Backend erwartete Format.
export function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}
// Kanonisches Speicherformat für ein reines Datumsfeld: wandelt den
// "YYYY-MM-DD"-Wert eines <input type="date"> in einen vollständigen
// ISO-Zeitstempel (UTC-Mitternacht) — genau das Format, das die
// Entity-Schemas beim Sync-Push verlangen (siehe oben). Ohne diese
// Umwandlung würde ein per Formular gesetztes Datum beim nächsten
// Sync-Push mit "Payload entspricht nicht dem Schema" abgelehnt.
export function toIsoDateTime(dateOnlyStr) {
  return dateOnlyStr ? new Date(dateOnly(dateOnlyStr) + 'T00:00:00.000Z').toISOString() : null;
}
export function fmtDateLong(iso) {
  if (!iso) return '—';
  const d = new Date(dateOnly(iso) + 'T00:00:00');
  return d.toLocaleDateString(getLocale(), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(dateOnly(iso) + 'T00:00:00');
  return d.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
// Datum + Uhrzeit — für Zeitstempel, bei denen (anders als bei den obigen
// reinen Datumsfeldern) die Uhrzeit selbst Teil der Information ist, z. B.
// Kommentar-Zeitstempel (`createdAt` ist ein vollständiger ISO-Zeitstempel,
// keine reine Datumsangabe wie `weekStart`/`date`).
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function isoAddDays(iso, n) {
  const d = new Date(dateOnly(iso) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function startOfWeek(iso) {
  const d = new Date(dateOnly(iso) + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
export function ageFromBirthdate(iso){
  if (!iso) return null;
  const b = new Date(dateOnly(iso) + 'T00:00:00'), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}
