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

export function visibleModules(role) {
  return MODULES.filter(m => !m.roles || m.roles.includes(role));
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
