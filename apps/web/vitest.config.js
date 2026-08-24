// apps/web/vitest.config.js
//
// apps/web bleibt bewusst ohne Build-Schritt (siehe package.json:
// description) — Vitest wird HIER ausschließlich als Testlaufzeit
// eingesetzt (führt js/*.js unverändert als ESM aus, kompiliert/bündelt
// nichts für die Auslieferung), nicht als Build-Werkzeug für die App
// selbst. Siehe Code-Review, Befund 15: vormals hatte apps/web gar keine
// automatisierten Tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Lädt vor jeder Testdatei den IndexedDB-Polyfill (siehe
    // test/setup.js) — js/db.js nutzt den globalen `indexedDB`, den es in
    // einer reinen Node-Umgebung sonst nicht gibt.
    setupFiles: ['./test/setup.js'],
  },
});
