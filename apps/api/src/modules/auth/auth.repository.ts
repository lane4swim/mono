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
  // Sicherheitsreview 2026-08, Befund M5 (Passwortwechsel/-Reset) — beide
  // Flüsse (auth.service.ts: changePassword()/resetPassword()) rufen
  // update() erst NACH bereits erfolgter Verifikation (aktuelles Passwort
  // bzw. gültiges Reset-Token) auf; diese Methode selbst prüft nichts,
  // sie schreibt nur den bereits gehashten Wert.
  passwordHash?: string;
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

// "Passwort vergessen"-Flow (Sicherheitsreview 2026-08, Befund M5) — siehe
// schema.prisma: PasswordResetToken für die Begründung (kurzlebig,
// einmalig einlösbar, analog zu RefreshToken/Invitation).
export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PasswordResetTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenRecord>;
  findByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  markUsed(id: string): Promise<void>;
  // Sicherheitsreview 2026-08-27, Befund N4: markUsed(id) allein
  // invalidierte nur GENAU das eingelöste Token — bei mehreren innerhalb
  // der TTL angeforderten Reset-Links (z. B. 3 pro 15 Minuten, siehe
  // Rate-Limit auf /auth/forgot-password) blieben die übrigen bis zu ihrem
  // eigenen Ablauf gültig und lösten JEWEILS erneut einen Passwortwechsel
  // samt Auto-Login aus. Ein Passwort-Reset gilt als mögliches
  // Kompromittierungssignal (siehe resetPassword()-Kommentar in
  // auth.service.ts) — genau dann sollen auch alle ANDEREN, noch nicht
  // eingelösten Reset-Links desselben Kontos verfallen, nicht nur der
  // gerade benutzte. Ersetzt markUsed(existing.id) in resetPassword()
  // vollständig (deckt das eingelöste Token mit ab, da dessen usedAt zu
  // diesem Zeitpunkt noch null ist) und wird zusätzlich von
  // changePassword() aufgerufen — ein regulärer Passwortwechsel soll
  // ebenso keinen zuvor angeforderten, noch offenen Reset-Link überleben
  // lassen.
  markAllUsedForUser(userId: string): Promise<void>;
}

// ---- Prisma-Implementierungen (Produktionsbetrieb) ------------------------

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Sicherheitsreview 2026-08-29, Befund M2: `mode: 'insensitive'`
  // ergänzt. Die Eingabe-Schemas normalisieren neue Adressen zwar bereits
  // auf Kleinschreibung (siehe NormalizedEmailSchema in
  // packages/shared-types/src/user.ts) — BEREITS gespeicherte Adressen in
  // gemischter Schreibweise blieben davon aber unberührt und wären mit
  // einem zeichengenauen Vergleich ab sofort NICHT MEHR anmeldbar
  // gewesen. Der case-insensitive Abgleich deckt beide Bestände ab, ohne
  // eine Datenmigration zu erzwingen, die an bereits existierenden
  // Doppelkonten (zwei Zeilen, die sich nur in der Schreibweise
  // unterscheiden) scheitern könnte, und schließt zugleich die
  // Umgehbarkeit der Duplikat-Prüfungen in acceptInvitation()/
  // changeEmail() (siehe auth.service.ts).
  //
  // Zum Preis: `citext`/ein funktionaler Index existiert nicht, die
  // Abfrage nutzt den `email`-Unique-Index also nicht mehr. Für die
  // Größenordnung dieser Tabelle (Vereinsmitglieder, nicht Endkunden
  // eines Massendienstes) ist der sequentielle Scan unkritisch; wächst
  // die Instanz über diese Annahme hinaus, ist ein Index auf
  // `lower("email")` plus eine einmalige Normalisierungs-Migration der
  // nächste Schritt.
  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null } });
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

export class PrismaPasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenRecord> {
    return this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }
  async findByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    return this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  }
  async markUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  async markAllUsedForUser(userId: string): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  }
}
