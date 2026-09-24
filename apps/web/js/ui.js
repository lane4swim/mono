// kleine UI-Bausteine (liefern DOM-Knoten), Toast-Meldungen,
// und die paar generischen Array-/Objekt-Helfer, die keine eigene Datei
// rechtfertigen.
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

// ---- Tabs innerhalb eines Moduls ----
// Teilt eine Modulseite mit mehreren fachlich getrennten Aufgaben (z. B.
// Nutzerverwaltung: Mitglieder / Verein / Einladungen) in Reiter auf.
// `tabs`: [{ id, label, render: () => Node }] — falsy Einträge werden
// übersprungen, damit Aufrufer rollenabhängige Reiter direkt inline als
// `cond && {...}` angeben können. Bleibt nur ein Reiter übrig, entfällt
// die Reiterleiste ganz (z. B. Qualifikationen für Nicht-Admins).
//
// Panels werden erst beim ersten Aktivieren gebaut und danach nur noch
// ein-/ausgeblendet — so bleiben halb ausgefüllte Formulare beim Wechsel
// erhalten, und teure Abrufe eines Reiters laufen nur, wenn er geöffnet
// wird. Der aktive Reiter je `key` bleibt für die Sitzung gemerkt, damit
// ein refresh() nach dem Speichern (baut die ganze Ansicht neu) oder ein
// Hin- und Zurücknavigieren nicht jedes Mal auf den ersten Reiter springt.
const activeTabByKey = new Map();

export function tabbedView(key, tabs) {
  const list = tabs.filter(Boolean);
  if (list.length === 0) return el('div');
  if (list.length === 1) return list[0].render();

  const wrap = el('div', { class: 'tabs' });
  const bar = el('div', { class: 'tab-bar', role: 'tablist' });
  const panels = new Map();
  const buttons = new Map();

  function select(id, focus = false) {
    activeTabByKey.set(key, id);
    for (const tab of list) {
      const isActive = tab.id === id;
      const btn = buttons.get(tab.id);
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
      if (isActive && !panels.has(tab.id)) {
        const panel = el('div', { class: 'tab-panel', role: 'tabpanel', id: `tabpanel-${key}-${tab.id}`, 'aria-labelledby': `tab-${key}-${tab.id}` }, tab.render());
        panels.set(tab.id, panel);
        wrap.appendChild(panel);
      }
      if (panels.has(tab.id)) panels.get(tab.id).hidden = !isActive;
    }
    if (focus) buttons.get(id).focus();
  }

  list.forEach((tab, i) => {
    const btn = el('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${key}-${tab.id}`, 'aria-controls': `tabpanel-${key}-${tab.id}`,
      onclick: () => select(tab.id),
      onkeydown: (e) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        select(list[(i + delta + list.length) % list.length].id, true);
      },
    }, tab.label);
    buttons.set(tab.id, btn);
    bar.appendChild(btn);
  });
  wrap.appendChild(bar);

  const remembered = activeTabByKey.get(key);
  select(list.some(tab => tab.id === remembered) ? remembered : list[0].id);
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
