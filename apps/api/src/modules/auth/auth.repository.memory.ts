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
} from './auth.repository.js';

export class InMemoryUserRepository implements UserRepository {
  private usersById = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.usersById.values()) {
      if (user.email === email && !user.deletedAt) return { ...user };
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.usersById.get(id);
    return user ? { ...user } : null;
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

  async update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error(`Kein Nutzer mit id ${id} gefunden.`);
    const updated: UserRecord = { ...existing, ...input, updatedAt: new Date() };
    this.usersById.set(id, updated);
    return { ...updated };
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
