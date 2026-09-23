// Regressionstest für Issue #82: statische Prüfung aller Dateien unter
// js/ und js/modules/ auf die in dom.js: beginRender() dokumentierte
// Konvention.
//
// Jede Funktion namens render*/refresh* (inkl. der render()-Methode der
// Modulobjekte) muss vor JEDEM Zugriff auf ihren Container, der nach einem
// `await` liegt, isCurrent() aufrufen — und zwar zwischen dem letzten
// vorangehenden `await` und dem Zugriff. Eine Prüfung nur nach dem ersten
// von zwei Abrufen reicht also nicht. Als Zugriff zählt `x.methode(...)`
// oder ein Aufruf mit `x` als erstem Argument (clear(x), renderList(x, …)),
// wobei `x` der Name `container` oder der erste Parameter der Funktion ist
// (z. B. `viewEl` in shell.js: renderRoute()). Funktionen, die über
// dom.js: redraw() neu zeichnen, enthalten selbst kein `await` und sind
// damit automatisch konform.
//
// Bewusste Grenzen dieser rein textuellen (positionsbasierten) Prüfung:
// - Kontrollfluss wird nicht ausgewertet — ein isCurrent()-Aufruf in einem
//   anderen Zweig vor dem Zugriff gilt ebenfalls als Prüfung, und ob sein
//   Ergebnis tatsächlich zu einem `return` führt, wird nicht geprüft.
// - Ein Container, der unter einem anderen Namen weitergereicht oder in
//   einer Variablen zwischengespeichert wird, bleibt unerkannt.
// - Verschachtelte Funktionen (z. B. onclick-Handler) werden getrennt nach
//   ihrem eigenen Namen beurteilt — ein anonymer Submit-Handler ist kein
//   Render-Einstiegspunkt und wird nicht geprüft.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as espree from 'espree';

const jsDir = path.resolve(fileURLToPath(import.meta.url), '../../js');
const SCANNED_DIRS = ['', 'modules'];
const RENDER_NAME = /^(render|refresh)/;

const isFunction = (node) => /Function/.test(node.type);

// Läuft durch `node`, ohne in verschachtelte Funktionen abzusteigen —
// diese werden stattdessen samt ihres Namens an onFunction gemeldet.
function walk(node, visit, onFunction, parent) {
  if (!node || typeof node.type !== 'string') return;
  if (isFunction(node) && parent !== undefined) { onFunction(node, parent); return; }
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') walk(child, visit, onFunction, node);
    }
  }
}

function functionName(fn, parent) {
  if (fn.id) return fn.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition') && parent.key.type === 'Identifier') return parent.key.name;
  return null;
}

function touchesContainer(node, names) {
  if (node.type !== 'CallExpression') return false;
  const { callee, arguments: args } = node;
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && names.has(callee.object.name)) return true;
  return args[0]?.type === 'Identifier' && names.has(args[0].name);
}

const isIsCurrentCall = (node) => node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'isCurrent';

// Liefert je Verstoß { name, line, accessLines } für den Quelltext `source`.
function analyze(source) {
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true });
  const functions = [];
  walk(ast, () => {}, (fn, parent) => functions.push({ fn, parent }));
  const offenders = [];
  while (functions.length) {
    const { fn, parent } = functions.pop();
    const name = functionName(fn, parent);
    const names = new Set(['container']);
    if (fn.params[0]?.type === 'Identifier') names.add(fn.params[0].name);
    const awaits = [];
    const checks = [];
    const containerCalls = [];
    walk(fn.body, (node) => {
      // Endposition: der awaited Ausdruck selbst (z. B. `await mod.render(viewEl)`)
      // ist noch kein Zugriff NACH dem await.
      if (node.type === 'AwaitExpression') awaits.push(node.range[1]);
      if (isIsCurrentCall(node)) checks.push(node.range[0]);
      if (touchesContainer(node, names)) containerCalls.push(node);
    }, (child, childParent) => functions.push({ fn: child, parent: childParent }), fn);
    if (!name || !RENDER_NAME.test(name)) continue;
    const unguarded = containerCalls.filter((call) => {
      const at = call.range[0];
      const lastAwait = Math.max(-Infinity, ...awaits.filter((end) => end <= at));
      return lastAwait > -Infinity && !checks.some((c) => c > lastAwait && c < at);
    });
    if (unguarded.length) offenders.push({ name, line: fn.loc.start.line, accessLines: unguarded.map((n) => n.loc.start.line) });
  }
  return offenders;
}

const scan = (source) => analyze(source).map((o) => o.name);

function findUnguardedRenderers(file) {
  return analyze(readFileSync(path.join(jsDir, file), 'utf8'))
    .map((o) => `${file}:${o.line} ${o.name}() (Container-Zugriff ohne isCurrent() seit dem letzten await in Zeile ${o.accessLines.join(', ')})`);
}

describe('js/ und js/modules/: beginRender()/isCurrent()-Konvention', () => {
  it('jede render*/refresh*-Funktion prüft isCurrent() zwischen jedem await und dem nächsten Container-Zugriff', () => {
    const files = SCANNED_DIRS.flatMap((dir) => readdirSync(path.join(jsDir, dir))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(dir, f)));
    expect(files.some((f) => f.startsWith('modules'))).toBe(true); // Kanarienvogel, analog sw.precache.test.js
    expect(files.flatMap(findUnguardedRenderers)).toEqual([]);
  });

  // Selbsttest des Prüfers: die Regel oben ist nur so viel wert, wie sie
  // die Fälle aus Issue #82 tatsächlich erkennt.
  it('erkennt eine fehlende Prüfung nach dem zweiten von zwei awaits', () => {
    const fixture = `
      async function renderDetail(container) {
        const isCurrent = beginRender(container);
        const a = await load();
        if (!isCurrent()) return;
        const b = await loadMore(a);
        container.appendChild(b);
      }`;
    expect(scan(fixture)).toEqual(['renderDetail']);
  });

  it('erkennt den ersten Parameter als Container (z. B. viewEl) und lässt redraw()-Nutzer durch', () => {
    const fixture = `
      async function renderRoute(viewEl) { await mod.render(viewEl); viewEl.focus(); }
      async function renderGuarded(viewEl) { await mod.render(viewEl); if (!isCurrent()) return; viewEl.focus(); }
      function refresh() { return redraw(container, () => load(), (d) => renderList(container, d)); }`;
    expect(scan(fixture)).toEqual(['renderRoute']);
  });
});
