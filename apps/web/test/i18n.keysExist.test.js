// Statische Prüfung: Jeder im Code als Literal an t() übergebene
// Übersetzungsschlüssel muss in BEIDEN Wörterbüchern existieren — sonst
// zeigt die Oberfläche den rohen Schlüssel (so geschehen bei den
// Wochentagen der Plan-Zyklen: t('weekdays.' + key) statt
// t('refdata.weekdays.' + key)). Bei zusammengesetzten Schlüsseln
// (t('präfix.' + x)) wird geprüft, dass das Präfix ein Objekt ist.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import de from '../js/i18n/de-DE.js';
import en from '../js/i18n/en-US.js';

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'i18n' ? [] : jsFiles(p);
    return name.endsWith('.js') ? [p] : [];
  });
}

function lookup(dict, path) {
  return path.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

// \bt('a.b.c') bzw. \bt('a.b.' + …) — nur Literale; Schlüssel aus
// Variablen/Template-Strings lassen sich statisch nicht prüfen.
const CALL_RE = /\bt\(\s*'([A-Za-z0-9_.-]+)'\s*(\+)?/g;

const usages = [];
for (const file of jsFiles(JS_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(CALL_RE)) {
    usages.push({ file: file.slice(JS_DIR.length + 1), key: m[1], isPrefix: !!m[2] });
  }
}

describe('i18n: im Code verwendete Schlüssel', () => {
  it('findet überhaupt Aufrufe (Plausibilität der Suche)', () => {
    expect(usages.length).toBeGreaterThan(500);
  });

  for (const [locale, dict] of [['de-DE', de], ['en-US', en]]) {
    it(`existieren alle in ${locale}`, () => {
      const missing = usages.filter(({ key, isPrefix }) => {
        if (isPrefix) {
          const node = lookup(dict, key.replace(/\.$/, ''));
          return !(node && typeof node === 'object');
        }
        // Listen (z. B. legal.cookieList) liefert t() unverändert als Array.
        const value = lookup(dict, key);
        return !(typeof value === 'string' || Array.isArray(value));
      }).map(({ file, key, isPrefix }) => `${file}: ${key}${isPrefix ? '…' : ''}`);
      expect([...new Set(missing)]).toEqual([]);
    });
  }
});
