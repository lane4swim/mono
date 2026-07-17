// .eslintrc.cjs — root-level, gilt für das gesamte Monorepo. Jeder
// Workspace ruft nur `eslint .` auf; ESLint findet diese Datei automatisch,
// da kein näher gelegenes .eslintrc existiert. Inhalt kommt aus der
// gemeinsam genutzten Basis in packages/shared-config, damit es nur eine
// Quelle der Wahrheit für die Lint-Regeln gibt.
module.exports = {
  ...require('./packages/shared-config/eslint-preset.cjs'),
};
