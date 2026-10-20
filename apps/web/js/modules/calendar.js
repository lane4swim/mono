// Kalender — fasst alle für die angemeldete Person relevanten Termine
// zusammen: geplante Trainingstage (Trainingspläne), dokumentierte
// Einheiten, Wettkämpfe, Fristen von Handlungsfeldern, Ablauf/
// Verlängerung eigener Qualifikationen und eigene Kampfrichtereinsätze.
//
// Dazu die Saisonplanung (eigener Store "calendarEntries", gepflegt von
// Trainer:innen/Admins über calendarEntries.js): Schulferien, Feiertage
// und Hallenbadschließungen vereinsweit, regelmäßige Trainingszeiten und
// Trainingslager je Gruppe. Ein Termin einer Trainingszeit öffnet den
// Trainingsplan dieses Tages bzw. legt — ist noch keiner vorhanden — einen
// neuen an.
//
// Ansichten: Woche, Monat, Quartal, Jahr. Termintypen sind farblich UND
// per Symbol unterschieden (nicht allein über Farbe) und lassen sich über
// Filter-Chips ein-/ausblenden. Trainer:innen/Admins können zwischen
// "Meine Termine" und "Ganzer Verein" wechseln (Filterregeln siehe
// calendarEvents.js: personalContext()).
//
// Kernmodul (router.js: CORE_MODULE_IDS) — bis auf die Saisonplanung
// liest es nur, was die Fachmodule ohnehin lokal halten. Welche Termintypen
// erscheinen, folgt deshalb der Sichtbarkeit der jeweiligen Quelle
// (Rollen + gebuchte Pakete, siehe availableTypes()): ein abbestelltes
// Wettkampfpaket blendet auch die Wettkämpfe hier aus. Die Saisonplanung
// hängt an keinem Paket (sync.permissions.ts: CORE_STORES).
//
// Daten werden einmal je render() geladen; Ansichts-, Zeitraum-, Filter-
// und Scope-Wechsel zeichnen danach nur den Kalender neu und halten den
// Zustand per history.replaceState im Hash (#/calendar/<ansicht>/<datum>),
// ohne einen erneuten Routenwechsel (und Datenabruf) auszulösen.
import { getAll } from '../db.js';
import { el, clear, beginRender, icon } from '../dom.js';
import { todayISO, dateOnly, fmtDateLong, fmtDateShort, startOfWeek } from '../dates.js';
import { laneWave } from '../ui.js';
import { getCurrentUser, getRoles, getEnabledModules, hasRole, isTrainerOrAdmin } from '../state.js';
import { navigate, getModule, isModuleVisible } from '../router.js';
import { t, getLocale, trLabel } from '../i18n.js';
import { REFEREE_FUNCTIONS } from '../refdata.js';
import { IS_DEMO } from '../demoMode.js';
import * as api from '../apiClient.js';
import { totalDistance } from './setEditor.js';
import { typeLabel as qualificationTypeLabel } from './qualifications.js';
import { openNewPlanModal } from './plans.js';
import { openEntryModal, openEntryList } from './calendarEntries.js';
import {
  EVENT_TYPES, RECURRING_TYPES, CALENDAR_VIEWS, ENTRY_KINDS, periodRange, shiftAnchor, monthGridDays, daysOf,
  addMonths, quarterOf, isoWeek, personalContext, collectEvents, eventsInRange, eventsForTeams, groupByDate, groupByFirstDay, countByType,
} from './calendarEvents.js';
import { teamFilterChips, loadTeamSelection, saveTeamSelection } from '../teamFilter.js';

const TYPE_ICONS = {
  publicHoliday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  schoolHoliday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  poolClosure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  trainingCamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20L12 4l9 16H3z"/><path d="M12 20v-6l-3 6M12 14l3 6"/></svg>',
  trainingSlot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  training: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M2 9c1.7 1.5 3.3 1.5 5 0s3.3-1.5 5 0 3.3 1.5 5 0 3.3-1.5 5 0"/><path d="M2 15c1.7 1.5 3.3 1.5 5 0s3.3-1.5 5 0 3.3 1.5 5 0 3.3-1.5 5 0"/></svg>',
  session: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  competition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h10v5a5 5 0 01-10 0V3z"/><path d="M12 13v4M8 21h8M10 17h4"/></svg>',
  deadline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  qualification: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="5"/><path d="M8.5 13l-1.5 8 5-3 5 3-1.5-8"/></svg>',
  referee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>',
};
const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 6l-6 6 6 6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg>';

const MAX_CHIPS_PER_MONTH_CELL = 3;

export const calendarModule = {
  id: 'calendar',
  // Superadmin (vereinslos) und reine Eltern-Konten (eigene Übersicht ohne
  // Sync, siehe parentView.js) haben keine Termine, die sich hier
  // zusammenführen ließen. Reine Kampfrichter:innen sehen ihre Einsätze.
  roles: ['trainer', 'admin', 'athlete', 'referee'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2"/></svg>`,
  async render(container, params = []) {
    const isCurrent = beginRender(container);
    clear(container);
    const user = getCurrentUser();
    const types = availableTypes();
    const [data, remote] = await Promise.all([loadLocal(types), loadRemote(types)]);
    if (!isCurrent()) return;
    const staff = isTrainerOrAdmin();
    const ctx = personalContext({ user, staff, athletes: data.athletes, groups: data.groups });
    const state = initialState(user, types, params, staff);
    const reload = () => calendarModule.render(container, [state.view, state.anchor]);
    renderPage(container, { data: { ...data, ...remote.data }, remoteFailed: remote.failed, types, ctx, state, staff, reload });
  },
};

// ---- Verfügbare Termintypen ------------------------------------------------

function routeVisible(routeId) {
  const mod = getModule(routeId);
  return !!mod && isModuleVisible(mod, getRoles(), getEnabledModules());
}

export function availableTypes() {
  const roles = getRoles();
  const has = (...r) => r.some((x) => roles.includes(x));
  const out = [];
  // Wettkämpfe sind für Athlet:innen kein eigener Menüpunkt, ihre
  // Meldungen gehören aber in den Kalender — daher Paket statt Route
  // prüfen; der Termin erscheint dann ohne Sprung ins Fachmodul.
  if (getEnabledModules().includes('competitions') && has('trainer', 'admin', 'athlete')) out.push('competition');
  if (routeVisible('actionitems')) out.push('deadline');
  // Beide über REST — demo.html hat kein Backend dahinter (Issue #56).
  if (!IS_DEMO && routeVisible('qualifications')) out.push('qualification');
  if (!IS_DEMO && routeVisible('kampfrichter') && hasRole('referee')) out.push('referee');
  if (routeVisible('plans')) out.push('training');
  if (routeVisible('sessions') || routeVisible('attendance')) out.push('session');
  // Saisonplanung: an kein Paket gebunden, aber nur für Rollen mit Sync-
  // Zugriff (reine Kampfrichter:innen synchronisieren nicht).
  if (has('trainer', 'admin', 'athlete')) out.push(...ENTRY_KINDS);
  return EVENT_TYPES.filter((type) => out.includes(type));
}

// Saisonplanung pflegen dürfen trainer/admin (STORE_PERMISSIONS.calendarEntries).
function canEditEntries() {
  return isTrainerOrAdmin();
}

// Unverplante Trainingszeit -> neuer Plan, sofern die Person Pläne anlegen
// darf (plans-Route sichtbar + Staff, wie die "Plan erstellen"-Schaltfläche).
function canCreatePlan() {
  return isTrainerOrAdmin() && routeVisible('plans');
}

function createPlanFor(event) {
  const { slot, date } = event;
  openNewPlanModal({
    name: `${slot.title} · ${fmtDateShort(date)}`,
    weekStart: startOfWeek(date),
    ...(slot.groupId ? { groupId: slot.groupId } : {}),
    days: [{ date, poolLength: slot.poolLength ?? null, sets: [] }],
  }, (plan) => navigate('plans', plan.id));
}

function openRouteFor(event) {
  const [routeId, ...rest] = event.route || [];
  if (!routeId) return null;
  if (routeVisible(routeId)) return [routeId, ...rest];
  // Vereinsverwaltung ohne "Einheiten & Feedback": Anwesenheitsstatistik.
  if (routeId === 'sessions' && routeVisible('attendance')) return ['attendance'];
  return null;
}

// ---- Daten laden -----------------------------------------------------------

async function loadLocal(types) {
  const need = new Set(['athletes', 'groups']);
  if (types.includes('training')) need.add('plans');
  if (types.includes('session')) need.add('sessions');
  if (types.includes('competition')) { need.add('competitions'); need.add('entries'); }
  if (types.includes('deadline')) need.add('actionItems');
  if (types.some((type) => ENTRY_KINDS.includes(type))) need.add('calendarEntries');
  const names = [...need];
  const lists = await Promise.all(names.map((n) => getAll(n)));
  return Object.fromEntries(names.map((n, i) => [n, lists[i] || []]));
}

// Fehler (offline, Server nicht erreichbar) lassen den Kalender nicht
// scheitern — die lokalen Termine erscheinen trotzdem, mit Hinweis.
async function loadRemote(types) {
  const data = { qualifications: [], refereeAssignments: [] };
  const jobs = [];
  if (types.includes('qualification')) jobs.push(api.listMyQualifications().then((r) => { data.qualifications = r?.qualifications || []; }));
  if (types.includes('referee')) jobs.push(api.listMyRefereeAssignments().then((r) => { data.refereeAssignments = r?.assignments || []; }));
  const results = await Promise.allSettled(jobs);
  return { data, failed: results.some((r) => r.status === 'rejected') };
}

// ---- Zustand (Ansicht, Datum, Filter, Scope) -------------------------------

const STORAGE_PREFIX = 'lane1.calendar.';

function readPref(user, key) {
  if (!user?.id) return null;
  try { return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${key}.${user.id}`) ?? null; } catch { return null; }
}
function writePref(user, key, value) {
  if (!user?.id) return;
  try { globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${key}.${user.id}`, value); } catch { /* Speicher nicht verfügbar — gilt dann nur für diese Sitzung */ }
}

function initialState(user, types, params, staff) {
  const [viewParam, dateParam] = params;
  const storedView = readPref(user, 'view');
  const view = CALENDAR_VIEWS.includes(viewParam) ? viewParam : (CALENDAR_VIEWS.includes(storedView) ? storedView : 'month');
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') && !Number.isNaN(Date.parse(dateParam)) ? dateParam : todayISO();
  let active = types;
  try {
    const stored = JSON.parse(readPref(user, 'types') || 'null');
    if (Array.isArray(stored)) active = types.filter((type) => stored.includes(type));
  } catch { /* beschädigter Eintrag — alle Typen aktiv */ }
  const scope = staff && readPref(user, 'scope') === 'all' ? 'all' : 'mine';
  return { user, view, anchor, active: new Set(active), scope };
}

function syncHash(state) {
  const hash = `#/calendar/${state.view}/${state.anchor}`;
  if (location.hash !== hash) {
    try { history.replaceState(history.state, '', hash); } catch { /* z. B. in Sandboxen ohne History-API */ }
  }
}

// ---- Rendering -------------------------------------------------------------

function renderPage(container, model) {
  const { types, state, staff, remoteFailed, reload } = model;
  const labels = eventLabels();
  // Klickverhalten der Termine (siehe eventChip()).
  const actions = {
    editEntry: canEditEntries() ? (entry) => openEntryModal(entry, model.data.groups || [], reload) : null,
    createPlan: canCreatePlan() ? createPlanFor : null,
  };
  let events = collectEvents({ data: model.data, types, scope: state.scope, ctx: model.ctx, labels });

  const wrap = el('div', { class: 'calendar' });
  const editable = canEditEntries() && types.some((type) => ENTRY_KINDS.includes(type));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('calendar.eyebrow')), el('h1', { class: 'mt-0' }, t('calendar.title'))]),
    editable ? el('div', { class: 'page-actions' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => openEntryList(reload) }, t('calendar.entry.manage')),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openEntryModal({ startDate: state.anchor, endDate: state.anchor }, model.data.groups || [], reload) }, t('calendar.entry.add')),
    ]) : null,
  ]));
  wrap.appendChild(laneWave());

  const toolbar = el('div', { class: 'cal-toolbar' });
  const filters = el('div', { class: 'cal-filters', role: 'group', 'aria-label': t('calendar.filterLabel') });
  const teamsHost = el('div');
  const body = el('div', { class: 'cal-body' });
  wrap.appendChild(toolbar);
  wrap.appendChild(filters);
  wrap.appendChild(teamsHost);
  if (remoteFailed) wrap.appendChild(el('p', { class: 'text-sm text-slate' }, t('calendar.remoteUnavailable')));
  wrap.appendChild(body);
  container.appendChild(wrap);

  // Team-Filter (nur Staff — Athlet:innen sehen ohnehin nur ihr Team):
  // angeboten werden die Teams, die im gewählten Scope vorkommen können.
  const groups = model.data.groups || [];
  let teams = staff ? loadTeamSelection('calendar', state.user, groups) : new Set();
  const offeredTeams = () => (state.scope === 'all' || model.ctx.coachAllGroups ? groups : groups.filter((g) => model.ctx.coachGroupIds.has(g.id)));
  const activeTeams = () => {
    const offered = new Set(offeredTeams().map((g) => g.id));
    return new Set([...teams].filter((id) => offered.has(id)));
  };
  function drawTeams() {
    clear(teamsHost);
    if (!staff) return;
    teamsHost.appendChild(teamFilterChips(offeredTeams(), activeTeams(), (next) => {
      // Im Scope gerade nicht angebotene, früher gewählte Teams bleiben
      // gemerkt (Wechsel "Ganzer Verein" -> "Meine Termine" und zurück).
      const offered = new Set(offeredTeams().map((g) => g.id));
      teams = new Set([...[...teams].filter((id) => !offered.has(id)), ...next]);
      saveTeamSelection('calendar', state.user, teams);
      update();
    }));
  }
  drawTeams();

  function update() {
    syncHash(state);
    const range = periodRange(state.view, state.anchor);
    const teamEvents = eventsForTeams(events, activeTeams());
    const inPeriod = eventsInRange(teamEvents, range.start, range.end);
    drawToolbar(toolbar, state, range, staff, {
      setView: (view) => { state.view = view; writePref(state.user, 'view', view); update(); },
      shift: (dir) => { state.anchor = shiftAnchor(state.view, state.anchor, dir); update(); },
      today: () => { state.anchor = todayISO(); update(); },
      setScope: (scope) => {
        state.scope = scope;
        writePref(state.user, 'scope', scope);
        events = collectEvents({ data: model.data, types, scope, ctx: model.ctx, labels });
        drawTeams();
        update();
      },
    });
    drawFilters(filters, types, state, countByType(inPeriod), (next) => {
      state.active = next;
      writePref(state.user, 'types', JSON.stringify([...next]));
      update();
    });
    clear(body);
    const visible = eventsInRange(teamEvents, range.start, range.end, [...state.active]);
    const goTo = (view, anchor) => { state.view = view; state.anchor = anchor; writePref(state.user, 'view', view); update(); };
    if (types.length === 0) body.appendChild(el('p', {}, t('calendar.noTypes')));
    else if (state.view === 'week') body.appendChild(weekView(range, visible, actions));
    else if (state.view === 'month') body.appendChild(monthView(state.anchor, range, visible, goTo, actions));
    else if (state.view === 'quarter') body.appendChild(multiMonthView(range, 3, visible, goTo, 'quarter', actions));
    else body.appendChild(multiMonthView(range, 12, visible, goTo, 'year', actions));
  }
  update();
}

function eventLabels() {
  return {
    trainingDetail: (day) => {
      const meters = totalDistance(day.sets || []);
      return meters ? t('calendar.trainingDetail', { meters }) : '';
    },
    sessionTitle: () => t('calendar.types.session'),
    sessionDetail: (s) => {
      const total = s.attendance?.length || 0;
      return total ? t('calendar.sessionDetail', { present: s.attendance.filter((a) => a.present).length, total }) : '';
    },
    qualificationExpires: (q) => t('calendar.qualificationExpires', { type: qualificationTypeLabel(q.type) }),
    qualificationRenewal: (q) => t('calendar.qualificationRenewal', { type: qualificationTypeLabel(q.type) }),
    refereeFunction: (a) => trLabel(REFEREE_FUNCTIONS, a.function, 'refereeFunctions') || '',
    entryDeadline: (c) => t('calendar.entryDeadline', { name: c.name }),
    selectionDeadline: (c) => t('calendar.selectionDeadline', { name: c.name }),
    competitionDate: (c) => t('calendar.competitionOn', { date: fmtDateLong(c.date) }),
  };
}

function fmt(iso, opts) {
  return new Date(dateOnly(iso) + 'T00:00:00Z').toLocaleDateString(getLocale(), { timeZone: 'UTC', ...opts });
}

export function periodLabel(view, anchor) {
  const range = periodRange(view, anchor);
  switch (view) {
    case 'week':
      return t('calendar.weekLabel', {
        week: isoWeek(range.start),
        range: `${fmt(range.start, { day: '2-digit', month: 'short' })} – ${fmt(range.end, { day: '2-digit', month: 'short', year: 'numeric' })}`,
      });
    case 'quarter':
      return t('calendar.quarterLabel', { quarter: quarterOf(anchor), year: anchor.slice(0, 4) });
    case 'year':
      return anchor.slice(0, 4);
    default:
      return fmt(anchor, { month: 'long', year: 'numeric' });
  }
}

function drawToolbar(toolbar, state, range, staff, actions) {
  clear(toolbar);
  const viewSwitch = el('div', { class: 'cal-segmented', role: 'group', 'aria-label': t('calendar.viewLabel') },
    CALENDAR_VIEWS.map((view) => el('button', {
      type: 'button', class: `cal-seg ${state.view === view ? 'active' : ''}`, 'aria-pressed': String(state.view === view),
      onclick: () => actions.setView(view),
    }, t(`calendar.views.${view}`))));

  const today = todayISO();
  const nav = el('div', { class: 'cal-nav' }, [
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm cal-icon-btn', title: t('calendar.prev'), 'aria-label': t('calendar.prev'), onclick: () => actions.shift(-1) }, icon(ICON_PREV, { class: 'ic' })),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: today >= range.start && today <= range.end, onclick: actions.today }, t('calendar.today')),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm cal-icon-btn', title: t('calendar.next'), 'aria-label': t('calendar.next'), onclick: () => actions.shift(1) }, icon(ICON_NEXT, { class: 'ic' })),
    el('h2', { class: 'cal-period', 'aria-live': 'polite' }, periodLabel(state.view, state.anchor)),
  ]);

  toolbar.appendChild(nav);
  const right = el('div', { class: 'cal-toolbar-right' }, [viewSwitch]);
  // Athlet:innen erhalten vom Server ohnehin nur ihren eigenen Ausschnitt —
  // die Umschaltung ergibt nur für Staff Sinn.
  if (staff) {
    right.appendChild(el('div', { class: 'cal-segmented', role: 'group', 'aria-label': t('calendar.scopeLabel') },
      ['mine', 'all'].map((scope) => el('button', {
        type: 'button', class: `cal-seg ${state.scope === scope ? 'active' : ''}`, 'aria-pressed': String(state.scope === scope),
        onclick: () => actions.setScope(scope),
      }, t(scope === 'mine' ? 'calendar.scopeMine' : 'calendar.scopeAll')))));
  }
  toolbar.appendChild(right);
}

function drawFilters(filters, types, state, counts, onChange) {
  clear(filters);
  if (types.length === 0) return;
  types.forEach((type) => {
    const on = state.active.has(type);
    filters.appendChild(el('button', {
      type: 'button', class: `cal-filter cal-type-${type} ${on ? 'on' : ''}`, 'aria-pressed': String(on),
      onclick: () => {
        const next = new Set(state.active);
        if (on) next.delete(type); else next.add(type);
        onChange(next);
      },
    }, [
      el('span', { class: 'cal-swatch' }, icon(TYPE_ICONS[type], { class: 'ic' })),
      el('span', {}, t(`calendar.types.${type}`)),
      el('span', { class: 'cal-count' }, String(counts[type] || 0)),
    ]));
  });
  const allOn = types.every((type) => state.active.has(type));
  filters.appendChild(el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm cal-filter-all',
    onclick: () => onChange(new Set(allOn ? [] : types)),
  }, t(allOn ? 'calendar.filterNone' : 'calendar.filterAll')));
}

function weekdayNames() {
  // 2024-01-01 war ein Montag.
  return daysOf('2024-01-01', '2024-01-07').map((d) => fmt(d, { weekday: 'short' }));
}

// Was ein Klick auf einen Termin bewirkt: Fachmodul öffnen; Einträge der
// Saisonplanung bearbeiten (nur Staff); eine noch unverplante
// Trainingszeit legt einen neuen Plan an.
function clickHandler(event, actions) {
  const target = openRouteFor(event);
  if (target) return () => navigate(...target);
  if (event.type === 'trainingSlot') {
    if (!event.planId && actions.createPlan) return () => actions.createPlan(event);
    return actions.editEntry ? () => actions.editEntry(event.source) : null;
  }
  if (ENTRY_KINDS.includes(event.type) && actions.editEntry) return () => actions.editEntry(event.source);
  return null;
}

function spanLabel(event) {
  if (!event.endDate) return '';
  return `${fmt(event.date, { day: '2-digit', month: '2-digit' })} – ${fmt(event.endDate, { day: '2-digit', month: '2-digit' })}`;
}

function eventChip(event, actions = {}, { compact = false } = {}) {
  const onClick = clickHandler(event, actions);
  const unplanned = event.type === 'trainingSlot' && !event.planId;
  const detail = [spanLabel(event), event.detail, unplanned && actions.createPlan ? t('calendar.slotUnplanned') : null].filter(Boolean).join(' · ');
  const tooltip = [event.title, detail].filter(Boolean).join(' — ');
  const content = [
    icon(TYPE_ICONS[event.type], { class: 'ic cal-chip-ic', 'aria-hidden': 'true' }),
    el('span', { class: 'cal-chip-text' }, [
      el('span', { class: 'cal-chip-title' }, event.title),
      !compact && detail ? el('span', { class: 'cal-chip-detail' }, detail) : null,
    ]),
    el('span', { class: 'sr-only' }, ` (${t(`calendar.types.${event.type}`)})`),
  ];
  const attrs = { class: `cal-chip cal-type-${event.type} ${compact ? 'compact' : ''} ${unplanned ? 'unplanned' : ''}`, title: tooltip };
  if (!onClick) return el('div', attrs, content);
  return el('button', { ...attrs, type: 'button', onclick: onClick }, content);
}

// Tage mit Feiertag/Ferien/Schließung zusätzlich flächig markieren — so
// bleiben sie erkennbar, auch wenn die Chips in vollen Zellen abgeschnitten
// werden.
const DAY_MARK_TYPES = ['publicHoliday', 'schoolHoliday', 'poolClosure'];
function dayMarkClasses(list) {
  return DAY_MARK_TYPES.filter((type) => list.some((e) => e.type === type)).map((type) => `mark-${type}`).join(' ');
}

function weekView(range, events, actions) {
  const byDate = groupByDate(events, { from: range.start, to: range.end });
  const today = todayISO();
  const grid = el('div', { class: 'cal-week' });
  daysOf(range.start, range.end).forEach((day) => {
    const list = byDate.get(day) || [];
    grid.appendChild(el('section', { class: `cal-week-day ${day === today ? 'today' : ''} ${dayMarkClasses(list)}`, 'aria-label': fmt(day, { weekday: 'long', day: 'numeric', month: 'long' }) }, [
      el('div', { class: 'cal-week-head' }, [
        el('span', { class: 'cal-week-dow' }, fmt(day, { weekday: 'short' })),
        el('span', { class: 'cal-week-date' }, fmt(day, { day: '2-digit', month: '2-digit' })),
      ]),
      list.length ? el('div', { class: 'cal-week-events' }, list.map((e) => eventChip(e, actions))) : el('div', { class: 'cal-empty-day' }, '—'),
    ]));
  });
  return grid;
}

function monthView(anchor, range, events, goTo, actions) {
  const grid0 = monthGridDays(anchor);
  // Das Raster reicht über den Monat hinaus — mehrtägige Einträge auch in
  // den Randtagen zeigen, Einzeltermine dort wie bisher nur im Monat.
  const byDate = groupByDate(events, { from: grid0[0], to: grid0.at(-1) });
  const today = todayISO();
  const month = anchor.slice(0, 7);
  const grid = el('div', { class: 'cal-month' });
  weekdayNames().forEach((name) => grid.appendChild(el('div', { class: 'cal-month-dow' }, name)));
  grid0.forEach((day) => {
    const list = byDate.get(day) || [];
    const outside = day.slice(0, 7) !== month;
    const cell = el('div', { class: `cal-month-cell ${outside ? 'outside' : ''} ${day === today ? 'today' : ''} ${dayMarkClasses(list)}` }, [
      el('button', {
        type: 'button', class: 'cal-daynum', title: t('calendar.openWeek'),
        'aria-label': `${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })} — ${t('calendar.openWeek')}`,
        onclick: () => goTo('week', day),
      }, String(Number(day.slice(8)))),
    ]);
    list.slice(0, MAX_CHIPS_PER_MONTH_CELL).forEach((e) => cell.appendChild(eventChip(e, actions, { compact: true })));
    if (list.length > MAX_CHIPS_PER_MONTH_CELL) {
      cell.appendChild(el('button', { type: 'button', class: 'cal-more', onclick: () => goTo('week', day) },
        t('calendar.moreEvents', { count: list.length - MAX_CHIPS_PER_MONTH_CELL })));
    }
    // Mobil ersetzen farbige Punkte die Chips (siehe styles.css).
    if (list.length) cell.appendChild(typeDots(list));
    grid.appendChild(cell);
  });
  const wrap = el('div', {}, [grid]);
  wrap.appendChild(agenda(events, t('calendar.agendaTitle'), range, actions));
  return wrap;
}

function typeDots(list) {
  const present = EVENT_TYPES.filter((type) => list.some((e) => e.type === type));
  return el('span', { class: 'cal-dots', 'aria-hidden': 'true' }, present.map((type) => el('span', { class: `cal-dot cal-type-${type}` })));
}

function multiMonthView(range, months, events, goTo, view, actions) {
  const { start } = range;
  const byDate = groupByDate(events, { from: range.start, to: range.end });
  const today = todayISO();
  const names = weekdayNames();
  const grid = el('div', { class: `cal-months cal-months-${view}` });
  for (let i = 0; i < months; i++) {
    const first = addMonths(start, i);
    const month = first.slice(0, 7);
    const mini = el('div', { class: 'cal-mini' });
    names.forEach((name) => mini.appendChild(el('div', { class: 'cal-mini-dow' }, name.slice(0, 2))));
    monthGridDays(first).forEach((day) => {
      if (day.slice(0, 7) !== month) { mini.appendChild(el('div', { class: 'cal-mini-cell outside' })); return; }
      const list = byDate.get(day) || [];
      const label = fmt(day, { weekday: 'long', day: 'numeric', month: 'long' });
      const summary = list.length ? `: ${list.map((e) => `${t(`calendar.types.${e.type}`)} — ${e.title}`).join('; ')}` : '';
      mini.appendChild(el('button', {
        type: 'button',
        class: `cal-mini-cell ${list.length ? 'has-events' : ''} ${day === today ? 'today' : ''} ${dayMarkClasses(list)}`,
        title: list.map((e) => e.title).join('\n') || null, 'aria-label': `${label}${summary}`,
        onclick: () => goTo('week', day),
      }, [el('span', { class: 'cal-mini-num' }, String(Number(day.slice(8)))), list.length ? typeDots(list) : null]));
    });
    grid.appendChild(el('div', { class: 'cal-mini-month' }, [
      el('button', { type: 'button', class: 'cal-mini-title', title: t('calendar.openMonth'), onclick: () => goTo('month', first) }, fmt(first, { month: 'long' })),
      mini,
    ]));
  }
  const wrap = el('div', {}, [grid]);
  // Trainings/Einheiten wiederholen sich mehrmals pro Woche — über ein
  // Quartal/Jahr gelistet würden sie die einmaligen Termine verdecken.
  const keyDates = events.filter((e) => !RECURRING_TYPES.includes(e.type));
  wrap.appendChild(agenda(keyDates, t('calendar.keyDatesTitle'), range, actions));
  return wrap;
}

// Jeder Termin genau einmal — mehrtägige an ihrem ersten Tag im Zeitraum.
function agenda(events, title, range, actions) {
  const card = el('div', { class: 'card cal-agenda' }, [el('h3', { class: 'mt-0' }, title)]);
  if (events.length === 0) {
    card.appendChild(el('p', {}, t('calendar.noEvents')));
    return card;
  }
  const today = todayISO();
  for (const [day, list] of groupByFirstDay(events, range.start)) {
    card.appendChild(el('div', { class: `cal-agenda-day ${day < today ? 'past' : ''}` }, [
      el('div', { class: 'cal-agenda-date' }, fmt(day, { weekday: 'short', day: '2-digit', month: 'short' })),
      el('div', { class: 'cal-agenda-events' }, list.map((e) => eventChip(e, actions))),
    ]));
  }
  return card;
}
