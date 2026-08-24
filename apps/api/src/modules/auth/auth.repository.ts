// apps/api/src/modules/auth/auth.repository.ts
//
// Repository-Pattern: auth.service.ts hängt nur von diesen Interfaces ab,
// nie direkt von Prisma. Das hat zwei Vorteile — (1) die Business-Logik
// lässt sich mit einer In-Memory-Implementierung (auth.repository.memory.ts)
// vollständig ohne Datenbank testen, (2) ein späterer Wechsel der
// Persistenzschicht bliebe auf diese Datei begrenzt.
import type { PrismaClient } from '@prisma/client';

export interface UserRecord {
  id: string;
  clubId: string | null;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  athleteId: string | null;
  locale: string;
  // DSGVO: Zeitpunkt/Version der zuletzt bestätigten Einwilligung.
  consentGivenAt: Date | null;
  consentVersion: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  clubId: string | null;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  athleteId?: string | null;
  consentGivenAt: Date;
  consentVersion: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  locale?: string;
  consentGivenAt?: Date;
  consentVersion?: string;
  deletedAt?: Date | null;
}

export interface UserRepository {
  // findByEmail() liefert bewusst NUR aktive (nicht gelöschte) Konten —
  // ein Login-Versuch auf ein bereits zur Löschung vorgemerktes Konto muss
  // fehlschlagen, siehe auth.service.ts.
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  update(id: string, input: UpdateUserInput): Promise<UserRecord>;
  // Für die Nutzerverwaltung ("GET /api/users"): alle aktiven (nicht
  // gelöschten) Mitglieder eines Vereins.
  listByClub(clubId: string): Promise<UserRecord[]>;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

// ---- Prisma-Implementierungen (Produktionsbetrieb) ------------------------

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }
  // Liefert wie findByEmail() bewusst NUR aktive (nicht gelöschte) Konten —
  // sonst funktionieren refresh()/getMe()/updateMe() (siehe auth.service.ts)
  // für ein bereits zur Löschung vorgemerktes Konto weiter, solange noch
  // ein gültiges Access/Refresh Token existiert.
  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }
  async create(input: CreateUserInput): Promise<UserRecord> {
    return this.prisma.user.create({ data: { ...input, athleteId: input.athleteId ?? null } });
  }
  // Sicherheitskorrektur (Code-Review, Befund S5): `findByEmail()`/
  // `findById()`/`listByClub()` oben filtern bewusst und dokumentiert auf
  // `deletedAt: null` — `update()` tat das bislang NICHT (`where: { id }`
  // allein). In der Praxis rufen beide heutigen Aufrufer (auth.service.ts:
  // login()/updateMe()) `update()` erst NACH einem bereits aktiv-
  // gescopten `findById()`/`findByEmail()`, weshalb der Fall bislang nicht
  // beobachtbar war — aber ein dazwischen (z. B. durch eine gleichzeitige
  // DSGVO-Löschanfrage) soft-gelöschtes Konto hätte die Aktualisierung
  // trotzdem stillschweigend übernommen, statt sie wie jede andere
  // Operation auf einem bereits gelöschten Konto abzulehnen. `updateMany`
  // mit `{ id, deletedAt: null }` in der where-Klausel schließt die Lücke
  // strukturell, statt sich auf die Aufrufreihenfolge der Aufrufer zu
  // verlassen. `updateMany` liefert (anders als `update`) keinen
  // aktualisierten Datensatz zurück — bei `count: 0` (nicht gefunden ODER
  // bereits gelöscht) wird deshalb ein zu Prismas eigenem "Record not
  // found" (P2025) gleichgeformter Fehler geworfen, damit sich diese
  // Methode für Aufrufer weiterhin identisch zu einem echten
  // `prisma.user.update()` auf eine nicht (mehr) existente id verhält.
  async update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    const result = await this.prisma.user.updateMany({ where: { id, deletedAt: null }, data: input });
    if (result.count === 0) {
      const err = new Error('An operation failed because it depends on one or more records that were required but not found. No record was found for an update.') as Error & { code: string };
      err.code = 'P2025';
      throw err;
    }
    return (await this.findById(id))!;
  }
  async listByClub(clubId: string): Promise<UserRecord[]> {
    return this.prisma.user.findMany({ where: { clubId, deletedAt: null } });
  }
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }
  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }
  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
