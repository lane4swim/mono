// apps/api/src/modules/invitations/invitations.repository.memory.ts
//
// Test-Doubles für ClubRepository/InvitationRepository — siehe
// modules/auth/auth.repository.memory.ts für dasselbe Prinzip.
import { randomUUID } from 'node:crypto';
import type {
  ClubRepository,
  ClubRecord,
  CreateClubInput,
  ClubMemberCounts,
  InvitationRepository,
  InvitationRecord,
  CreateInvitationInput,
} from './invitations.repository.js';

// Minimale Form eines Nutzer-Datensatzes, wie sie für die Zählung
// gebraucht wird — bewusst nicht auf UserRecord aus modules/auth
// angewiesen, um keine Modul-Kopplung zwischen auth und invitations
// einzuführen.
export interface CountableUser {
  clubId: string | null;
  role: string;
  deletedAt?: Date | null;
}

export class InMemoryClubRepository implements ClubRepository {
  private clubsById = new Map<string, ClubRecord>();

  // Wird von Tests gesetzt, um countMembersForClubs() mit Nutzerdaten zu
  // füttern — Standard: keine Nutzer, alle Zählungen sind 0.
  constructor(private readonly getUsers: () => CountableUser[] = () => []) {}

  async create(input: CreateClubInput): Promise<ClubRecord> {
    const now = new Date();
    const club: ClubRecord = { id: randomUUID(), name: input.name, createdAt: now, updatedAt: now };
    this.clubsById.set(club.id, club);
    return { ...club };
  }
  async findById(id: string): Promise<ClubRecord | null> {
    const club = this.clubsById.get(id);
    return club ? { ...club } : null;
  }
  async list(): Promise<ClubRecord[]> {
    return [...this.clubsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async countMembersForClubs(clubIds: string[]): Promise<Map<string, ClubMemberCounts>> {
    const result = new Map<string, ClubMemberCounts>();
    for (const clubId of clubIds) result.set(clubId, { admin: 0, trainer: 0, athlete: 0 });
    for (const user of this.getUsers()) {
      if (user.deletedAt) continue;
      if (!user.clubId || !result.has(user.clubId)) continue;
      const counts = result.get(user.clubId)!;
      switch (user.role) {
        case 'admin': counts.admin += 1; break;
        case 'trainer': counts.trainer += 1; break;
        case 'athlete': counts.athlete += 1; break;
        default: break;
      }
    }
    return result;
  }
}

export class InMemoryInvitationRepository implements InvitationRepository {
  private invitationsById = new Map<string, InvitationRecord>();

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    const invitation: InvitationRecord = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      email: input.email,
      role: input.role,
      clubId: input.clubId,
      athleteId: input.athleteId,
      invitedById: input.invitedById,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invitationsById.set(invitation.id, invitation);
    return { ...invitation };
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    for (const invitation of this.invitationsById.values()) {
      if (invitation.tokenHash === tokenHash) return { ...invitation };
    }
    return null;
  }

  async findById(id: string): Promise<InvitationRecord | null> {
    const invitation = this.invitationsById.get(id);
    return invitation ? { ...invitation } : null;
  }

  async listByClub(clubId: string): Promise<InvitationRecord[]> {
    return [...this.invitationsById.values()]
      .filter((i) => i.clubId === clubId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listAll(): Promise<InvitationRecord[]> {
    return [...this.invitationsById.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async markUsed(id: string): Promise<void> {
    const existing = this.invitationsById.get(id);
    if (existing) this.invitationsById.set(id, { ...existing, usedAt: new Date() });
  }

  async revoke(id: string): Promise<void> {
    const existing = this.invitationsById.get(id);
    if (existing) this.invitationsById.set(id, { ...existing, revokedAt: new Date() });
  }
}
