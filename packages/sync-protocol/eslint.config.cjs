// packages/sync-protocol/eslint.config.cjs
//
// Flat Config (ESLint 9+/10) — bindet die gemeinsame Basis aus
// packages/shared-config ein. Anders als das frühere eslintrc-Format
// kaskadiert Flat Config nicht automatisch über die Verzeichnishierarchie
// nach oben (siehe Kommentar in eslint-preset.cjs) — jeder Workspace
// braucht daher diese eigene, minimale Datei.
module.exports = require('../shared-config/eslint-preset.cjs');
