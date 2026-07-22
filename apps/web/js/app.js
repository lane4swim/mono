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
// ============================================================
import { pendingSyncCount } from './db.js';
import { seedIfEmpty, resetDemoData } from './seed.js';
import { restoreSession, getCurrentUser, setUserLocale, getRole, logout, onUserChange, isLoggedIn } from './state.js';
import { registerModule, visibleModules, currentRoute, navigate, onRouteChange, getModule } from './router.js';
import { el, clear, toast, confirmAction, openModal, beginRender } from './utils.js';
import { t, getLocale, getAvailableLocales, onLocaleChange } from './i18n.js';
import { renderLoginScreen, renderAcceptInvitationScreen } from './modules/authScreens.js';

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

async function boot() {
  registerServiceWorker();
  await seedIfEmpty();

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
  onRouteChange(render);
  onUserChange(() => { populateCurrentUserLabel(); populateLanguageSelect(); buildNav(); render(currentRoute()); });
  onLocaleChange(() => { populateCurrentUserLabel(); populateLanguageSelect(); buildNav(); updateNetStatus(); render(currentRoute()); });
  render(currentRoute());
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
  btnLogout.onclick = async () => {
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

async function render(route) {
  if (!isLoggedIn()) return; // Sitzung zwischenzeitlich abgelaufen (z. B. Refresh Token ungültig) — boot() übernimmt beim nächsten Reload
  const isCurrent = beginRender(viewEl);
  const role = getRole();
  let mod = getModule(route.routeId);
  if (!mod || (mod.roles && !mod.roles.includes(role))) mod = visibleModules(role)[0];
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
