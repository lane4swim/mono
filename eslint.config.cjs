// eslint.config.cjs — root-level Flat Config (ESLint 9+/10, siehe
// Code-Review Befund W4). Nicht Teil des `npm run lint --workspaces`-Laufs
// (der delegiert an die eigene eslint.config.cjs jedes Workspaces, siehe
// dort), sondern nur relevant für Editor-Integrationen (z. B. VS Code),
// die vom Repo-Wurzelverzeichnis aus nach einer Konfiguration suchen.
module.exports = require('./packages/shared-config/eslint-preset.cjs');
