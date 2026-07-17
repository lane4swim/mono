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
  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
  async create(input: CreateUserInput): Promise<UserRecord> {
    return this.prisma.user.create({ data: { ...input, athleteId: input.athleteId ?? null } });
  }
  async update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    return this.prisma.user.update({ where: { id }, data: input });
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
