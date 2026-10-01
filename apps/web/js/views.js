// Ansichten ("Views"): fachlich zusammengehörige Modulgruppen
// (Verwaltung, Trainingsplanung, Wettkampfteilnahme, Wettkampforganisation),
// zwischen denen die Person beim Start und jederzeit danach wechseln kann.
//
// Eine Ansicht ist AUSSCHLIESSLICH ein Filter auf die Navigation — keine
// Berechtigungsgrenze. Was sichtbar ist, entscheidet weiterhin allein
// router.js: isModuleVisible() (Rollen + gebuchte Modul-Pakete); eine
// Ansicht schränkt diese Menge nur weiter ein. Eine Route außerhalb der
// aktuellen Ansicht (Querverweis, Benachrichtigung, Lesezeichen) wird
// deshalb nie blockiert — shell.js: renderRoute() wechselt stattdessen
// in eine passende Ansicht.
//
// Die Auswahl ist bewusst gerätebezogen (localStorage), nicht am Konto
// gespeichert: dieselbe Person kann am Beckenrand-Tablet in
// "Wettkampfteilnahme" und am Schreibtisch in "Verwaltung" starten.
import { MODULES, isModuleVisible } from './router.js';

const ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
const ICON_TRAINING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 12.5c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/><path d="M2 18c1.4 1.3 2.8 1.3 4.2 0s2.8-1.3 4.2 0 2.8 1.3 4.2 0 2.8-1.3 4.2 0"/></svg>';
const ICON_COMPETITION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h10v5a5 5 0 01-10 0V3z"/><path d="M7 5H4a3 3 0 003 5.5"/><path d="M17 5h3a3 3 0 01-3 5.5"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9 21l.7-4h4.6l.7 4"/></svg>';
const ICON_MEET_ORG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/><path d="M14 21h6M17 17v4"/></svg>';

// Module, die in JEDER Ansicht erscheinen: Einstieg (Dashboard bzw.
// Eltern-Übersicht), vereinsweite Kommunikation und reine Infrastruktur.
export const COMMON_MODULE_IDS = ['dashboard', 'parent', 'announcements', 'syncqueue', 'info', 'profile'];

// Reihenfolge von `moduleIds` = Priorität für die Startseite der Ansicht
// (das erste für die Person sichtbare Modul, siehe defaultRouteOf()) und
// für die direkten Einträge der mobilen Bottom-Nav (shell.js: buildNav()).
// Ein Modul darf in mehreren Ansichten stehen (z. B. die
// Anwesenheitsstatistik in Verwaltung UND Trainingsplanung).
export const VIEWS = [
  {
    id: 'admin', icon: ICON_ADMIN,
    moduleIds: ['athletes', 'usermgmt', 'qualifications', 'attendance', 'auditlog'],
  },
  {
    id: 'training', icon: ICON_TRAINING,
    moduleIds: ['plans', 'sessions', 'actionitems', 'stats', 'attendance', 'templates', 'catalog', 'sectionTemplates'],
  },
  {
    id: 'competition', icon: ICON_COMPETITION,
    moduleIds: ['competitions', 'times', 'stats'],
  },
  {
    id: 'meetOrg', icon: ICON_MEET_ORG,
    moduleIds: ['kampfrichter'],
  },
];

export function getView(id) {
  return VIEWS.find((v) => v.id === id) || null;
}

function visibleIdSet(roles, enabledModules) {
  return new Set(MODULES.filter((m) => isModuleVisible(m, roles, enabledModules)).map((m) => m.id));
}

// Ansichten, in denen die Person mindestens ein sichtbares, nicht
// gemeinsames Modul hat — eine Ansicht nur aus Dashboard/Profil wäre
// leer. Ergibt automatisch: reines Kampfrichter-Konto -> nur
// "Wettkampforganisation", Superadmin -> nur "Verwaltung", Eltern-Konto ->
// keine (dann gibt es weder Auswahl noch Filter).
export function availableViews(roles, enabledModules) {
  const visible = visibleIdSet(roles, enabledModules);
  return VIEWS.filter((v) => v.moduleIds.some((id) => visible.has(id)));
}

export function isRouteInView(routeId, view) {
  if (!view) return true;
  return COMMON_MODULE_IDS.includes(routeId) || view.moduleIds.includes(routeId);
}

// Erste der `views`, die die Route fachlich enthält (gemeinsame Module
// zählen nicht — die passen in jede Ansicht und begründen keinen Wechsel).
export function viewForRoute(routeId, views) {
  return views.find((v) => v.moduleIds.includes(routeId)) || null;
}

// Startseite einer Ansicht: ihr erstes für die Person sichtbares Modul.
export function defaultRouteOf(view, roles, enabledModules) {
  const visible = visibleIdSet(roles, enabledModules);
  return view.moduleIds.find((id) => visible.has(id)) || null;
}

// ---------------- Aktuelle Ansicht (Laufzeitzustand) ----------------
let currentViewId = null;

export function getCurrentView() { return getView(currentViewId); }

// `null` hebt den Filter auf (z. B. Eltern-Konto ohne verfügbare Ansicht).
// Speichert die Wahl zugleich als "zuletzt genutzt" auf diesem Gerät.
export function setCurrentView(id) {
  currentViewId = getView(id) ? id : null;
  if (currentViewId) writeStorage(lastViewKey(), currentViewId);
}

// ---------------- Geräte-Präferenzen (localStorage) ----------------
// Pro Person getrennt, damit sich zwei Konten auf demselben Gerät nicht
// gegenseitig die Startansicht überschreiben. Der Scope wird nach dem
// Login gesetzt (app.js: Nutzer-ID, app-demo.js: "demo.<id>", damit
// Demo-Konten nie mit echten IDs kollidieren). Beim Abmelden bleiben die
// Einträge bewusst stehen: es sind Gerätevorlieben, keine Sitzungsdaten.
const STORAGE_PREFIX = 'lane1.';
let storageScope = null;

export function setViewStorageScope(scope) {
  storageScope = scope || null;
  currentViewId = null;
}

function lastViewKey() { return storageScope ? `${STORAGE_PREFIX}view.${storageScope}` : null; }
function skipPickerKey() { return storageScope ? `${STORAGE_PREFIX}skipViewPicker.${storageScope}` : null; }

// Jeder Zugriff abgesichert: im privaten Modus bzw. bei blockiertem
// Speicher wirft schon der Zugriff auf localStorage — dann gilt schlicht
// "nichts gespeichert" (die Auswahl erscheint bei jedem Start).
function readStorage(key) {
  if (!key) return null;
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function writeStorage(key, value) {
  if (!key) return;
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch { /* Speicher nicht verfügbar — Präferenz gilt dann nur für diese Sitzung nicht */ }
}

export function getStoredViewId() { return readStorage(lastViewKey()); }
export function getSkipViewPicker() { return readStorage(skipPickerKey()) === '1'; }
export function setSkipViewPicker(skip) { writeStorage(skipPickerKey(), skip ? '1' : null); }

// Entscheidet beim Start, welche Ansicht gilt und ob die Auswahl gezeigt
// werden muss. Reine Funktion über die übergebenen Werte (testbar ohne
// DOM):
//   - keine/eine Ansicht verfügbar        -> diese (bzw. keine), keine Auswahl
//   - Deep Link auf ein Fachmodul (#/...) -> passende Ansicht, keine Auswahl
//                                            (Reload mitten in der Arbeit,
//                                            Benachrichtigungs-Link)
//   - "Immer in dieser Ansicht starten" + gültige gespeicherte Ansicht
//                                         -> diese, keine Auswahl
//   - sonst                               -> Auswahl zeigen (gespeicherte
//                                            Ansicht vorausgewählt)
// Eine gespeicherte Ansicht, die nicht mehr verfügbar ist (Paket
// abbestellt, Rolle geändert), wird ignoriert — dann erscheint die
// Auswahl trotz gesetztem Häkchen.
export function resolveStartupView({ available, storedViewId, skipPicker, routeId }) {
  if (available.length === 0) return { viewId: null, showPicker: false };
  if (available.length === 1) return { viewId: available[0].id, showPicker: false };
  const stored = available.find((v) => v.id === storedViewId) || null;
  const linked = routeId ? viewForRoute(routeId, available) : null;
  if (linked) {
    const keep = stored && stored.moduleIds.includes(routeId);
    return { viewId: keep ? stored.id : linked.id, showPicker: false };
  }
  if (skipPicker && stored) return { viewId: stored.id, showPicker: false };
  return { viewId: stored?.id || available[0].id, showPicker: true };
}
