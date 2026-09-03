// ============================================================
// charts.js — minimales SVG-Linien-/Balkendiagramm (ohne externe
// Abhängigkeit, offlinefähig).
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung). Diese beiden
// Diagramm-Generatoren waren zuvor Teil des einen großen Sammelmoduls,
// obwohl nur die Statistik-Ansicht (modules/stats.js) sie tatsächlich
// braucht — jedes andere Modul zog sie über utils.js dennoch mit.
// ============================================================
import { el } from './dom.js';
import { t } from './i18n.js';

// Nur für ELEMENT-INHALTE gedacht (Text zwischen zwei Tags, z. B.
// `<title>${esc(x)}</title>` unten) — nicht für Attributwerte (z. B.
// `title="${esc(x)}"`). Der Browser escaped beim Serialisieren eines
// Textknotens zurück zu HTML bewusst nur "&"/"<"/">" — Anführungszeichen
// haben in Element-Inhalten keine syntaktische Bedeutung, dort also
// korrekt und ausreichend. Für einen Attributwert reicht das NICHT: ein
// "'"/'"' im Wert könnte das Attribut aufbrechen — dafür müsste der Wert
// stattdessen als Attribut über el() (siehe dom.js) gesetzt werden, das
// per node.setAttribute() geht und damit automatisch korrekt/vollständig
// escapt, statt esc() für einen String-zusammengebauten Attributwert zu
// missbrauchen.
//
// Nicht exportiert: wird ausschließlich von den beiden Diagramm-Buildern
// unten genutzt, nirgendwo sonst im Frontend importiert.
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// Sicherheitshärtung (Code-Review 2026-09-02, Befund P2): `color`/
// `b.color` landen unten direkt in einem SVG-ATTRIBUTWERT
// (`fill="${...}"`/`stroke="${...}"`), nicht in einem Element-INHALT —
// esc() oben wäre dafür ohnehin die falsche Funktion (siehe dessen
// Kommentar), aber selbst eine reine Anführungszeichen-Escapierung genügte
// hier nicht: ein Wert wie `x" onload="alert(1)` bräche nicht aus einem
// Textknoten aus, sondern schleuste ein zusätzliches Element-Attribut
// (inkl. Event-Handler) ein, sobald `wrap.innerHTML = ...` den String
// unten erneut parst. Alle heutigen Aufrufer (modules/stats.js,
// modules/times.js) übergeben ausschließlich feste CSS-Custom-Property-
// Referenzen oder Hex-Farben — genau dieses enge Format wird hier
// erzwungen; jeder abweichende Wert fällt auf den übergebenen
// Standardfarbwert zurück, statt unverändert in die Ausgabe
// durchgereicht zu werden.
const SAFE_COLOR_RE = /^(var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z0-9]*)$/;
function safeColor(value, fallback) {
  return typeof value === 'string' && SAFE_COLOR_RE.test(value) ? value : fallback;
}

export function svgLineChart({ points, width = 560, height = 200, yFormat, color = 'var(--c-chlorine-d)', invertY = false }) {
  color = safeColor(color, 'var(--c-chlorine-d)');
  const pad = { l: 46, r: 14, t: 16, b: 26 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  if (!points.length) return el('div', { class: 'empty-state' }, t('stats.noDataTitle'));
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
      <text x="${pad.l - 8}" y="${y + 3}" font-size="10" text-anchor="end" fill="var(--c-slate)">${esc(yFormat ? yFormat(val) : val.toFixed(1))}</text>`;
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
  color = safeColor(color, 'var(--c-petrol)');
  const pad = { l: 46, r: 14, t: 16, b: 34 };
  const w = width - pad.l - pad.r, hgt = height - pad.t - pad.b;
  if (!bars.length) return el('div', { class: 'empty-state' }, t('stats.noDataTitle'));
  const max = Math.max(1, ...bars.map(b => b.value));
  const bw = w / bars.length;
  const rects = bars.map((b, i) => {
    const bh = (b.value / max) * hgt;
    const x = pad.l + i * bw + bw * 0.15;
    const y = pad.t + (hgt - bh);
    const barColor = safeColor(b.color, color);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${barColor}">
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
