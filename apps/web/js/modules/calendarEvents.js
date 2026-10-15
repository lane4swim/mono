// Reine Logik des Kalendermoduls (modules/calendar.js): Zeiträume der
// Ansichten (Woche/Monat/Quartal/Jahr) und das Zusammenführen aller
// datierten Fachdaten zu einheitlichen Kalenderterminen — ohne DOM, damit
// sich Filterung und Datumsrechnung direkt testen lassen.
//
// Alle Datumswerte sind reine Kalenderdaten "YYYY-MM-DD" (dates.js:
// dateOnly()); gerechnet wird wie in dates.js durchgehend in UTC, damit
// kein Termin östlich von UTC auf den Vortag rutscht.
import { dateOnly, isoAddDays, startOfWeek } from '../dates.js';

// Reihenfolge = Reihenfolge der Filter-Chips und Sortierung am selben Tag.
export const EVENT_TYPES = ['competition', 'deadline', 'qualification', 'referee', 'training', 'session'];

// Wiederkehrende Typen: in Quartals-/Jahresansicht nur als Punkte in den
// Mini-Monaten, nicht in der Liste "Wichtige Termine".
export const RECURRING_TYPES = ['training', 'session'];

export const CALENDAR_VIEWS = ['week', 'month', 'quarter', 'year'];

// ---- Zeiträume -------------------------------------------------------------

function parts(iso) {
  const [y, m, d] = dateOnly(iso).split('-').map(Number);
  return { y, m, d };
}
function isoOf(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
export function monthStart(iso) {
  const { y, m } = parts(iso);
  return isoOf(y, m, 1);
}
export function addMonths(iso, n) {
  const { y, m } = parts(iso);
  return isoOf(y, m + n, 1);
}
export function monthEnd(iso) {
  return isoAddDays(addMonths(iso, 1), -1);
}
export function quarterOf(iso) {
  return Math.floor((parts(iso).m - 1) / 3) + 1;
}

// ISO-8601-Kalenderwoche (Woche mit dem ersten Donnerstag = KW 1).
export function isoWeek(iso) {
  const thursday = isoAddDays(startOfWeek(iso), 3);
  const { y } = parts(thursday);
  const jan1 = Date.UTC(y, 0, 1);
  return Math.floor((Date.parse(thursday + 'T00:00:00Z') - jan1) / 86400000 / 7) + 1;
}

// Erster und letzter Tag (beide inklusive) des Zeitraums, der `anchor`
// in der gewählten Ansicht enthält.
export function periodRange(view, anchor) {
  const { y, m } = parts(anchor);
  switch (view) {
    case 'week': {
      const start = startOfWeek(anchor);
      return { start, end: isoAddDays(start, 6) };
    }
    case 'quarter': {
      const first = isoOf(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
      return { start: first, end: isoAddDays(addMonths(first, 3), -1) };
    }
    case 'year':
      return { start: isoOf(y, 1, 1), end: isoOf(y, 12, 31) };
    case 'month':
    default:
      return { start: monthStart(anchor), end: monthEnd(anchor) };
  }
}

// Anker eine Periode vor/zurück verschieben (`dir` = +1/-1). Monats-
// basierte Ansichten springen auf den Monatsersten, damit z. B. der
// 31. Januar nicht über einen kurzen Februar hinweg im März landet.
export function shiftAnchor(view, anchor, dir) {
  switch (view) {
    case 'week': return isoAddDays(anchor, 7 * dir);
    case 'quarter': return addMonths(anchor, 3 * dir);
    case 'year': return addMonths(anchor, 12 * dir);
    case 'month':
    default: return addMonths(anchor, dir);
  }
}

// Tage eines Monatsrasters: volle Wochen (Mo–So) von der Woche des
// Monatsersten bis zur Woche des Monatsletzten.
export function monthGridDays(anchor) {
  const first = startOfWeek(monthStart(anchor));
  const last = isoAddDays(startOfWeek(monthEnd(anchor)), 6);
  const days = [];
  for (let d = first; d <= last; d = isoAddDays(d, 1)) days.push(d);
  return days;
}

export function daysOf(start, end) {
  const days = [];
  for (let d = start; d <= end; d = isoAddDays(d, 1)) days.push(d);
  return days;
}

// ---- Termine sammeln -------------------------------------------------------

// Wem gehören die Termine? `scope: 'mine'` filtert auf die angemeldete
// Person, `'all'` zeigt alles, was lokal vorliegt (nur für Staff
// angeboten; Athlet:innen erhalten vom Server ohnehin nur ihren
// Ausschnitt, siehe sync.athleteScope.ts).
//
// "Meine" Termine einer Person setzen sich zusammen aus
//   - als Athlet:in (user.athleteId gesetzt): Pläne/Einheiten der eigenen
//     Gruppe bzw. mit eigener Anwesenheit, Wettkämpfe mit eigener Meldung,
//     eigene Handlungsfeld-Fristen;
//   - als Trainer:in/Admin (staff): Pläne/Einheiten der betreuten Gruppen
//     (Group.trainerIds) bzw. mit eigener Trainer:innen-Anwesenheit,
//     Wettkämpfe mit Meldungen aus diesen Gruppen (oder noch ganz ohne
//     Meldungen), zugewiesene Handlungsfeld-Fristen.
// Ist eine Trainer:in noch keiner Gruppe zugeordnet (Group.trainerIds ist
// rein organisatorisch und oft ungepflegt), gelten alle Gruppen als die
// eigenen — sonst bliebe ihr Kalender leer.
export function personalContext({ user, staff, athletes = [], groups = [] }) {
  const me = user?.athleteId ? athletes.find((a) => a.id === user.athleteId) || null : null;
  const coachGroupIds = staff ? new Set(groups.filter((g) => (g.trainerIds || []).includes(user?.id)).map((g) => g.id)) : new Set();
  const coachAllGroups = staff && coachGroupIds.size === 0;
  const coachAthleteIds = new Set(
    athletes.filter((a) => coachAllGroups || (a.groupId && coachGroupIds.has(a.groupId))).map((a) => a.id),
  );
  return { userId: user?.id ?? null, me, staff: !!staff, coachGroupIds, coachAllGroups, coachAthleteIds };
}

function coachesGroup(ctx, groupId) {
  if (!ctx.staff) return false;
  if (ctx.coachAllGroups || groupId == null) return true;
  return ctx.coachGroupIds.has(groupId);
}

const MINE = {
  training(ctx, { plan }) {
    if (ctx.me && plan.groupId === ctx.me.groupId) return true;
    return coachesGroup(ctx, plan.groupId);
  },
  session(ctx, { session }) {
    if (ctx.me && (session.attendance || []).some((a) => a.athleteId === ctx.me.id)) return true;
    if (ctx.staff && (session.coachIds || []).includes(ctx.userId)) return true;
    return coachesGroup(ctx, session.groupId);
  },
  competition(ctx, { entries }) {
    if (ctx.me && entries.some((e) => e.athleteId === ctx.me.id)) return true;
    if (!ctx.staff) return false;
    return ctx.coachAllGroups || entries.length === 0 || entries.some((e) => ctx.coachAthleteIds.has(e.athleteId));
  },
  deadline(ctx, { item }) {
    if (ctx.me && item.athleteId === ctx.me.id) return true;
    if (!ctx.staff) return false;
    if (item.assignedTrainerId) return item.assignedTrainerId === ctx.userId;
    return ctx.coachAthleteIds.has(item.athleteId);
  },
};

// Führt alle Quellen zu einer flachen, nach Datum sortierten Terminliste
// zusammen. `types` = die für die Person überhaupt verfügbaren Typen
// (Rollen + gebuchte Pakete, entscheidet calendar.js); Quellen anderer
// Typen werden gar nicht erst ausgewertet.
//
// Jeder Termin: { id, type, date, title, detail, route, source }
//   - title/detail: Anzeigetexte (detail darf leer sein)
//   - route: [routeId, param] zum Öffnen im Fachmodul (oder null)
//   - source: der zugrunde liegende Datensatz (für Tests/Details)
//
// `labels` liefert die übersetzten Texte, die nicht direkt aus den Daten
// stammen (siehe calendar.js) — so bleibt diese Datei frei von i18n.
export function collectEvents({ data = {}, types, scope = 'mine', ctx, labels = {} }) {
  const want = new Set(types);
  const mineOnly = scope === 'mine';
  const keep = (type, info) => !mineOnly || (MINE[type] ? MINE[type](ctx, info) : true);
  const groupName = new Map((data.groups || []).map((g) => [g.id, g.name]));
  const athleteName = new Map((data.athletes || []).map((a) => [a.id, `${a.firstName || ''} ${a.lastName || ''}`.trim()]));
  const label = (key, ...args) => (labels[key] ? labels[key](...args) : '');
  const events = [];

  if (want.has('training')) {
    for (const plan of data.plans || []) {
      if (!keep('training', { plan })) continue;
      (plan.days || []).forEach((day, i) => {
        if (!day?.date) return;
        events.push({
          id: `training:${plan.id}:${i}`, type: 'training', date: dateOnly(day.date),
          title: plan.name, detail: [groupName.get(plan.groupId), label('trainingDetail', day)].filter(Boolean).join(' · '),
          route: ['plans', plan.id], source: plan,
        });
      });
    }
  }

  if (want.has('session')) {
    for (const session of data.sessions || []) {
      if (!session?.date || !keep('session', { session })) continue;
      events.push({
        id: `session:${session.id}`, type: 'session', date: dateOnly(session.date),
        title: groupName.get(session.groupId) || label('sessionTitle', session),
        detail: label('sessionDetail', session),
        route: ['sessions', session.id], source: session,
      });
    }
  }

  if (want.has('competition')) {
    const entriesByComp = new Map();
    for (const e of data.entries || []) {
      if (!entriesByComp.has(e.competitionId)) entriesByComp.set(e.competitionId, []);
      entriesByComp.get(e.competitionId).push(e);
    }
    for (const comp of data.competitions || []) {
      if (!comp?.date) continue;
      const entries = entriesByComp.get(comp.id) || [];
      if (!keep('competition', { comp, entries })) continue;
      events.push({
        id: `competition:${comp.id}`, type: 'competition', date: dateOnly(comp.date),
        title: comp.name, detail: [comp.location, comp.course].filter(Boolean).join(' · '),
        route: ['competitions', comp.id], source: comp,
      });
      // Optionale Fristen erscheinen als eigene Termine desselben Typs —
      // gleiche Sichtbarkeit ("Meine"-Filter) und gleicher Filter-Chip wie
      // der Wettkampf selbst.
      for (const key of ['entryDeadline', 'selectionDeadline']) {
        if (!comp[key]) continue;
        events.push({
          id: `competition:${comp.id}:${key}`, type: 'competition', date: dateOnly(comp[key]),
          title: label(key, comp) || comp.name, detail: label('competitionDate', comp),
          route: ['competitions', comp.id], source: comp,
        });
      }
    }
  }

  if (want.has('deadline')) {
    for (const item of data.actionItems || []) {
      if (!item?.dueDate || item.status === 'done' || !keep('deadline', { item })) continue;
      events.push({
        id: `deadline:${item.id}`, type: 'deadline', date: dateOnly(item.dueDate),
        title: item.title, detail: athleteName.get(item.athleteId) || '',
        route: ['actionitems', item.id], source: item,
      });
    }
  }

  // Qualifikationen/Kampfrichtereinsätze kommen über eigene REST-Endpunkte
  // ("listMy…") und gehören damit immer der Person selbst — kein Filter.
  if (want.has('qualification')) {
    for (const q of data.qualifications || []) {
      if (q.expiresOn) {
        events.push({
          id: `qualification:${q.id}:expires`, type: 'qualification', date: dateOnly(q.expiresOn),
          title: label('qualificationExpires', q), detail: q.note || '',
          route: ['qualifications'], source: q,
        });
      }
      if (q.renewalCourseOrganizedOn) {
        events.push({
          id: `qualification:${q.id}:renewal`, type: 'qualification', date: dateOnly(q.renewalCourseOrganizedOn),
          title: label('qualificationRenewal', q), detail: q.note || '',
          route: ['qualifications'], source: q,
        });
      }
    }
  }

  if (want.has('referee')) {
    for (const a of data.refereeAssignments || []) {
      if (!a?.date) continue;
      events.push({
        id: `referee:${a.id}`, type: 'referee', date: dateOnly(a.date),
        title: a.competitionName, detail: [label('refereeFunction', a), a.competitionPlace].filter(Boolean).join(' · '),
        route: ['kampfrichter'], source: a,
      });
    }
  }

  const order = (type) => EVENT_TYPES.indexOf(type);
  return events.sort((a, b) => a.date.localeCompare(b.date) || order(a.type) - order(b.type) || a.title.localeCompare(b.title));
}

export function eventsInRange(events, start, end, activeTypes) {
  const active = activeTypes ? new Set(activeTypes) : null;
  return events.filter((e) => e.date >= start && e.date <= end && (!active || active.has(e.type)));
}

export function groupByDate(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

export function countByType(events) {
  const counts = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0]));
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}
