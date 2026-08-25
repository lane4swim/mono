// ============================================================
// app.js — bootstraps the application.
//
// Phase 4: echte Sitzung statt lokalem Profil-Umschalter. Boot-Ablauf:
//   1. Ist die URL ein Einladungslink (#/accept-invite/<token>)? -> immer
//      den Annahme-Bildschirm zeigen, unabhängig vom Sitzungsstatus.
//   2. Sonst: versuchen, eine bestehende Sitzung wiederherzustellen
//      (state.restoreSession(), nutzt das gespeicherte Refresh Token).
//   3. Erfolgreich -> normale App-Shell (Nav/Ansicht) starten.
//   4. Keine Sitzung -> Login-Bildschirm zeigen.
//
// Automatische Hintergrund-Synchronisation (neu):
//   Bisher wurde nur manuell über den Button in der Sync-Warteschlange
//   synchronisiert (siehe modules/syncQueue.js). Jetzt läuft zusätzlich
//   im Hintergrund automatisch ein Sync-Zyklus (push dann pull, siehe
//   syncClient.js: runSync()), sobald eine Internetverbindung besteht:
//     - unmittelbar nach dem Start der authentifizierten App (falls
//       online),
//     - sobald der Browser ein "online"-Event meldet (z. B. nach
//       Wiederherstellung der Verbindung),
//     - zusätzlich in einem festen Intervall, damit auch von anderen
//       Geräten/Nutzer:innen eingegangene Änderungen ohne Nutzeraktion
//       ankommen (nicht nur die eigenen ausstehenden Events).
//   Läuft bewusst leise (keine Toasts) — Fehler werden nur geloggt, damit
//   ein vorübergehend nicht erreichbarer Server nicht bei jedem Intervall
//   störende Meldungen erzeugt. Der Sync-Badge (Anzahl ausstehender
//   Events) und ggf. eine offene Sync-Warteschlangen-Ansicht werden
//   trotzdem aktualisiert.
// ============================================================
import { pendingSyncCount } from './db.js';
import { wipeDemoDataIfPresent } from './seed.js';
import { restoreSession, getCurrentUser, setUserLocale, logout, onUserChange, isLoggedIn } from './state.js';
import { currentRoute, onRouteChange } from './router.js';
import { toast, confirmAction } from './utils.js';
import { t, onLocaleChange } from './i18n.js';
import { renderLoginScreen, renderAcceptInvitationScreen } from './modules/authScreens.js';
import { runSync } from './syncClient.js';
import { buildNav, renderRoute, populateLanguageSelect, updateSyncBadge, setupSettingsModal } from './shell.js';
import { registerAllModules } from './moduleRegistry.js';

registerAllModules();

const appShellEl = document.getElementById('app-shell');
const authScreenEl = document.getElementById('auth-screen');
const viewEl = document.getElementById('view');
const currentUserLabel = document.getElementById('current-user-label');
const btnLogout = document.getElementById('btn-logout');
const netIndicator = document.getElementById('net-indicator');

// Alle wie viele Millisekunden im Hintergrund automatisch synchronisiert
// werden soll (zusätzlich zu den ereignisgesteuerten Auslösern unten) —
// deckt vor allem den Fall ab, dass Änderungen anderer Geräte/Nutzer:innen
// eintreffen sollen, ohne dass am eigenen Gerät gerade etwas geändert wird
// (rein "eigene ausstehende Events" würden sonst nie automatisch abgeholt).
const BACKGROUND_SYNC_INTERVAL_MS = 60_000;

// Verhindert überlappende Sync-Läufe (z. B. wenn das Intervall feuert,
// während gerade schon ein durch das "online"-Event ausgelöster Lauf
// unterwegs ist).
let backgroundSyncInProgress = false;
let backgroundSyncIntervalId = null;

async function boot() {
  registerServiceWorker();

  const route = currentRoute();
  if (route.routeId === 'accept-invite' && route.params[0]) {
    showAuthScreen();
    await renderAcceptInvitationScreen(authScreenEl, route.params[0], startAuthenticatedApp);
    return;
  }

  const user = await restoreSession();
  if (!user) {
    showAuthScreen();
    renderLoginScreen(authScreenEl, startAuthenticatedApp);
    return;
  }
  await startAuthenticatedApp();
}

function showAuthScreen() {
  appShellEl.hidden = true;
  authScreenEl.hidden = false;
}

async function startAuthenticatedApp() {
  authScreenEl.hidden = true;
  appShellEl.hidden = false;
  if (location.hash.startsWith('#/accept-invite')) location.hash = '#/dashboard';

  // Läuft VOR dem ersten Sync-Zyklus unten (startBackgroundSync()): räumt
  // lokale Demo-Daten weg, falls noch vorhanden — heute i. d. R. ein No-op
  // (kein automatisches Seeding mehr, siehe seed.js Dateikopf), greift aber
  // noch für Geräte mit Altlasten aus einer früheren Version dieser App,
  // die noch automatisch geseedet oder über den inzwischen entfernten
  // "Auf Demo-Daten zurücksetzen"-Button zurückgesetzt wurden (siehe
  // seed.js: wipeDemoDataIfPresent() für die ausführliche Begründung).
  // Eine reine Sitzungswiederherstellung (z. B. nach einem Seiten-Reload)
  // findet den Marker bereits konsumiert vor und rührt die inzwischen
  // echten, synchronisierten Daten nicht an.
  if (await wipeDemoDataIfPresent()) toast(t('auth.demoDataReplaced'));

  populateCurrentUserLabel();
  populateLanguageSelect(setUserLocale);
  buildNav();
  updateNetStatus();
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  // Automatische Hintergrund-Synchronisation: sobald der Browser eine
  // (wieder-)hergestellte Verbindung meldet, sofort einen Sync-Zyklus
  // anstoßen (zusätzlich zum reinen Status-Update oben in updateNetStatus).
  window.addEventListener('online', () => backgroundSync());
  onRouteChange(render);
  onUserChange(() => { populateCurrentUserLabel(); populateLanguageSelect(setUserLocale); buildNav(); render(currentRoute()); });
  onLocaleChange(() => { populateCurrentUserLabel(); populateLanguageSelect(setUserLocale); buildNav(); updateNetStatus(); render(currentRoute()); });
  render(currentRoute());

  startBackgroundSync();
}

// Startet die automatische Hintergrund-Synchronisation für die laufende
// Sitzung: ein sofortiger Versuch (falls online) sowie ein wiederkehrendes
// Intervall. Wird aus startAuthenticatedApp() aufgerufen, also einmal pro
// Login/Sitzungswiederherstellung — ein erneuter Login nach Logout+Reload
// legt wegen location.reload() (siehe logout-Button unten) ohnehin einen
// frischen Modul-Zustand an, sodass hier kein Aufräumen alter Intervalle
// nötig ist.
function startBackgroundSync() {
  if (navigator.onLine) backgroundSync();
  if (backgroundSyncIntervalId !== null) clearInterval(backgroundSyncIntervalId);
  backgroundSyncIntervalId = setInterval(() => backgroundSync(), BACKGROUND_SYNC_INTERVAL_MS);
}

// Führt — falls gerade sinnvoll möglich — einen automatischen Sync-Zyklus
// aus (push dann pull, siehe syncClient.js: runSync()). Bewusst ohne
// Toasts: das soll im Hintergrund unauffällig passieren, nicht wie die
// manuelle Aktion über den Button in der Sync-Warteschlange wirken.
// Voraussetzungen:
//   - eine Sitzung besteht (sonst gäbe es keinen gültigen Access Token),
//   - der Browser meldet eine Internetverbindung (navigator.onLine) —
//     verhindert unnötige, sicher fehlschlagende Anfragen im Offline-Fall,
//   - kein anderer Hintergrund-Sync läuft bereits.
async function backgroundSync() {
  if (!isLoggedIn()) return;
  if (!navigator.onLine) return;
  if (backgroundSyncInProgress) return;

  backgroundSyncInProgress = true;
  try {
    await runSync();
  } catch (err) {
    // Ein einzelner fehlgeschlagener Hintergrund-Sync (z. B. Server kurz
    // nicht erreichbar, abgelaufene Sitzung) soll die App nicht stören —
    // der nächste Intervall-/online-Auslöser versucht es erneut. Lediglich
    // zur Fehlersuche geloggt.
    console.warn('[background-sync] Automatische Synchronisierung fehlgeschlagen:', err);
  } finally {
    backgroundSyncInProgress = false;
    updateSyncBadge();
    // Falls die Sync-Warteschlange gerade sichtbar ist, deren Ansicht
    // aktualisieren, damit neu eingetroffene/synchronisierte Einträge
    // ohne manuelles Neuladen erscheinen.
    if (currentRoute().routeId === 'syncqueue') render(currentRoute());
  }
}

function updateNetStatus() {
  const online = navigator.onLine;
  netIndicator.classList.toggle('net-offline', !online);
  netIndicator.querySelector('.net-label').textContent = online ? t('topbar.offlineReady') : t('topbar.offlineMode');
}

// Ersetzt den früheren Profil-Umschalter: zeigt Name+Rolle der eingeloggten
// Person sowie einen Logout-Button. Ein Kontowechsel erfolgt jetzt über
// echtes Aus-/Wieder-Einloggen, nicht mehr über eine lokale Auswahlliste.
function populateCurrentUserLabel() {
  const user = getCurrentUser();
  if (!user) return;
  const roleLabel = t(`settings.role_${user.role}`);
  currentUserLabel.textContent = `${user.name} (${roleLabel})`;
  btnLogout.textContent = t('topbar.logout');
  document.getElementById('link-help').textContent = t('topbar.help');
  btnLogout.onclick = handleLogoutClick;
}

// Code-Review, Befund 13: state.js' logout() ruft wipeAll() auf, das ALLE
// lokalen Daten löscht — inklusive der Sync-Warteschlange (syncQueue). Noch
// nicht synchronisierte Änderungen (z. B. gerade erfasste Zeiten, während
// offline) gingen dadurch beim Abmelden kommentarlos verloren. Diese
// Funktion versucht deshalb ZUERST, ausstehende Änderungen noch zu
// übertragen (best effort — schlägt z. B. offline fehl), und fragt nur
// dann aktiv nach, wenn danach immer noch etwas aussteht.
async function handleLogoutClick() {
  const pendingBefore = await pendingSyncCount();
  if (pendingBefore > 0) {
    try { await runSync(); } catch { /* offline/Server nicht erreichbar — wird unten über den erneuten Zähler abgefangen */ }
  }

  const pendingAfter = await pendingSyncCount();
  if (pendingAfter > 0) {
    confirmAction(
      t('topbar.logoutPendingSyncConfirm', { count: pendingAfter }),
      finishLogout,
      { title: t('topbar.logoutPendingSyncTitle'), confirmLabel: t('topbar.logoutAnyway') },
    );
    return;
  }

  await finishLogout();
}

async function finishLogout() {
  if (backgroundSyncIntervalId !== null) { clearInterval(backgroundSyncIntervalId); backgroundSyncIntervalId = null; }
  await logout();
  location.reload();
}

async function render(route) {
  if (!isLoggedIn()) return; // Sitzung zwischenzeitlich abgelaufen (z. B. Refresh Token ungültig) — boot() übernimmt beim nächsten Reload
  await renderRoute(viewEl, route);
}

// ---------------- Settings modal ----------------
// db.js wird hier bewusst erst per dynamischem Import geladen (nicht
// oben statisch) — der Export-Button ist der einzige Ort in app.js, der
// exportAll() braucht; ein statischer Import würde db.js unnötig früh
// laden, auch wenn "Einstellungen" nie geöffnet wird.
setupSettingsModal({
  storageNoteKey: 'settings.storageNote',
  exportPrefix: 'lane1-export',
  getExportData: async () => (await import('./db.js')).exportAll(),
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-first: fail silently */ });
  }
}

boot();
