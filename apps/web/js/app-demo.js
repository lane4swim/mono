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
import { exportAll } from './db.js';
import { ensureDemoDataSeeded, resetDemoClubData } from './demoSeed.js';
import { DEMO_USERS } from './demoMode.js';
import { loginDemo, getCurrentUser, setUserLocale, onUserChange } from './state.js';
import { registerModule, currentRoute, navigate, onRouteChange } from './router.js';
import { el, clear, toast, confirmAction, openModal } from './utils.js';
import { t, onLocaleChange } from './i18n.js';
import { buildNav, renderRoute, populateLanguageSelect, downloadExportJSON } from './shell.js';

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

const viewEl = document.getElementById('view');
const demoAccountSelect = document.getElementById('demo-account-select');
const demoIndicator = document.getElementById('demo-indicator');

async function boot() {
  await ensureDemoDataSeeded();

  populateDemoAccountSelect();
  // Startet immer mit der Trainerin — das breitere der beiden Rollen,
  // zeigt beim ersten Blick auf die Demo also mehr Module.
  loginDemo(DEMO_USERS[0]);

  populateLanguageSelect(setUserLocale);
  populateDemoIndicator();
  buildNav();
  onRouteChange(render);
  onUserChange(() => { populateDemoAccountSelect(); populateLanguageSelect(setUserLocale); populateDemoIndicator(); buildNav(); render(currentRoute()); });
  onLocaleChange(() => { populateDemoAccountSelect(); populateLanguageSelect(setUserLocale); populateDemoIndicator(); buildNav(); render(currentRoute()); });
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

async function render(route) {
  await renderRoute(viewEl, route);
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
  downloadExportJSON(await exportAll(), 'lane1-demo-export');
}

boot();
