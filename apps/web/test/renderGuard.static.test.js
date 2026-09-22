// Regressionstest für Issue #82: statische Prüfung aller Dateien unter
// js/modules/ auf die in dom.js: beginRender() dokumentierte Konvention.
//
// Jede Funktion namens render*/refresh* (inkl. der render()-Methode der
// Modulobjekte), die nach einem `await` noch den Container anfasst —
// `container.xyz(...)` oder ein Aufruf mit `container` als erstem Argument
// wie clear(container)/renderList(container, …) — muss selbst mit
// isCurrent() arbeiten. Fängt die Lücke ab, die neue, von bestehenden
// kopierte Module sonst stillschweigend wieder einschleppen würden (die
// refresh()-Helfer hatten sie ausnahmslos). Verschachtelte Funktionen
// (z. B. onclick-Handler) werden getrennt nach ihrem eigenen Namen
// beurteilt — ein anonymer Submit-Handler ist kein Render-Einstiegspunkt.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as espree from 'espree';

const modulesDir = path.resolve(fileURLToPath(import.meta.url), '../../js/modules');
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

function touchesContainer(node) {
  if (node.type !== 'CallExpression') return false;
  const { callee, arguments: args } = node;
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'container') return true;
  return args[0]?.type === 'Identifier' && args[0].name === 'container';
}

function findUnguardedRenderers(file) {
  const source = readFileSync(path.join(modulesDir, file), 'utf8');
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true });
  const functions = [];
  walk(ast, () => {}, (fn, parent) => functions.push({ fn, parent }));
  const offenders = [];
  while (functions.length) {
    const { fn, parent } = functions.pop();
    let firstAwait = Infinity;
    let usesIsCurrent = false;
    const containerCalls = [];
    walk(fn.body, (node) => {
      if (node.type === 'AwaitExpression') firstAwait = Math.min(firstAwait, node.range[0]);
      if (node.type === 'Identifier' && node.name === 'isCurrent') usesIsCurrent = true;
      if (touchesContainer(node)) containerCalls.push(node);
    }, (child, childParent) => functions.push({ fn: child, parent: childParent }), fn);
    const name = functionName(fn, parent);
    if (!name || !RENDER_NAME.test(name) || usesIsCurrent) continue;
    const late = containerCalls.filter((node) => node.range[0] > firstAwait);
    if (late.length) offenders.push(`${file}:${fn.loc.start.line} ${name}() (Container-Zugriff nach await in Zeile ${late.map((n) => n.loc.start.line).join(', ')})`);
  }
  return offenders;
}

describe('js/modules: beginRender()/isCurrent()-Konvention', () => {
  it('jede render*/refresh*-Funktion prüft isCurrent(), bevor sie nach einem await den Container anfasst', () => {
    const files = readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0); // Kanarienvogel, analog sw.precache.test.js
    expect(files.flatMap(findUnguardedRenderers)).toEqual([]);
  });
});
