// packages/shared-config/eslint-preset.cjs
// Gemeinsame ESLint-Basis für alle Workspaces. Ein Paket/App bindet dies
// in der eigenen eslint.config.js ein und kann projektspezifisch ergänzen.
module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
};
