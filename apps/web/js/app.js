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
import { restoreSession, getCurrentUser, setUserLocale, getRole, logout, onUserChange, isLoggedIn } from './state.js';
import { registerModule, visibleModules, currentRoute, navigate, onRouteChange, getModule } from './router.js';
import { el, clear, toast, openModal, beginRender, confirmAction } from './utils.js';
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

// Dedicated group icons (same visual style as the per-module icons — see
// js/modules/*.js) representing the *category* rather than any single
// module within it. Used wherever a group is shown collapsed to one entry,
// which today is only the mobile bottom nav / its "Mehr" overflow sheet —
// the desktop sidebar lists every module individually, so a category icon
// there would be redundant next to each module's own icon.
const GROUP_ICON_TRAINING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 12.5c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 18c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/></svg>';
const GROUP_ICON_PERFORMANCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h10v5a5 5 0 01-10 0V3z"/><path d="M7 5H4a3 3 0 003 5.5"/><path d="M17 5h3a3 3 0 01-3 5.5"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9 21l.7-4h4.6l.7 4"/></svg>';
const GROUP_ICON_TEAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="7.5" r="2.3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 14.3c2.5.5 4.3 2.7 4.3 5.7"/></svg>';
const GROUP_ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2"/></svg>';

// Navigation grouping: with 14 modules a flat list got unwieldy, so the
// sidebar/bottom nav are organized into a fixed set of groups instead of
// following raw module-registration order. Groups without a `labelKey`
// (dashboard, profile) render as plain top-level items with no header.
const NAV_GROUPS = [
  { id: 'dashboard', moduleIds: ['dashboard'] },
  { id: 'training', labelKey: 'nav.groups.training', icon: GROUP_ICON_TRAINING, moduleIds: ['plans', 'templates', 'catalog', 'sessions'] },
  { id: 'performance', labelKey: 'nav.groups.performance', icon: GROUP_ICON_PERFORMANCE, moduleIds: ['times', 'competitions', 'stats'] },
  { id: 'team', labelKey: 'nav.groups.team', icon: GROUP_ICON_TEAM, moduleIds: ['athletes', 'actionitems'] },
  { id: 'admin', labelKey: 'nav.groups.admin', icon: GROUP_ICON_ADMIN, moduleIds: ['usermgmt', 'syncqueue', 'info'] },
  { id: 'profile', moduleIds: ['profile'] },
];

// The mobile bottom bar only has room for a handful of icons: these groups
// get one direct entry each (their first visible module, but shown under
// the group's own icon/label — see bottomNavItem()); anything beyond that
// first module — and the whole admin group — sits behind "Mehr".
const MOBILE_DIRECT_GROUPS = ['dashboard', 'training', 'performance', 'team', 'profile'];
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';

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
  const byId = new Map(visibleModules(role).map(m => [m.id, m]));
  clear(navList);
  clear(bottomNav);

  const groups = NAV_GROUPS
    .map(g => ({ ...g, mods: g.moduleIds.map(id => byId.get(id)).filter(Boolean) }))
    .filter(g => g.mods.length > 0);

  // Desktop sidebar: every visible module, grouped under a header.
  groups.forEach(g => {
    if (g.labelKey) navList.appendChild(el('li', { class: 'nav-group-label' }, t(g.labelKey)));
    g.mods.forEach(m => navList.appendChild(sideNavItem(m)));
  });

  // Mobile bottom bar: one direct entry per primary group, everything else
  // (remaining group members + the whole admin group) behind "Mehr".
  const overflow = [];
  groups.forEach(g => {
    if (MOBILE_DIRECT_GROUPS.includes(g.id)) {
      bottomNav.appendChild(bottomNavItem(g.mods[0], g.labelKey ? t(g.labelKey) : undefined, g.mods.map(m => m.id), g.icon));
      if (g.mods.length > 1) overflow.push({ ...g, mods: g.mods.slice(1) });
    } else {
      overflow.push(g);
    }
  });
  const overflowRouteIds = overflow.flatMap(g => g.mods.map(m => m.id));
  if (overflowRouteIds.length > 0) {
    bottomNav.appendChild(el('button', { 'data-route-group': overflowRouteIds.join(' '), style: 'position:relative', onclick: () => openMoreNav(overflow) }, [
      el('span', { class: 'ic', html: MORE_ICON }), el('span', {}, t('common.more')),
    ]));
  }

  markActive(currentRoute().routeId);
  updateSyncBadge();
}

function sideNavItem(m) {
  const navBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge', hidden: true }) : null;
  return el('li', {}, el('button', { class: 'nav-link', 'data-route': m.id, onclick: () => navigate(m.id) }, [
    el('span', { class: 'ic', html: m.icon }), el('span', { style: 'flex:1' }, t(`nav.${m.id}`)), navBadge,
  ].filter(Boolean)));
}

// `groupRouteIds` covers every module the icon represents (its own id plus
// any sibling that collapsed into "Mehr"), so the icon still shows as
// active when the user is on one of those siblings, not just its own id.
// `groupIcon`, when given, shows the group's own category icon (see
// GROUP_ICON_* above) instead of borrowing the representative module's icon
// — the bottom nav icon stands for the whole category, not just its first
// module.
function bottomNavItem(m, groupLabel, groupRouteIds, groupIcon) {
  const bottomBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge nav-badge-mobile', hidden: true }) : null;
  const label = groupLabel || t(`nav.${m.id}`);
  return el('button', { 'data-route': m.id, 'data-route-group': (groupRouteIds || [m.id]).join(' '), onclick: () => navigate(m.id), style: 'position:relative' }, [
    el('span', { class: 'ic', html: groupIcon || m.icon }), el('span', {}, label.split(' ')[0]), bottomBadge,
  ].filter(Boolean));
}

// "Mehr"-Sheet für die mobile Bottom-Nav: alle Module, die dort nicht als
// eigenes Icon Platz finden (siehe MOBILE_DIRECT_GROUPS oben), bleiben so
// über die gleiche gruppierte Ansicht wie im Desktop-Sidenav erreichbar.
function openMoreNav(groups) {
  const body = el('div', { class: 'more-nav-list' });
  groups.forEach(g => {
    if (g.labelKey) {
      body.appendChild(el('div', { class: 'nav-group-label' }, [
        g.icon ? el('span', { class: 'ic', html: g.icon }) : null,
        el('span', {}, t(g.labelKey)),
      ].filter(Boolean)));
    }
    g.mods.forEach(m => {
      const badge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge', hidden: true }) : null;
      body.appendChild(el('button', { class: 'nav-link', onclick: () => { close(); navigate(m.id); } }, [
        el('span', { class: 'ic', html: m.icon }), el('span', { style: 'flex:1' }, t(`nav.${m.id}`)), badge,
      ].filter(Boolean)));
    });
  });
  const { close } = openModal({ title: t('common.more'), bodyNode: body });
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
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.route === routeId));
  document.querySelectorAll('.bottomnav button').forEach(b => {
    const group = b.dataset.routeGroup;
    b.classList.toggle('active', group ? group.split(' ').includes(routeId) : b.dataset.route === routeId);
  });
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
