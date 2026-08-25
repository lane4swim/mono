// ============================================================
// shell.js — von app.js UND app-demo.js gemeinsam genutzte Navigations-/
// Render-Bausteine (Code-Review, Befund R1).
//
// Beide Dateien bootstrappen dieselbe App-Shell (Sidebar, mobile
// Bottom-Nav, Routing) über denselben Satz an DOM-ids — #nav-list,
// #bottomnav, #language-select, #view sind in index.html UND demo.html
// identisch benannt — und unterschieden sich vor dieser Extraktion nur in
// ihren TATSÄCHLICHEN Unterschieden (Sitzungswiederherstellung +
// Hintergrund-Sync bei app.js, Demo-Konten-Umschalter bei app-demo.js),
// enthielten aber davor ~130 Zeilen (teils byte-identisches) Duplikat für
// alles andere. Diese Datei bündelt genau den geteilten Teil; app.js und
// app-demo.js rufen sie auf und behalten nur ihre eigene Logik.
import { pendingSyncCount } from './db.js';
import { getRole, getCurrentUser } from './state.js';
import { visibleModules, navigate, getModule, currentRoute } from './router.js';
import { el, clear, toast, openModal, beginRender, icon } from './utils.js';
import { t, getLocale, getAvailableLocales } from './i18n.js';

const GROUP_ICON_TRAINING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 12.5c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 18c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/></svg>';
const GROUP_ICON_PERFORMANCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h10v5a5 5 0 01-10 0V3z"/><path d="M7 5H4a3 3 0 003 5.5"/><path d="M17 5h3a3 3 0 01-3 5.5"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9 21l.7-4h4.6l.7 4"/></svg>';
const GROUP_ICON_TEAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="7.5" r="2.3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 14.3c2.5.5 4.3 2.7 4.3 5.7"/></svg>';
const GROUP_ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2"/></svg>';

// Navigation grouping: with 14 modules a flat list got unwieldy, so the
// sidebar/bottom nav are organized into a fixed set of groups instead of
// following raw module-registration order. Groups without a `labelKey`
// (dashboard, profile) render as plain top-level items with no header.
export const NAV_GROUPS = [
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
export const MOBILE_DIRECT_GROUPS = ['dashboard', 'training', 'performance', 'team', 'profile'];
export const MORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';

export function buildNav() {
  const navList = document.getElementById('nav-list');
  const bottomNav = document.getElementById('bottomnav');
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
      icon(MORE_ICON, { class: 'ic' }), el('span', {}, t('common.more')),
    ]));
  }

  markActive(currentRoute().routeId);
  updateSyncBadge();
}

function sideNavItem(m) {
  const navBadge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge', hidden: true }) : null;
  return el('li', {}, el('button', { class: 'nav-link', 'data-route': m.id, onclick: () => navigate(m.id) }, [
    icon(m.icon, { class: 'ic' }), el('span', { style: 'flex:1' }, t(`nav.${m.id}`)), navBadge,
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
    icon(groupIcon || m.icon, { class: 'ic' }), el('span', {}, label.split(' ')[0]), bottomBadge,
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
        g.icon ? icon(g.icon, { class: 'ic' }) : null,
        el('span', {}, t(g.labelKey)),
      ].filter(Boolean)));
    }
    g.mods.forEach(m => {
      const badge = m.id === 'syncqueue' ? el('span', { class: 'nav-badge', hidden: true }) : null;
      body.appendChild(el('button', { class: 'nav-link', onclick: () => { close(); navigate(m.id); } }, [
        icon(m.icon, { class: 'ic' }), el('span', { style: 'flex:1' }, t(`nav.${m.id}`)), badge,
      ].filter(Boolean)));
    });
  });
  const { close } = openModal({ title: t('common.more'), bodyNode: body });
  updateSyncBadge();
}

export async function updateSyncBadge() {
  const count = await pendingSyncCount();
  document.querySelectorAll('.nav-badge').forEach(b => {
    b.textContent = count > 99 ? '99+' : String(count);
    b.hidden = count === 0;
  });
}

export function markActive(routeId) {
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.route === routeId));
  document.querySelectorAll('.bottomnav button').forEach(b => {
    const group = b.dataset.routeGroup;
    b.classList.toggle('active', group ? group.split(' ').includes(routeId) : b.dataset.route === routeId);
  });
}

// Rolle -> bevorzugte Standard-Startseite, falls die angeforderte Route
// für diese Rolle nicht zugänglich ist (z. B. noch kein Hash beim
// allerersten Laden). Ohne Eintrag greift visibleModules(role)[0] — also
// schlicht das erste für die Rolle sichtbare Modul in
// Registrierungsreihenfolge. Für Superadmin wäre das sonst "Mein Profil"
// (vor der Nutzerverwaltung registriert, da rollenoffen), obwohl die
// Nutzerverwaltung ihre eigentliche, einzige relevante Startseite ist
// (siehe dashboard.js: kein Dashboard für Superadmin, da kein
// Verein/keine Athlet:innen vorhanden). Gilt unverändert auch für
// app-demo.js, obwohl die Demo nie einen Superadmin-Account kennt (siehe
// demoMode.js: DEMO_USERS) — der Eintrag greift dort schlicht nie.
const DEFAULT_ROUTE_BY_ROLE = { superadmin: 'usermgmt' };

export function defaultModuleFor(role) {
  const preferred = getModule(DEFAULT_ROUTE_BY_ROLE[role] || '');
  if (preferred && (!preferred.roles || preferred.roles.includes(role))) return preferred;
  return visibleModules(role)[0];
}

// Rendert die angeforderte Route in `viewEl`. Bewusst OHNE die
// Sitzungsgültigkeits-Prüfung, die app.js davor schaltet (`if
// (!isLoggedIn()) return;`) — diese Prüfung ergibt für app-demo.js keinen
// Sinn (keine echte, ablaufende Sitzung) und bleibt daher dort weg.
export async function renderRoute(viewEl, route) {
  const isCurrent = beginRender(viewEl);
  const role = getRole();
  let mod = getModule(route.routeId);
  if (!mod || (mod.roles && !mod.roles.includes(role))) mod = defaultModuleFor(role);
  markActive(mod.id);
  // Über el()/clear() statt eines Template-Literals auf viewEl.innerHTML
  // — konsistent mit dem sonst in dieser Datei konsequent verwendeten
  // DOM-Baukasten, kein unbenannter HTML-Sink für ein künftiges Audit.
  clear(viewEl);
  viewEl.appendChild(el('div', { class: 'empty-state' }, t('common.loading')));
  try {
    await mod.render(viewEl, route.params || []);
  } catch (err) {
    if (!isCurrent()) return; // a newer render superseded this one; don't show a stale error
    console.error(err);
    clear(viewEl);
    viewEl.appendChild(el('div', { class: 'empty-state' }, [
      el('h3', {}, t('common.somethingWentWrong')),
      el('p', {}, String(err?.message || err)),
    ]));
  }
  if (!isCurrent()) return; // a newer render started while this one was still loading data
  viewEl.focus();
  updateSyncBadge();
}

export function populateLanguageSelect(onLocaleSelected) {
  const languageSelect = document.getElementById('language-select');
  clear(languageSelect);
  getAvailableLocales().forEach(loc => {
    languageSelect.appendChild(el('option', { value: loc.code }, `${loc.flag} ${loc.label}`));
  });
  languageSelect.value = getLocale();
  languageSelect.title = t('topbar.language');
  languageSelect.onchange = async () => { await onLocaleSelected(languageSelect.value); };
}

// Gemeinsamer Export-Download (JSON-Blob per <a download>) für den
// "Export"-Button in den Einstellungen — app.js und app-demo.js
// unterscheiden sich hier nur im Datenquell-Modul (echte vs. Demo-IndexedDB,
// siehe db.js: DB_NAME) und im Dateinamens-Präfix.
export function downloadExportJSON(dump, filenamePrefix) {
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast(t('settings.exportStarted'));
}

// Das "Einstellungen"-Modal (Konto-/Speicherhinweis + Export-Button) —
// vormals in app.js/app-demo.js wortgleich bis auf den Hinweistext, den
// Export-Dateinamen und app-demo.js' zusätzlichen "Demo zurücksetzen"-
// Button ausgeschrieben. Bindet den Klick auf #btn-settings gleich mit,
// da beide Aufrufer dafür ohnehin identischen Code hatten.
//   - storageNoteKey: i18n-Schlüssel für den Hinweistext unter den
//     Kontodaten (app.js: 'settings.storageNote'; app-demo.js:
//     'topbar.demoBadge') — bewusst der SCHLÜSSEL, nicht der bereits
//     übersetzte Text: erst bei jedem Öffnen übersetzt (wie zuvor),
//     damit ein zwischenzeitlicher Sprachwechsel sich auch hier
//     niederschlägt, statt beim Registrieren einmalig eingefroren zu
//     werden.
//   - exportPrefix/getExportData: an downloadExportJSON() durchgereicht;
//     getExportData() liefert den zu exportierenden Datensatz (app.js
//     lädt db.js dafür bewusst erst hier per dynamischem Import, siehe
//     dortiger Kommentar — app-demo.js hat exportAll() ohnehin schon
//     statisch importiert).
//   - extraActions: Fabrikfunktion für weitere Buttons nach "Export"
//     (app-demo.js: der "Demo zurücksetzen"-Button; app.js braucht
//     keine) — bewusst eine Funktion, nicht ein fertiges Array: baut die
//     Knoten bei JEDEM Öffnen neu, aus demselben Grund wie
//     storageNoteKey oben (sonst blieben Beschriftung und die darin
//     eingebetteten t()-Aufrufe der confirmAction() nach einem
//     Sprachwechsel auf der beim Registrieren aktiven Sprache hängen).
export function setupSettingsModal({ storageNoteKey, exportPrefix, getExportData, extraActions = () => [] }) {
  const btn = document.getElementById('btn-settings');
  btn.addEventListener('click', openSettings);

  function openSettings() {
    btn.textContent = t('topbar.settings');
    const user = getCurrentUser();
    const body = el('div');
    body.appendChild(el('h3', { class: 'mt-0' }, t('settings.accounts')));
    if (user) body.appendChild(el('p', { class: 'text-sm' }, `${user.name} — ${t('settings.roleLabel')}: ${t(`settings.role_${user.role}`)}`));
    body.appendChild(el('p', { class: 'hint' }, t(storageNoteKey)));
    body.appendChild(el('div', { class: 'form-actions', style: 'justify-content:flex-start;margin-top:20px' }, [
      el('button', { class: 'btn btn-ghost', onclick: exportData }, t('settings.exportButton')),
      ...extraActions(),
    ]));
    openModal({ title: t('settings.title'), bodyNode: body, wide: true });
  }

  async function exportData() {
    downloadExportJSON(await getExportData(), exportPrefix);
  }
}
