import type { ParentCalendarChild } from '@lane1/shared-types';
import { shapeChildCalendar, type DateRange, type ParentCalendarGateway, type RawChildCalendar } from './parents.calendar.repository.js';

// Für Tests: Rohdaten je Athlet:in, durch dieselbe Datenminimierung wie im
// Prisma-Gateway (shapeChildCalendar) geschickt.
export class InMemoryParentCalendarGateway implements ParentCalendarGateway {
  constructor(private readonly rawByAthleteId: Map<string, RawChildCalendar> = new Map()) {}

  async buildChildCalendar(athleteId: string, range: DateRange): Promise<ParentCalendarChild | null> {
    const raw = this.rawByAthleteId.get(athleteId);
    return raw ? shapeChildCalendar(raw, range) : null;
  }
}
