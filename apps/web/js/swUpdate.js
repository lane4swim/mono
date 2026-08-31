// ============================================================
// swUpdate.js — Service-Worker-Registrierung + Update-Hinweis.
//
// Review 30.08.2026, Befund U5: sw.js aktiviert einen neu installierten
// Worker nicht mehr von selbst (kein self.skipWaiting() mehr beim
// Install, siehe dortiger Kommentar) — eine über Stunden offene Sitzung
// (z. B. ein Tablet am Beckenrand) blieb vorher beliebig lange auf dem
// alten Stand, ohne jeden Hinweis, dass ein Update bereitsteht.
// registerServiceWorker() zeigt jetzt stattdessen einen Hinweis mit
// Neu-laden-Knopf, sobald ein neuer Worker installiert, aber noch nicht
// aktiv ist — die Person entscheidet selbst, wann neu geladen wird,
// statt mitten in einer Eingabe unterbrochen zu werden.
//
// Eigenes, kleines Modul statt eingebettet in app.js: app.js selbst ist
// ein Bootstrap-Skript mit weitreichenden Seiteneffekten (kompletter
// Anmelde-/Sync-Ablauf, siehe dortiger Dateikopf) und ließe sich nur mit
// erheblichem Mock-Aufwand isoliert testen. Diese Logik hier ist
// vollständig eigenständig (nur dom.js/i18n.js als Abhängigkeit) und
// dadurch ohne den Rest des Boot-Vorgangs testbar.
import { el } from './dom.js';
import { t } from './i18n.js';

// Ein `document.querySelector()`-Wächter statt eines Modul-Flags: eine neu
// geladene Seite bekommt dadurch automatisch einen frischen Zustand (kein
// Test-only-Reset-Export nötig), ein zweiter Aufruf innerhalb derselben
// Seite (z. B. ein weiterer 'updatefound', falls der Browser aus
// irgendeinem Grund erneut prüft) hängt trotzdem keinen zweiten Hinweis an.
export function notifyUpdateAvailable(waitingWorker) {
  if (document.querySelector('.update-banner')) return;
  const banner = el('div', { class: 'update-banner' }, [
    el('span', {}, t('common.updateAvailable')),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => waitingWorker.postMessage('SKIP_WAITING') }, t('common.updateReload')),
  ]);
  document.body.appendChild(banner);
}

// `swUrl` als Parameter (statt eines fest verdrahteten 'sw.js') ausschließlich
// für Tests — die Produktionsaufrufstelle (app.js: boot()) lässt ihn weg.
export function registerServiceWorker(swUrl = 'sw.js') {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      // Bereits ein installierter, wartender Worker vorhanden — z. B. wenn
      // ein anderer, inzwischen geschlossener Tab das Update schon
      // heruntergeladen hatte.
      if (registration.waiting) notifyUpdateAvailable(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // 'installed' + ein bereits vorhandener Controller unterscheidet
          // ein Update (es lief bereits eine Version) vom allerersten
          // Install (noch kein Controller, nichts zu melden).
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdateAvailable(newWorker);
          }
        });
      });
    })
    .catch(() => { /* offline-first: fail silently */ });

  // Reload GENAU EINMAL, ausgelöst durch das eigene SKIP_WAITING oben (der
  // neue Worker übernimmt daraufhin die Kontrolle, was dieses Event
  // auslöst) — die Wache verhindert eine Schleife, falls das Event aus
  // irgendeinem Grund mehrfach feuert.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
