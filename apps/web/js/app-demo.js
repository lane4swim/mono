// ============================================================
// app-demo.js — bootstraps demo.html.
//
// Same feature modules and router as the real app (js/app.js), but:
//   - no login screen — instead a fixed choice of two demo accounts
//     (Sabine Reuter/trainer, Maya Vogel/athlete, see demoMode.js),
//     switched via a dropdown next to the language selector;
//   - no background/real sync — the "Sync-Warteschlange" module still
//     shows the local outbox, but "Jetzt synchronisieren" is disabled
//     (see modules/syncQueue.js: IS_DEMO check) since there is no
//     backend to talk to;
//   - own IndexedDB (see db.js: DB_NAME switches on demoMode.js:
//     IS_DEMO), fully separate from the real app's — demo data can
//     never appear after a real login, and a real account's already-
//     synced data is never reachable from here.
// ============================================================
import { pendingSyncCount, exportAll } from './db.js';
import { ensureDemoDataSeeded, resetDemoClubData } from './demoSeed.js';
import { DEMO_USERS } from './demoMode.js';
import { loginDemo, getCurrentUser, setUserLocale, getRole, onUserChange } from './state.js';
import { registerModule, visibleModules, currentRoute, navigate, onRouteChange, getModule } from './router.js';
import { el, clear, toast, confirmAction, openModal, beginRender } from './utils.js';
import { t, getLocale, getAvailableLocales, onLocaleChange } from './i18n.js';

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

// Identisch zu app.js — siehe dort für die Begründung der Gruppierung.
const GROUP_ICON_TRAINING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 12.5c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 18c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/></svg>';
const GROUP_ICON_PERFORMANCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h10v5a5 5 0 01-10 0V3z"/><path d="M7 5H4a3 3 0 003 5.5"/><path d="M17 5h3a3 3 0 01-3 5.5"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9 21l.7-4h4.6l.7 4"/></svg>';
const GROUP_ICON_TEAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="7.5" r="2.3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 14.3c2.5.5 4.3 2.7 4.3 5.7"/></svg>';
const GROUP_ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2"/></svg>';

const NAV_GROUPS = [
  { id: 'dashboard', moduleIds: ['dashboard'] },
  { id: 'training', labelKey: 'nav.groups.training', icon: GROUP_ICON_TRAINING, moduleIds: ['plans', 'templates', 'catalog', 'sessions'] },
  { id: 'performance', labelKey: 'nav.groups.performance', icon: GROUP_ICON_PERFORMANCE, moduleIds: ['times', 'competitions', 'stats'] },
  { id: 'team', labelKey: 'nav.groups.team', icon: GROUP_ICON_TEAM, moduleIds: ['athletes', 'actionitems'] },
  { id: 'admin', labelKey: 'nav.groups.admin', icon: GROUP_ICON_ADMIN, moduleIds: ['usermgmt', 'syncqueue', 'info'] },
  { id: 'profile', moduleIds: ['profile'] },
];
const MOBILE_DIRECT_GROUPS = ['dashboard', 'training', 'performance', 'team', 'profile'];
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';

const viewEl = document.getElementById('view');
const navList = document.getElementById('nav-list');
const bottomNav = document.getElementById('bottomnav');
const languageSelect = document.getElementById('language-select');
const demoAccountSelect = document.getElementById('demo-account-select');
const demoIndicator = document.getElementById('demo-indicator');

async function boot() {
  await ensureDemoDataSeeded();

  populateDemoAccountSelect();
  // Startet immer mit der Trainerin — das breitere der beiden Rollen,
  // zeigt beim ersten Blick auf die Demo also mehr Module.
  loginDemo(DEMO_USERS[0]);

  populateLanguageSelect();
  populateDemoIndicator();
  buildNav();
  onRouteChange(render);
  onUserChange(() => { populateDemoAccountSelect(); populateLanguageSelect(); populateDemoIndicator(); buildNav(); render(currentRoute()); });
  onLocaleChange(() => { populateDemoAccountSelect(); populateLanguageSelect(); populateDemoIndicator(); buildNav(); render(currentRoute()); });
  render(currentRoute());
}

function populateDemoIndicator() {
  demoIndicator.querySelector('.net-label').textContent = t('topbar.demoBadge');
  demoIndicator.title = t('topbar.demoBadge');
  document.getElementById('link-help').textContent = t('topbar.help');
  document.getElementById('link-exit-demo').textContent = t('topbar.exitDemo');
}

function populateDemoAccountSelect() {
  clear(demoAccountSelect);
  const user = getCurrentUser();
  DEMO_USERS.forEach(u => {
    demoAccountSelect.appendChild(el('option', { value: u.id }, `${u.name} (${t(`settings.role_${u.role}`)})`));
  });
  demoAccountSelect.value = user?.id || DEMO_USERS[0].id;
  demoAccountSelect.title = t('topbar.demoAccountLabel');
  demoAccountSelect.onchange = () => {
    const next = DEMO_USERS.find(u => u.id === demoAccountSelect.value);
    if (!next) return;
    loginDemo(next);
    navigate('dashboard');
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
  const byId = new Map(visibleModules(role).map(m => [m.id, m]));
  clear(navList);
  clear(bottomNav);

  const groups = NAV_GROUPS
    .map(g => ({ ...g, mods: g.moduleIds.map(id => byId.get(id)).filter(Boolean) }))
    .filter(g => g.mods.length > 0);

  groups.forEach(g => {
    if (g.labelKey) navList.appendChild(el('li', { class: 'nav-group-label' }, t(g.labelKey)));
    g.mods.forEach(m => navList.appendChild(sideNavItem(m)));
  });

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

function bottomNavItem(m, groupLabel, groupRouteIds, groupIcon) {
  const bottomBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge nav-badge-mobile', hidden: true }) : null;
  const label = groupLabel || t(`nav.${m.id}`);
  return el('button', { 'data-route': m.id, 'data-route-group': (groupRouteIds || [m.id]).join(' '), onclick: () => navigate(m.id), style: 'position:relative' }, [
    el('span', { class: 'ic', html: groupIcon || m.icon }), el('span', {}, label.split(' ')[0]), bottomBadge,
  ].filter(Boolean));
}

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

function defaultModuleFor(role) {
  return visibleModules(role)[0];
}

async function render(route) {
  const isCurrent = beginRender(viewEl);
  const role = getRole();
  let mod = getModule(route.routeId);
  if (!mod || (mod.roles && !mod.roles.includes(role))) mod = defaultModuleFor(role);
  markActive(mod.id);
  viewEl.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;
  try {
    await mod.render(viewEl, route.params || []);
  } catch (err) {
    if (!isCurrent()) return;
    console.error(err);
    viewEl.innerHTML = '';
    viewEl.appendChild(el('div', { class: 'empty-state' }, [
      el('h3', {}, t('common.somethingWentWrong')),
      el('p', {}, String(err?.message || err)),
    ]));
  }
  if (!isCurrent()) return;
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
  body.appendChild(el('p', { class: 'hint' }, t('topbar.demoBadge')));
  body.appendChild(el('div', { class: 'form-actions', style: 'justify-content:flex-start;margin-top:20px' }, [
    el('button', { class: 'btn btn-ghost', onclick: exportData }, t('settings.exportButton')),
    el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('settings.resetConfirm'), async () => { await resetDemoClubData(); toast(t('settings.resetDone')); location.reload(); }, { title: t('settings.resetConfirmLabel'), confirmLabel: t('settings.resetConfirmLabel') }) }, t('settings.resetButton')),
  ]));
  openModal({ title: t('settings.title'), bodyNode: body, wide: true });
}

async function exportData() {
  const dump = await exportAll();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lane1-demo-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast(t('settings.exportStarted'));
}

boot();
