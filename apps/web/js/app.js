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
import { resetDemoData } from './seed.js';
import { restoreSession, getCurrentUser, setUserLocale, getRole, logout, onUserChange, isLoggedIn } from './state.js';
import { registerModule, visibleModules, currentRoute, navigate, onRouteChange, getModule } from './router.js';
import { el, clear, toast, confirmAction, openModal, beginRender } from './utils.js';
import { t, getLocale, getAvailableLocales, onLocaleChange } from './i18n.js';
import { renderLoginScreen, renderAcceptInvitationScreen } from './modules/authScreens.js';
import { runSync } from './syncClient.js';

import { dashboardModule } from './modules/dashboard.js';
import { athletesModule } from './modules/athletes.js';
import { competitionsModule } from './modules/competitions.js';
import { timesModule } from './modules/times.js';
import { plansModule } from './modules/plans.js';
import { templatesModule } from './modules/templates.js';
import { catalogModule } from './modules/catalog.js';
import { sessionsModule } from './modules/sessions.js';
import { actionItemsModule } from './modules/actionItems.js';
import { statsModule } from './modules/stats.js';
import { syncQueueModule } from './modules/syncQueue.js';
import { profileModule } from './modules/profile.js';
import { userManagementModule } from './modules/userManagement.js';
import { infoModule } from './modules/info.js';

[dashboardModule, athletesModule, competitionsModule, timesModule, plansModule,
  templatesModule, catalogModule, sessionsModule, actionItemsModule, statsModule, syncQueueModule, profileModule, userManagementModule, infoModule]
  .forEach(registerModule);

const appShellEl = document.getElementById('app-shell');
const authScreenEl = document.getElementById('auth-screen');
const viewEl = document.getElementById('view');
const navList = document.getElementById('nav-list');
const bottomNav = document.getElementById('bottomnav');
const currentUserLabel = document.getElementById('current-user-label');
const btnLogout = document.getElementById('btn-logout');
const netIndicator = document.getElementById('net-indicator');
const languageSelect = document.getElementById('language-select');

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

  populateCurrentUserLabel();
  populateLanguageSelect();
  buildNav();
  updateNetStatus();
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  // Automatische Hintergrund-Synchronisation: sobald der Browser eine
  // (wieder-)hergestellte Verbindung meldet, sofort einen Sync-Zyklus
  // anstoßen (zusätzlich zum reinen Status-Update oben in updateNetStatus).
  window.addEventListener('online', () => backgroundSync());
  onRouteChange(render);
  onUserChange(() => { populateCurrentUserLabel(); populateLanguageSelect(); buildNav(); render(currentRoute()); });
  onLocaleChange(() => { populateCurrentUserLabel(); populateLanguageSelect(); buildNav(); updateNetStatus(); render(currentRoute()); });
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
  btnLogout.onclick = async () => {
    if (backgroundSyncIntervalId !== null) { clearInterval(backgroundSyncIntervalId); backgroundSyncIntervalId = null; }
    await logout();
    location.reload();
  };
}

function populateLanguageSelect() {
  clear(languageSelect);
  getAvailableLocales().forEach(loc => {
    languageSelect.appendChild(el('option', { value: loc.code }, `${loc.flag} ${loc.label}`));
  });
  languageSelect.value = getLocale();
  languageSelect.title = t('topbar.language');
  languageSelect.onchange = async () => { await setUserLocale(languageSelect.value); };
}

function buildNav() {
  const role = getRole();
  const mods = visibleModules(role);
  clear(navList);
  clear(bottomNav);
  mods.forEach(m => {
    const label = t(`nav.${m.id}`);
    const navBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge', hidden: true }) : null;
    const li = el('li', {}, el('button', { class: 'nav-link', 'data-route': m.id, onclick: () => navigate(m.id) }, [
      el('span', { class: 'ic', html: m.icon }), el('span', { style: 'flex:1' }, label), navBadge,
    ].filter(Boolean)));
    navList.appendChild(li);
    const bottomBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge nav-badge-mobile', hidden: true }) : null;
    const bBtn = el('button', { 'data-route': m.id, onclick: () => navigate(m.id), style: 'position:relative' }, [
      el('span', { class: 'ic', html: m.icon }), el('span', {}, label.split(' ')[0]), bottomBadge,
    ].filter(Boolean));
    bottomNav.appendChild(bBtn);
  });
  markActive(currentRoute().routeId);
  updateSyncBadge();
}

async function updateSyncBadge() {
  const count = await pendingSyncCount();
  document.querySelectorAll('.nav-badge').forEach(b => {
    b.textContent = count > 99 ? '99+' : String(count);
    b.hidden = count === 0;
  });
}

function markActive(routeId) {
  document.querySelectorAll('.nav-link, .bottomnav button').forEach(b => b.classList.toggle('active', b.dataset.route === routeId));
}

// Rolle -> bevorzugte Standard-Startseite, falls die angeforderte Route für
// diese Rolle nicht zugänglich ist (z. B. noch kein Hash beim allerersten
// Laden). Ohne Eintrag greift visibleModules(role)[0] — also schlicht das
// erste für die Rolle sichtbare Modul in Registrierungsreihenfolge. Für
// Superadmin wäre das sonst "Mein Profil" (vor der Nutzerverwaltung
// registriert, da rollenoffen), obwohl die Nutzerverwaltung ihre
// eigentliche, einzige relevante Startseite ist (siehe dashboard.js: kein
// Dashboard für Superadmin, da kein Verein/keine Athlet:innen vorhanden).
const DEFAULT_ROUTE_BY_ROLE = { superadmin: 'usermgmt' };

function defaultModuleFor(role) {
  const preferred = getModule(DEFAULT_ROUTE_BY_ROLE[role] || '');
  if (preferred && (!preferred.roles || preferred.roles.includes(role))) return preferred;
  return visibleModules(role)[0];
}

async function render(route) {
  if (!isLoggedIn()) return; // Sitzung zwischenzeitlich abgelaufen (z. B. Refresh Token ungültig) — boot() übernimmt beim nächsten Reload
  const isCurrent = beginRender(viewEl);
  const role = getRole();
  let mod = getModule(route.routeId);
  if (!mod || (mod.roles && !mod.roles.includes(role))) mod = defaultModuleFor(role);
  markActive(mod.id);
  viewEl.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;
  try {
    await mod.render(viewEl, route.params || []);
  } catch (err) {
    if (!isCurrent()) return; // a newer render superseded this one; don't show a stale error
    console.error(err);
    viewEl.innerHTML = '';
    viewEl.appendChild(el('div', { class: 'empty-state' }, [
      el('h3', {}, t('common.somethingWentWrong')),
      el('p', {}, String(err?.message || err)),
    ]));
  }
  if (!isCurrent()) return; // a newer render started while this one was still loading data
  viewEl.focus();
  updateSyncBadge();
}

// ---------------- Settings modal ----------------
document.getElementById('btn-settings').addEventListener('click', openSettings);

async function openSettings() {
  document.getElementById('btn-settings').textContent = t('topbar.settings');
  const user = getCurrentUser();
  const body = el('div');
  body.appendChild(el('h3', { class: 'mt-0' }, t('settings.accounts')));
  if (user) body.appendChild(el('p', { class: 'text-sm' }, `${user.name} — ${t('settings.roleLabel')}: ${t(`settings.role_${user.role}`)}`));
  body.appendChild(el('p', { class: 'hint' }, t('settings.storageNote')));
  body.appendChild(el('div', { class: 'form-actions', style: 'justify-content:flex-start;margin-top:20px' }, [
    el('button', { class: 'btn btn-ghost', onclick: exportData }, t('settings.exportButton')),
    el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('settings.resetConfirm'), async () => { await resetDemoData(); toast(t('settings.resetDone')); location.reload(); }, { title: t('settings.resetConfirmLabel'), confirmLabel: t('settings.resetConfirmLabel') }) }, t('settings.resetButton')),
  ]));
  openModal({ title: t('settings.title'), bodyNode: body, wide: true });
}

async function exportData() {
  const { exportAll } = await import('./db.js');
  const dump = await exportAll();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lane1-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast(t('settings.exportStarted'));
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-first: fail silently */ });
  }
}

boot();
