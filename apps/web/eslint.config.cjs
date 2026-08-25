// apps/web/eslint.config.cjs
//
// Flat Config (ESLint 9+/10) — bindet die gemeinsame Basis aus
// packages/shared-config ein und ergänzt Browser-Globals (document,
// window, fetch, indexedDB, localStorage, …), die die gemeinsame Basis
// nicht kennt (passend für die TypeScript-Workspaces, die serverseitig
// laufen — siehe eslint-preset.cjs).
//
// Code-Review, Befund W3: apps/web hatte bislang gar kein `lint`-Script —
// der CI-Schritt `npm run lint --workspaces --if-present` übersprang das
// Paket dadurch stillschweigend, obwohl es mit ~5.000 Zeilen die größte
// Einzelkomponente und der gesamte browserseitige Angriffsvektor ist.
const preset = require('../../packages/shared-config/eslint-preset.cjs');
const globals = require('globals');

module.exports = [
  ...preset,
  { languageOptions: { globals: globals.browser } },
];
