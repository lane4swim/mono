// ============================================================
// utils.js — shared helpers used across all modules
// ============================================================
import { t, getLocale } from './i18n.js';

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- DOM builder ----
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}
export const h = el;

export function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

export function clear(node){ while (node.firstChild) node.removeChild(node.firstChild); }

// ---- Render guard ----
// Modules call `const isCurrent = beginRender(container)` at the very
// start of their render(). After any `await` (data fetching), a module
// should check `if (!isCurrent()) return;` before touching the DOM again.
// This prevents a stale, slower render call — e.g. one superseded by a
// second render triggered right after it (such as a locale change firing
// two change events back-to-back) — from appending content after a newer
// render has already drawn the view, which is what caused duplicated
// module content on language switch.
const renderTokens = new WeakMap();
export function beginRender(container) {
  const token = Symbol('render');
  renderTokens.set(container, token);
  return () => renderTokens.get(container) === token;
}

// ---- Dates ----
export function todayISO() { return new Date().toISOString().slice(0, 10); }
export function nowISO(){ return new Date().toISOString(); }
export function fmtDateLong(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(getLocale(), { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function isoAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function startOfWeek(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
export function ageFromBirthdate(iso){
  if (!iso) return null;
  const b = new Date(iso + 'T00:00:00'), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}

// ---- Swim time formatting: seconds (float) <-> "mm:ss.cc" ----
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

// ---- Small UI components (return DOM nodes) ----
export function avatarInitials(name) {
  const initials = (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return el('span', { class: 'avatar' }, initials || '?');
}

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
    <path d="M0 8c10 0 10-6 20-6s10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6 10-6 20-6 10 6 20 6" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;
  return wrap;
}

// ---- Toasts ----
export function toast(msg, variant = 'info') {
  const host = document.getElementById('toast-region');
  if (!host) return;
  const t = el('div', { class: `toast ${variant === 'error' ? 'err' : ''}` }, msg);
  host.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, 3000);
}

// ---- Modal ----
export function openModal({ title, bodyNode, wide }) {
  const root = document.getElementById('modal-root');
  clear(root);
  const box = el('div', { class: 'modal-box', style: wide ? 'max-width:820px' : '' }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { class: 'mt-0' }, title),
      el('button', { class: 'modal-close', 'aria-label': t('common.close'), onclick: () => close() }, '×'),
    ]),
    bodyNode,
  ]);
  root.appendChild(box);
  root.hidden = false;
  function onBackdrop(e){ if (e.target === root) close(); }
  root.addEventListener('click', onBackdrop);
  function onKey(e){ if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() {
    root.hidden = true; clear(root);
    root.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  }
  return { close, box };
}

export function confirmAction(message, onConfirm, opts = {}) {
  const body = el('div', {}, [
    el('p', {}, message),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn btn-danger', onclick: () => { close(); onConfirm(); } }, opts.confirmLabel || t('common.delete')),
    ]),
  ]);
  const { close } = openModal({ title: opts.title || t('common.confirmTitle'), bodyNode: body });
}

// ---- Form field helpers ----
export function field(labelText, inputNode, opts = {}) {
  return el('div', { class: `field ${opts.span2 ? 'span-2' : ''}` }, [
    el('label', {}, labelText),
    inputNode,
    opts.hint ? el('div', { class: 'hint' }, opts.hint) : null,
  ]);
}

export function textInput(value = '', attrs = {}) {
  return el('input', { type: 'text', value: value ?? '', ...attrs });
}
export function selectInput(options, value, attrs = {}) {
  const sel = el('select', attrs);
  for (const opt of options) {
    const o = el('option', { value: opt.value }, opt.label);
    if (String(opt.value) === String(value)) o.setAttribute('selected', '');
    sel.appendChild(o);
  }
  return sel;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
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

export function fullName(athlete){
  if (!athlete) return '—';
  return `${athlete.firstName || ''} ${athlete.lastName || ''}`.trim();
}

// ---- Minimal SVG line/bar chart (no external dependency, offline-safe) ----
export function svgLineChart({ points, width = 560, height = 200, yFormat, color = 'var(--c-chlorine-d)', invertY = false }) {
  const pad = { l: 46, r: 14, t: 16, b: 26 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  if (!points.length) return el('div', { class: 'empty-state' }, t('stats.noDataTitle'));
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.y);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad_ = (yMax - yMin) * 0.12;
  yMin -= pad_; yMax += pad_;
  const xFor = (i) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const yFor = (y) => {
    const t = (y - yMin) / (yMax - yMin);
    return invertY ? pad.t + t * hgt : pad.t + (1 - t) * hgt;
  };
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.y).toFixed(1)}`).join(' ');
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = pad.t + t * hgt;
    const val = invertY ? yMin + t * (yMax - yMin) : yMax - t * (yMax - yMin);
    return `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}" stroke="var(--c-line)" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${y + 3}" font-size="10" text-anchor="end" fill="var(--c-slate)">${yFormat ? yFormat(val) : val.toFixed(1)}</text>`;
  }).join('');
  const dots = points.map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.y).toFixed(1)}" r="3.5" fill="${color}">
    <title>${esc(p.label || '')}: ${esc(yFormat ? yFormat(p.y) : String(p.y))}</title></circle>`).join('');
  const labels = points.map((p, i) => {
    if (points.length > 8 && i % Math.ceil(points.length / 8) !== 0) return '';
    return `<text x="${xFor(i).toFixed(1)}" y="${height - 6}" font-size="10" text-anchor="middle" fill="var(--c-slate)">${esc(p.label || '')}</text>`;
  }).join('');
  const wrap = el('div', { class: 'chart-box' });
  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    ${gridLines}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${labels}
  </svg>`;
  return wrap;
}

export function svgBarChart({ bars, width = 560, height = 200, color = 'var(--c-petrol)', yFormat }) {
  const pad = { l: 46, r: 14, t: 16, b: 34 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  if (!bars.length) return el('div', { class: 'empty-state' }, t('stats.noDataTitle'));
  const max = Math.max(1, ...bars.map(b => b.value));
  const bw = w / bars.length;
  const rects = bars.map((b, i) => {
    const bh = (b.value / max) * hgt;
    const x = pad.l + i * bw + bw * 0.15;
    const y = pad.t + (hgt - bh);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${b.color || color}">
      <title>${esc(b.label)}: ${esc(yFormat ? yFormat(b.value) : String(b.value))}</title></rect>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${height - 10}" font-size="10" text-anchor="middle" fill="var(--c-slate)">${esc(b.label)}</text>`;
  }).join('');
  const wrap = el('div', { class: 'chart-box' });
  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <line x1="${pad.l}" x2="${width - pad.r}" y1="${pad.t + hgt}" y2="${pad.t + hgt}" stroke="var(--c-line)" stroke-width="1"/>
    ${rects}
  </svg>`;
  return wrap;
}
