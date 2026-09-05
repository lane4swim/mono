// ============================================================
// router.js — minimal hash router + module registry.
// New feature modules register themselves here; this list is
// the core extensibility mechanism for adding future modules.
// ============================================================

export const MODULES = [];

export function registerModule(mod) {
  MODULES.push(mod);
}

export function getModule(routeId) {
  return MODULES.find(m => m.id === routeId);
}

// Module pro Verein aktivierbar (z. B. das Wettkampfmodul nur für
// bestimmte Vereine) — Kern-Module (Dashboard/Profil/Nutzerverwaltung/
// Sync-Queue/Info) sind reine Infrastruktur ohne eigenen fachlichen
// Sync-Store und bleiben immer sichtbar, unabhängig von enabledModules.
export const CORE_MODULE_IDS = ['dashboard', 'profile', 'usermgmt', 'syncqueue', 'info'];

// Route-ID (MODULES[*].id) -> Paket-Key. MUSS inhaltlich mit
// packages/shared-types/src/modules.ts: MODULE_PACKAGES übereinstimmen —
// apps/web lädt ohne Build-Schritt direkt als Browser-ES-Module (siehe
// package.json) und kann dieses Backend-Paket daher nicht importieren.
// Ein Paket kann mehrere Route-IDs bündeln (aktuell 1:1, siehe MODULE_
// PACKAGES-Kommentar zu competitionLive.js/stopwatch.js) — deshalb dieser
// Umweg statt enabledModules direkt gegen die Route-ID zu prüfen.
const ROUTE_TO_PACKAGE = {
  athletes: 'athletes',
  competitions: 'competitions',
  times: 'times',
  plans: 'plans',
  templates: 'templates',
  catalog: 'catalog',
  sessions: 'sessions',
  actionitems: 'actionitems',
  stats: 'stats',
  // Qualifikationsmanagement (docs/nutzer-qualifikationen-plan.md, Abschnitt
  // 1.2) — MUSS mit packages/shared-types/src/modules.ts: MODULE_PACKAGES.
  // qualifications übereinstimmen.
  qualifications: 'qualifications',
  // Kampfrichter-Modul (docs/kampfrichter-modul-plan.md, Abschnitt 4.1) —
  // MUSS mit packages/shared-types/src/modules.ts: MODULE_PACKAGES.
  // kampfrichter übereinstimmen.
  kampfrichter: 'kampfrichter',
};

// Alle togglebaren Paket-Keys — Default für `enabledModules`, wenn ein
// Aufrufer (noch) keins übergibt (z. B. Demo-Modus/Tests vor deren
// Anbindung), damit visibleModules() ohne zweiten Parameter weiterhin
// alles zeigt statt fälschlich alles zu sperren.
export const MODULE_KEYS = Object.keys(ROUTE_TO_PACKAGE);

// Einzelmodul-Prüfung — von visibleModules() UND von shell.js (renderRoute()'s
// Fallback bei direktem Hash-Aufruf einer gesperrten Route, defaultModuleFor())
// genutzt, damit beide Stellen exakt dieselbe Sichtbarkeitsregel anwenden.
//
// `roles` ist die Menge der Rollen der aktuell angemeldeten Person (docs/
// kampfrichter-modul-plan.md, Abschnitt 1) — ein Konto kann mehrere Rollen
// gleichzeitig haben. `mod.roles` (die Rollen, die ein Modul zulässt)
// bleibt unverändert ein einfaches Array; sichtbar ist ein Modul, sobald
// IRGENDEINE der eigenen Rollen darin vorkommt. Das ist bereits der
// gesamte Mechanismus für "mehrere Rollen gleichzeitig wahrnehmen": die
// Navigation zeigt automatisch die Vereinigung aller Module, für die
// mindestens eine eigene Rolle berechtigt ist — ohne Rollen-Umschalter.
//
// Rückwärtskompatibel zu einem einzelnen Rollen-String als `roles`
// (Aufrufer, die noch nicht umgestellt sind) — wird intern in ein
// Einzelelement-Array gehoben.
export function isModuleVisible(mod, roles, enabledModules = MODULE_KEYS) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  return (!mod.roles || mod.roles.some((r) => roleList.includes(r))) &&
    (CORE_MODULE_IDS.includes(mod.id) || enabledModules.includes(ROUTE_TO_PACKAGE[mod.id]));
}

export function visibleModules(roles, enabledModules = MODULE_KEYS) {
  return MODULES.filter(m => isModuleVisible(m, roles, enabledModules));
}

export function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [routeId, ...rest] = hash.split('/').filter(Boolean);
  return { routeId: routeId || MODULES[0]?.id, params: rest };
}

export function navigate(routeId, ...params) {
  location.hash = '#/' + [routeId, ...params].filter(Boolean).join('/');
}

const listeners = [];
export function onRouteChange(fn) { listeners.push(fn); }
window.addEventListener('hashchange', () => { for (const fn of listeners) fn(currentRoute()); });
