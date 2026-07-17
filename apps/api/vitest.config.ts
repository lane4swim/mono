import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // argon2id-Passwort-Hashing (hash-wasm) ist CPU-gebunden, und mehrere
    // Tests führen mehrere Hash-Operationen innerhalb eines einzigen it()
    // aus (z. B. der Rate-Limit-Test mit 6 aufeinanderfolgenden Login-
    // Versuchen). GitHub-Actions-Runner können spürbar langsamer/stärker
    // gedrosselt sein als eine typische lokale Maschine — das Standard-
    // Timeout von Vitest (5000ms) reicht dafür ggf. nicht aus und würde
    // nur in CI, nie lokal, zu Fehlschlägen führen.
    testTimeout: 20000,
  },
});
