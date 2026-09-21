// Repository-Pattern (wie überall sonst im Backend) — clubLegalInfo.service.ts
// hängt nur von diesem Interface ab, nie direkt von Prisma. Liest/schreibt
// dieselbe `clubs`-Tabelle wie invitations.repository.ts (PrismaClubRepository),
// aber ausschließlich die rechtlichen Zusatzfelder (siehe schema.prisma:
// Club-Modell) — ein eigenes, schlankes Interface statt des vollen
// ClubRepository, damit dieses Modul nicht versehentlich Zugriff auf
// enabledModules/nationalID o. ä. bekommt, die es nicht braucht.
import type { PrismaClient } from '@prisma/client';

export interface ClubLegalInfoRecord {
  clubId: string;
  // Nur lesend (siehe ClubLegalInfoSchema in packages/shared-types) — wird
  // weiterhin über PrismaClubRepository (invitations.repository.ts)
  // gepflegt, hier nur zusätzlich für die Impressum-Anzeige mitgeliefert.
  name: string;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  representativeName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  registerNumber: string | null;
  registerCourt: string | null;
  vatId: string | null;
  privacyContactEmail: string | null;
  supervisoryAuthority: string | null;
  dpoRequired: boolean;
  dpoName: string | null;
  dpoContact: string | null;
  updatedAt: Date;
}

export interface UpdateClubLegalInfoInput {
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  representativeName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  registerNumber: string | null;
  registerCourt: string | null;
  vatId: string | null;
  privacyContactEmail: string | null;
  supervisoryAuthority: string | null;
  dpoRequired: boolean;
  dpoName: string | null;
  dpoContact: string | null;
}

export interface ClubLegalInfoRepository {
  // null, wenn kein Verein mit dieser clubId existiert — der Aufrufer
  // (clubLegalInfo.service.ts) prüft das VOR jedem update(), damit
  // update() selbst nie gegen eine nicht existierende clubId aufgerufen
  // wird (kein Bedarf, hier ein Prisma-"record not found" abzufangen).
  findByClubId(clubId: string): Promise<ClubLegalInfoRecord | null>;
  update(clubId: string, data: UpdateClubLegalInfoInput): Promise<ClubLegalInfoRecord>;
}

const LEGAL_INFO_SELECT = {
  id: true,
  name: true,
  addressLine1: true,
  postalCode: true,
  city: true,
  representativeName: true,
  contactEmail: true,
  contactPhone: true,
  registerNumber: true,
  registerCourt: true,
  vatId: true,
  privacyContactEmail: true,
  supervisoryAuthority: true,
  dpoRequired: true,
  dpoName: true,
  dpoContact: true,
  updatedAt: true,
} as const;

function toRecord(club: { id: string } & Omit<ClubLegalInfoRecord, 'clubId'>): ClubLegalInfoRecord {
  const { id, ...rest } = club;
  return { clubId: id, ...rest };
}

export class PrismaClubLegalInfoRepository implements ClubLegalInfoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByClubId(clubId: string): Promise<ClubLegalInfoRecord | null> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: LEGAL_INFO_SELECT });
    return club ? toRecord(club) : null;
  }

  async update(clubId: string, data: UpdateClubLegalInfoInput): Promise<ClubLegalInfoRecord> {
    const club = await this.prisma.club.update({ where: { id: clubId }, data, select: LEGAL_INFO_SELECT });
    return toRecord(club);
  }
}
