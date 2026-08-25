// ============================================================
// dom.js — ID-Erzeugung, DOM-Baukasten, Render-Absicherung.
//
// Code-Review, Befund L4: aus utils.js herausgelöst — utils.js war ein
// 360-Zeilen-Sammelmodul aus rund zehn zusammenhanglosen Themen, von 23
// der 30 Frontend-Dateien importiert. Ein Modul, das nur eine einzelne
// Funktion von hier braucht, zieht dadurch keine Diagramm-Generatoren
// oder Modal-Mechanik mehr mit.
// ============================================================

// Nicht für Primärschlüssel fachlicher Entitäten (athletes.id, results.id, …)
// gedacht — die Entity-Schemas (packages/shared-types/src/entities.ts)
// verlangen dafür `z.string().uuid()`; diese Funktion erzeugt bewusst KEIN
// UUID. Für Primärschlüssel siehe stattdessen db.js: uid()
// (crypto.randomUUID()). localId() ist für IDs eingebetteter,
// nicht eigenständig referenzierter Einträge gedacht (Set-/Block-Einträge
// in einem Trainingsplan, Kommentare) — deren Schemas (PlainSetSchema.id,
// RepeatBlockSchema.id, CommentSchema.id) verlangen nur `z.string()`.
export function localId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- DOM-Baukasten ----
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
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

// Eigene, explizit benannte Funktion statt eines generischen `html`-
// Attributs auf el() — der einzige tatsächliche Verwendungszweck sind
// feste, intern definierte SVG-Icon-Konstanten (ICON_*); ein generisches
// Attribut wäre unauffällig zwischen den übrigen, textContent-basierten
// Attributen versteckt und bei jedem künftigen Audit erneut als
// potenzieller XSS-Sink zu prüfen. NUR für solche fest im Code stehenden
// SVG-Strings gedacht, NIEMALS für Nutzereingaben oder Serverdaten.
export function icon(svgMarkup, attrs = {}) {
  const node = el('span', attrs);
  node.innerHTML = svgMarkup;
  return node;
}

export function clear(node){ while (node.firstChild) node.removeChild(node.firstChild); }

// ---- Render-Absicherung ----
// Module rufen `const isCurrent = beginRender(container)` ganz zu Beginn
// ihrer render()-Funktion auf. Nach jedem `await` (Datenabruf) sollte ein
// Modul `if (!isCurrent()) return;` prüfen, bevor es das DOM erneut
// anfasst. Das verhindert, dass ein veralteter, langsamerer Render-Aufruf
// — z. B. einer, der durch einen direkt danach ausgelösten zweiten Render
// überholt wurde (etwa wenn ein Sprachwechsel zwei Change-Events kurz
// hintereinander feuert) — Inhalte anhängt, nachdem ein neuerer Render
// die Ansicht bereits gezeichnet hat; genau das führte zu doppeltem
// Modulinhalt beim Sprachwechsel.
const renderTokens = new WeakMap();
export function beginRender(container) {
  const token = Symbol('render');
  renderTokens.set(container, token);
  return () => renderTokens.get(container) === token;
}
