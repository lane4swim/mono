// Datenzugriff für den Eltern-Kalender (GET /api/parents/calendar) —
// analog parents.overview.repository.ts serverseitig aus den bestehenden
// Tabellen zusammengestellt, bewusst KEIN Sync-Zugriff für "parent".
//
// shapeChildCalendar() ist die eigentliche Datenminimierung und kennt kein
// Prisma, damit sie ohne Datenbank getestet werden kann: was dort nicht
// ausdrücklich übernommen wird, verlässt den Server nicht.
import type { PrismaClient } from '@prisma/client';
import type { ParentCalendarChild } from '@lane1/shared-types';

export interface DateRange {
  from: Date; // inklusive, 00:00 UTC
  to: Date; // inklusive, 00:00 UTC des letzten Tages
}

export interface ParentCalendarGateway {
  // null, wenn das Athletenprofil nicht mehr existiert (verwaiste Verknüpfung).
  buildChildCalendar(athleteId: string, range: DateRange): Promise<ParentCalendarChild | null>;
}

// Rohdaten, wie sie aus der Datenbank kommen (nur die gelesenen Felder).
export interface RawChildCalendar {
  athlete: { id: string; clubId: string; firstName: string; lastName: string; groupId: string | null; group: { id: string; name: string } | null };
  calendarEntries: Array<{
    id: string; clubId: string; kind: string; title: string; startDate: Date; endDate: Date; groupId: string | null;
    weekdays: number[]; startTime: string | null; endTime: string | null; pauseDuring: string[]; location: string;
  }>;
  plans: Array<{ id: string; clubId: string; name: string; groupId: string | null; days: unknown }>;
  sessions: Array<{ id: string; clubId: string; date: Date; groupId: string | null; attendance: unknown }>;
  entries: Array<{
    id: string; athleteId: string;
    competition: { id: string; clubId: string; name: string; date: Date; location: string; course: string; entryDeadline: Date | null; selectionDeadline: Date | null; deletedAt: Date | null } | null;
  }>;
}

const DAY_MS = 86_400_000;
const endOfRange = (range: DateRange) => range.to.getTime() + DAY_MS - 1;
const inRange = (d: Date, range: DateRange) => d.getTime() >= range.from.getTime() && d.getTime() <= endOfRange(range);

export function shapeChildCalendar(raw: RawChildCalendar, range: DateRange): ParentCalendarChild {
  const { athlete } = raw;
  const sameClub = <T extends { clubId: string }>(row: T) => row.clubId === athlete.clubId;
  // Gruppenbezogenes nur der eigenen Gruppe (oder vereinsweit).
  const ownGroup = (groupId: string | null) => groupId === null || groupId === athlete.groupId;

  const calendarEntries = raw.calendarEntries
    .filter((e) => sameClub(e) && ownGroup(e.groupId))
    .filter((e) => e.startDate.getTime() <= endOfRange(range) && e.endDate.getTime() >= range.from.getTime())
    .map((e) => ({
      id: e.id, kind: e.kind, title: e.title, startDate: e.startDate.toISOString(), endDate: e.endDate.toISOString(),
      groupId: e.groupId, weekdays: e.weekdays, startTime: e.startTime, endTime: e.endTime, pauseDuring: e.pauseDuring, location: e.location,
    }));

  // Pläne nur als Termine (Datum), ohne Sätze/Kommentare.
  const plans = raw.plans
    .filter((p) => sameClub(p) && athlete.groupId !== null && p.groupId === athlete.groupId)
    .map((p) => {
      const days = (Array.isArray(p.days) ? p.days : [])
        .map((d) => (d && typeof d === 'object' && typeof (d as { date?: unknown }).date === 'string' ? new Date((d as { date: string }).date) : null))
        .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()) && inRange(d, range))
        .map((d) => ({ date: d.toISOString() }));
      return { id: p.id, name: p.name, groupId: p.groupId, days };
    })
    .filter((p) => p.days.length > 0);

  // Einheiten nur mit eigener Anwesenheit — und davon nur "anwesend".
  const sessions = raw.sessions
    .filter((s) => sameClub(s) && inRange(s.date, range))
    .flatMap((s) => {
      const own = (Array.isArray(s.attendance) ? s.attendance : [])
        .find((a) => a && typeof a === 'object' && (a as { athleteId?: unknown }).athleteId === athlete.id) as { present?: unknown } | undefined;
      if (!own) return [];
      return [{ id: s.id, date: s.date.toISOString(), groupId: s.groupId, attendance: [{ athleteId: athlete.id, present: own.present === true }] }];
    });

  // Wettkämpfe mit eigener Meldung, deren Datum oder Fristen im Zeitraum liegen.
  const competitions = new Map<string, ParentCalendarChild['competitions'][number]>();
  const entries: ParentCalendarChild['entries'] = [];
  for (const e of raw.entries) {
    const c = e.competition;
    if (!c || c.deletedAt || e.athleteId !== athlete.id || !sameClub(c)) continue;
    if (![c.date, c.entryDeadline, c.selectionDeadline].some((d) => d && inRange(d, range))) continue;
    competitions.set(c.id, {
      id: c.id, name: c.name, date: c.date.toISOString(), location: c.location, course: c.course,
      entryDeadline: c.entryDeadline?.toISOString() ?? null, selectionDeadline: c.selectionDeadline?.toISOString() ?? null,
    });
    entries.push({ id: e.id, competitionId: c.id, athleteId: athlete.id });
  }

  return {
    athlete: { id: athlete.id, firstName: athlete.firstName, lastName: athlete.lastName, groupId: athlete.groupId },
    groups: athlete.group ? [{ id: athlete.group.id, name: athlete.group.name }] : [],
    calendarEntries,
    plans,
    sessions,
    competitions: [...competitions.values()],
    entries,
  };
}

// Pläne umfassen höchstens 60 Tage ab weekStart (PlanSchema.days.max) —
// ein Plan, der vor `from - 62 Tage` beginnt, kann keinen Tag im Zeitraum haben.
const PLAN_LOOKBACK_MS = 62 * DAY_MS;

export class PrismaParentCalendarGateway implements ParentCalendarGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async buildChildCalendar(athleteId: string, range: DateRange): Promise<ParentCalendarChild | null> {
    const athlete = await this.prisma.athlete.findFirst({
      where: { id: athleteId, deletedAt: null },
      select: { id: true, clubId: true, firstName: true, lastName: true, groupId: true, group: { select: { id: true, name: true } } },
    });
    if (!athlete) return null;
    const end = new Date(endOfRange(range));

    const [calendarEntries, plans, sessions, entries] = await Promise.all([
      this.prisma.calendarEntry.findMany({
        where: {
          clubId: athlete.clubId, deletedAt: null, startDate: { lte: end }, endDate: { gte: range.from },
          OR: [{ groupId: null }, ...(athlete.groupId ? [{ groupId: athlete.groupId }] : [])],
        },
      }),
      athlete.groupId
        ? this.prisma.plan.findMany({
            where: { clubId: athlete.clubId, groupId: athlete.groupId, deletedAt: null, weekStart: { gte: new Date(range.from.getTime() - PLAN_LOOKBACK_MS), lte: end } },
            select: { id: true, clubId: true, name: true, groupId: true, days: true },
          })
        : Promise.resolve([]),
      this.prisma.trainingSession.findMany({
        where: { clubId: athlete.clubId, deletedAt: null, date: { gte: range.from, lte: end } },
        select: { id: true, clubId: true, date: true, groupId: true, attendance: true },
      }),
      this.prisma.startlistEntry.findMany({
        where: { athleteId, deletedAt: null },
        select: {
          id: true, athleteId: true,
          competition: { select: { id: true, clubId: true, name: true, date: true, location: true, course: true, entryDeadline: true, selectionDeadline: true, deletedAt: true } },
        },
      }),
    ]);

    return shapeChildCalendar({ athlete, calendarEntries, plans, sessions, entries }, range);
  }
}
