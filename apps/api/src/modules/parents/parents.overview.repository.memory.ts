import type { ParentChildOverview } from '@lane1/shared-types';
import type { ParentOverviewGateway } from './parents.overview.repository.js';

export class InMemoryParentOverviewGateway implements ParentOverviewGateway {
  constructor(private readonly overviewByAthleteId: Map<string, ParentChildOverview> = new Map()) {}

  async buildChildOverview(athleteId: string): Promise<ParentChildOverview | null> {
    return this.overviewByAthleteId.get(athleteId) ?? null;
  }
}
