// ============================================================
// sw.js — offline-first service worker.
// Strategy: cache-first for the app shell/static assets (precached
// on install), network-first fallback to cache for anything else.
// Backend API calls (/api/*, /auth/*) are always passed straight
// through to the network — see the fetch handler below.
// Bump CACHE_VERSION whenever any cached file changes so clients
// pick up the new version instead of serving stale assets.
//
// Review 30.08.2026, Befund U5: NICHT mehr self.skipWaiting() beim
// Install — ein neuer Worker installiert sich zwar (füllt seinen eigenen
// Cache vollständig), aktiviert sich aber erst, wenn app.js dies über
// eine "SKIP_WAITING"-Nachricht ausdrücklich anstößt (siehe der
// 'message'-Handler unten sowie registerServiceWorker() in app.js). Vorher
// übernahm ein frisch installierter Worker sofort die Kontrolle über
// bereits offene Tabs (self.clients.claim() im 'activate'-Handler
// unten), ohne dass deren bereits geladenes JavaScript davon betroffen
// war — eine über Stunden offene PWA (z. B. auf einem Tablet am
// Beckenrand) blieb dadurch beliebig lange auf dem alten Stand, ohne
// jeden Hinweis. app.js zeigt jetzt stattdessen einen Hinweis an, sobald
// ein neuer Worker bereitsteht, und lässt die Person selbst entscheiden,
// wann neu geladen wird.
const CACHE_VERSION = 'lane1-v40';
const PRECACHE_URLS = [
  './',
  './index.html',
  './demo.html',
  './manifest.json',
  './css/styles.css',
  './help/index.html',
  './help/faq.html',
  './help/admin.html',
  './help/help.css',
  './js/app.js',
  './js/app-demo.js',
  './js/swUpdate.js',
  './js/shell.js',
  './js/moduleRegistry.js',
  './js/apiClient.js',
  './js/syncClient.js',
  './js/db.js',
  './js/demoMode.js',
  './js/demoSeed.js',
  './js/state.js',
  './js/router.js',
  // Code-Review, Befund L4: js/utils.js (ein 360-Zeilen-Sammelmodul) wurde
  // aufgeteilt — die sieben Nachfolgedateien ersetzen den einen Eintrag,
  // den diese Liste zuvor dafür trug.
  './js/dom.js',
  './js/dates.js',
  './js/swimTime.js',
  './js/ui.js',
  './js/modal.js',
  './js/forms.js',
  './js/charts.js',
  './js/refdata.js',
  './js/seed.js',
  './js/i18n.js',
  './js/i18n/de-DE.js',
  './js/i18n/en-US.js',
  './js/modules/dashboard.js',
  './js/modules/athletes.js',
  './js/modules/competitions.js',
  './js/modules/competitionLive.js',
  './js/modules/stopwatch.js',
  './js/modules/times.js',
  './js/modules/plans.js',
  './js/modules/templates.js',
  './js/modules/catalog.js',
  './js/modules/comments.js',
  './js/modules/libraryTransfer.js',
  './js/modules/sessions.js',
  './js/modules/actionItems.js',
  './js/modules/stats.js',
  './js/modules/setEditor.js',
  './js/modules/planPdfExport.js',
  './js/modules/syncQueue.js',
  './js/modules/profile.js',
  './js/modules/authScreens.js',
  './js/modules/userManagement.js',
  './js/modules/clubForm.js',
  './js/modules/qualifications.js',
  './js/modules/kampfrichter.js',
  './js/modules/info.js',
  './js/modules/resultsImportUI.js',
  './js/resultsImport/dsv7Parser.js',
  './js/resultsImport/matching.js',
  './js/resultsImport/importRunner.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(
        // Kein cache.addAll(): das ist atomar — eine einzelne nicht
        // auflösbare URL (z. B. ein beim nächsten Refactor vergessener
        // Eintrag, siehe Code-Review Befund W8) würde die komplette
        // Installation und damit die gesamte Offline-Fähigkeit zum
        // Scheitern bringen. Stattdessen scheitert höchstens die einzelne
        // Datei; alle anderen werden trotzdem gecacht.
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] Precache fehlgeschlagen für', url, err))
        )
      ))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Review 30.08.2026, Befund U5: einzige Möglichkeit für einen wartenden
// Worker, tatsächlich zu aktivieren — ausgelöst über
// registration.waiting.postMessage('SKIP_WAITING') aus app.js, nachdem
// die Person den Hinweis "Neue Version verfügbar" bestätigt hat.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Die Superadmin-Oberfläche unter /admin muss "nur online verfügbar"
  // sein (siehe admin/index.html) — sie wird hier bewusst NIE aus dem
  // Cache bedient, NIE selbst zwischengespeichert, und fällt bei einem
  // Netzwerkfehler NICHT auf das gecachte Haupt-App-Shell zurück (das
  // wäre die falsche Seite). Ein root-registrierter Service Worker hätte
  // /admin sonst automatisch im Geltungsbereich, obwohl admin.js selbst
  // gar keinen Service Worker registriert.
  const url = new URL(req.url);
  // Pfade relativ zum tatsächlichen Registrierungs-Scope prüfen statt
  // fest von "/" auszugehen — unter einem GitHub-Pages-Unterpfad (siehe
  // .github/workflows/static.yml) läuft die App z. B. unter
  // /<repo>/ statt /, und "/admin"/"/api/" würden dort nie zutreffen
  // (Code-Review, Befund W8).
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(`${scopePath}admin`)) {
    event.respondWith(fetch(req));
    return;
  }

  // Backend-API-Aufrufe (apiClient.js, meist gleicher Origin hinter dem
  // Reverse-Proxy — siehe apiClient.js) dürfen NIE aus dem Cache bedient
  // werden: die Cache-first-Strategie unten war für die frühere, rein
  // lokale Version dieser App gedacht ("hat gar keine externen API-
  // Aufrufe" traf mit der Phase-4-Backend-Anbindung nicht mehr zu). Ohne
  // diese Ausnahme lieferte z. B. ein GET /api/clubs direkt nach einem
  // POST /api/clubs die alte, zwischengespeicherte Antwort zurück, sodass
  // Übersichten (z. B. die Vereinsliste der Nutzerverwaltung) nach dem
  // Anlegen leer blieben, bis ein Reload den Cache-Eintrag (der im
  // Hintergrund per fetchAndCache aktualisiert wurde) erneut auslas.
  if (url.pathname.startsWith(`${scopePath}api/`) || url.pathname.startsWith(`${scopePath}auth/`)) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Serve from cache immediately, refresh in background if online.
        fetchAndCache(req);
        return cached;
      }
      return fetchAndCache(req).catch(() => caches.match('./index.html'));
    })
  );
});

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
    }
    return res;
  });
}
