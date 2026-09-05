// apps/web/test/sw.precache.test.js
//
// Regressionstest: sw.js listet die App-Shell-Dateien für den Offline-
// Erstinstall von Hand in PRECACHE_URLS auf (kein Build-Schritt, der das
// automatisch aus dem Dateisystem ableitet) — ein neues Modul unter
// js/modules/, das dort vergessen wird, lädt online klaglos (per
// dynamischem Import aus moduleRegistry.js, danach opportunistisch
// nachgecacht), bleibt aber unerreichbar, wenn die Seite VOR dem ersten
// Online-Aufruf dieses Moduls offline geht (z. B. Flugmodus direkt nach
// dem Erstinstall). Entdeckt beim Kampfrichter-Modul (modules/
// kampfrichter.js), das genau diesen Fehler zunächst hatte.
//
// Liest sw.js bewusst als reinen Text statt es zu importieren — die Datei
// nutzt `self.addEventListener(...)` auf oberster Ebene (echtes
// Service-Worker-Skript, kein ES-Modul mit Exporten) und lässt sich daher
// nicht gefahrlos in einer Test-Umgebung ausführen.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const swSource = readFileSync(path.join(webRoot, 'sw.js'), 'utf8');

describe('sw.js: PRECACHE_URLS', () => {
  it('listet jede Datei aus js/modules/', () => {
    const moduleFiles = readdirSync(path.join(webRoot, 'js/modules')).filter((f) => f.endsWith('.js'));
    expect(moduleFiles.length).toBeGreaterThan(0); // Kanarienvogel: bricht, falls das Verzeichnis je verschwindet/umbenannt wird
    for (const file of moduleFiles) {
      expect(swSource).toContain(`./js/modules/${file}`);
    }
  });
});
