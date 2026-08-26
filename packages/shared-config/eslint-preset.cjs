// packages/shared-config/eslint-preset.cjs
//
// Gemeinsame ESLint-Basis für alle Workspaces, als Flat-Config-Array
// (ESLint 9+/10 — Code-Review, Befund W4: ESLint 8 war zum Zeitpunkt des
// Reviews bereits End-of-Life, das alte eslintrc-Format inzwischen
// ebenfalls veraltet). Ein Paket/eine App bindet dies über die eigene
// eslint.config.cjs im Workspace-Wurzelverzeichnis ein — Flat Config
// kaskadiert ANDERS als das frühere eslintrc-Format NICHT automatisch
// über die Verzeichnishierarchie nach oben; ESLint sucht die
// Konfigurationsdatei ausschließlich im Verzeichnis, aus dem es
// aufgerufen wird (bei `npm run lint --workspace=X` also im jeweiligen
// Workspace-Wurzelverzeichnis, siehe dortige eslint.config.cjs).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      // Kein legitimer Anwendungsfall für echte Bitoperationen in dieser
      // Codebasis (kein Bitmasking, keine Low-Level-Protokolle) — fängt
      // stattdessen `&`/`|` als versehentlichen Ersatz für `&&`/`||` bzw.
      // für zwei nacheinander auszuführende Anweisungen (siehe
      // `() => f() & g()`, das beide Seiten auswertet, aber nur zufällig
      // die richtige Reihenfolge/Semantik hat, statt sie zu garantieren).
      // Gilt für `.ts` genauso wie für `.js` — TypeScripts `|`/`&` in
      // Typausdrücken (Union/Intersection Types) sind ein eigener
      // Syntaxknoten und von dieser Regel nicht betroffen.
      'no-bitwise': 'error',
    },
  },
  // `.cjs`-Dateien (Konfigurationslader wie diese Datei und die
  // eslint.config.cjs/prettier-preset.cjs je Workspace) sind bewusst
  // CommonJS, unabhängig vom "type"-Feld in der jeweiligen package.json —
  // `no-require-imports` (Teil von tseslint.configs.recommended, verlangt
  // sonst ESM-`import`) ergibt für sie keinen Sinn.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
