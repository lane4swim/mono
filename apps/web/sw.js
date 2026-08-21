// ============================================================
// sw.js — offline-first service worker.
// Strategy: cache-first for the app shell/static assets (precached
// on install), network-first fallback to cache for anything else.
// Backend API calls (/api/*, /auth/*) are always passed straight
// through to the network — see the fetch handler below.
// Bump CACHE_VERSION whenever any cached file changes so clients
// pick up the new version instead of serving stale assets.
// ============================================================
const CACHE_VERSION = 'lane1-v25';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './help/index.html',
  './help/faq.html',
  './help/admin.html',
  './help/help.css',
  './js/app.js',
  './js/apiClient.js',
  './js/syncClient.js',
  './js/db.js',
  './js/state.js',
  './js/router.js',
  './js/utils.js',
  './js/refdata.js',
  './js/seed.js',
  './js/i18n.js',
  './js/i18n/de-DE.js',
  './js/i18n/en-US.js',
  './js/modules/dashboard.js',
  './js/modules/athletes.js',
  './js/modules/competitions.js',
  './js/modules/times.js',
  './js/modules/plans.js',
  './js/modules/templates.js',
  './js/modules/catalog.js',
  './js/modules/sessions.js',
  './js/modules/actionItems.js',
  './js/modules/stats.js',
  './js/modules/setEditor.js',
  './js/modules/planPdfExport.js',
  './js/modules/syncQueue.js',
  './js/modules/profile.js',
  './js/modules/authScreens.js',
  './js/modules/userManagement.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
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
  if (url.pathname.startsWith('/admin')) {
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
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
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
