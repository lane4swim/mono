// apps/api/src/modules/auth/auth.repository.memory.ts
//
// Test-Doubles für UserRepository/RefreshTokenRepository. Ermöglichen
// schnelle, isolierte Tests der Auth-Business-Logik ohne Postgres/Prisma —
// insbesondere relevant, solange keine echte Datenbank verfügbar ist
// (z. B. in einer Sandbox ohne Docker). In CI mit echter Postgres-Instanz
// (siehe .github/workflows/ci.yml) kämen ergänzend Integrationstests gegen
// PrismaUserRepository/PrismaRefreshTokenRepository hinzu.
import { randomUUID } from 'node:crypto';
import type {
  UserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
  RefreshTokenRepository,
  RefreshTokenRecord,
  PasswordResetTokenRepository,
  PasswordResetTokenRecord,
} from './auth.repository.js';

export class InMemoryUserRepository implements UserRepository {
  private usersById = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.usersById.values()) {
      if (user.email === email && !user.deletedAt) return { ...user };
    }
    return null;
  }

  // Wie findByEmail(): liefert nur aktive (nicht gelöschte) Konten (siehe
  // PrismaUserRepository.findById() für die Begründung).
  async findById(id: string): Promise<UserRecord | null> {
    const user = this.usersById.get(id);
    return user && !user.deletedAt ? { ...user } : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      clubId: input.clubId,
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      athleteId: input.athleteId ?? null,
      locale: 'de-DE',
      consentGivenAt: input.consentGivenAt,
      consentVersion: input.consentVersion,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.usersById.set(user.id, user);
    return { ...user };
  }

  // Spiegelt PrismaUserRepository.update() (Code-Review, Befund S5): ein
  // bereits soft-gelöschtes Konto gilt hier wie bei findById()/
  // findByEmail() als "nicht gefunden" — sonst könnte dieses Double eine
  // Regression durchwinken, die die echte Implementierung längst
  // ausschließt (genau die Art Auseinanderlaufen, vor der mehrere andere
  // Kommentare in diesem Modul bereits warnen).
  async update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    const existing = this.usersById.get(id);
    if (!existing || existing.deletedAt) {
      const err = new Error('An operation failed because it depends on one or more records that were required but not found. No record was found for an update.') as Error & { code: string };
      err.code = 'P2025';
      throw err;
    }
    const updated: UserRecord = { ...existing, ...input, updatedAt: new Date() };
    this.usersById.set(id, updated);
    return { ...updated };
  }

  async listByClub(clubId: string): Promise<UserRecord[]> {
    return [...this.usersById.values()].filter((u) => u.clubId === clubId && !u.deletedAt).map((u) => ({ ...u }));
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private tokensById = new Map<string, RefreshTokenRecord>();

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord> {
    const token: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.tokensById.set(token.id, token);
    return { ...token };
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const token of this.tokensById.values()) {
      if (token.tokenHash === tokenHash) return { ...token };
    }
    return null;
  }

  async revoke(id: string): Promise<void> {
    const existing = this.tokensById.get(id);
    if (existing) this.tokensById.set(id, { ...existing, revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const [tokenId, token] of this.tokensById.entries()) {
      if (token.userId === userId && !token.revokedAt) {
        this.tokensById.set(tokenId, { ...token, revokedAt: new Date() });
      }
    }
  }
}

export class InMemoryPasswordResetTokenRepository implements PasswordResetTokenRepository {
  private tokensById = new Map<string, PasswordResetTokenRecord>();

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenRecord> {
    const token: PasswordResetTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.tokensById.set(token.id, token);
    return { ...token };
  }

  async findByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    for (const token of this.tokensById.values()) {
      if (token.tokenHash === tokenHash) return { ...token };
    }
    return null;
  }

  async markUsed(id: string): Promise<void> {
    const existing = this.tokensById.get(id);
    if (existing) this.tokensById.set(id, { ...existing, usedAt: new Date() });
  }

  // Sicherheitsreview 2026-08-27, Befund N4 — siehe Kommentar am
  // Interface in auth.repository.ts.
  async markAllUsedForUser(userId: string): Promise<void> {
    for (const [id, token] of this.tokensById.entries()) {
      if (token.userId === userId && !token.usedAt) {
        this.tokensById.set(id, { ...token, usedAt: new Date() });
      }
    }
  }
}
