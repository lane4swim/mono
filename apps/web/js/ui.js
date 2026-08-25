// ============================================================
// ui.js — kleine UI-Bausteine (liefern DOM-Knoten), Toast-Meldungen,
// und die paar generischen Array-/Objekt-Helfer, die keine eigene Datei
// rechtfertigen.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung). `groupBy`/`average`
// gehören inhaltlich zu keinem der übrigen sechs Dateien — hier
// mituntergebracht, statt für zwei kleine Funktionen eine achte Datei
// anzulegen.
// ============================================================
import { el } from './dom.js';

export function badge(text, variant = 'neutral') {
  return el('span', { class: `badge badge-${variant}` }, text);
}

export function statCard({ label, value, sub, alt }) {
  return el('div', { class: `stat-card ${alt ? 'alt' : ''}` }, [
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, value),
    sub ? el('div', { class: 'stat-sub' }, sub) : null,
  ]);
}

export function emptyState(title, desc, actionNode) {
  return el('div', { class: 'empty-state' }, [
    laneWave(),
    el('h3', {}, title),
    el('p', {}, desc),
    actionNode || null,
  ]);
}

export function laneWave(onDark){
  const wrap = el('div', { class: 'divider-wave' });
  wrap.innerHTML = `<svg class="lanewave ${onDark ? 'on-dark' : ''}" viewBox="0 0 240 16" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 8c10 0 10-6 20-6s10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;
  return wrap;
}

// ---- Toast-Meldungen ----
export function toast(msg, variant = 'info') {
  const host = document.getElementById('toast-region');
  if (!host) return;
  const node = el('div', { class: `toast ${variant === 'error' ? 'err' : ''}` }, msg);
  host.appendChild(node);
  setTimeout(() => { node.style.transition = 'opacity .25s'; node.style.opacity = '0'; setTimeout(() => node.remove(), 260); }, 3000);
}

export function fullName(athlete){
  if (!athlete) return '—';
  return `${athlete.firstName || ''} ${athlete.lastName || ''}`.trim();
}

export function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] ||= []).push(item);
  }
  return out;
}

export function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
