// apps/web/test/setup.js — patcht globalThis.indexedDB mit einem reinen
// JS-Polyfill (fake-indexeddb), da eine Node-Testumgebung keine echte
// IndexedDB-Implementierung mitbringt, js/db.js aber direkt gegen den
// globalen `indexedDB` programmiert (wie im Browser).
import 'fake-indexeddb/auto';

// router.js registriert beim Laden (Modulebene) einen `window`-
// hashchange-Listener — echtes Browser-Verhalten, das eine reine
// Node-Testumgebung ohne `window` nicht kennt. Ein minimaler Stub reicht,
// da kein Test tatsächlich einen hashchange auslöst.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
}
