// ============================================================
// swimTime.js — Schwimmzeit-Formatierung: Sekunden (Fließkommazahl)
// <-> "mm:ss.cc".
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
export function secToTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const sStr = s.toFixed(2).padStart(5, '0');
  return m > 0 ? `${m}:${sStr}` : `${s.toFixed(2)}`;
}
export function timeToSec(str) {
  if (!str) return null;
  str = String(str).trim().replace(',', '.');
  if (str.includes(':')) {
    const [m, s] = str.split(':');
    return parseFloat(m) * 60 + parseFloat(s);
  }
  return parseFloat(str);
}
