// apps/web/test/setup.js — patcht globalThis.indexedDB mit einem reinen
// JS-Polyfill (fake-indexeddb), da eine Node-Testumgebung keine echte
// IndexedDB-Implementierung mitbringt, js/db.js aber direkt gegen den
// globalen `indexedDB` programmiert (wie im Browser).
import 'fake-indexeddb/auto';
