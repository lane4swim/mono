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
  // docs/Plans/kampfrichter-modul-plan.md, Abschnitt 1: ein Konto kann mehrere
  // Rollen gleichzeitig haben. Die transitionelle, einzelne "role"-Spalte
  // (schema.prisma) ist bewusst NICHT Teil dieses Interfaces mehr — sie
  // wird ausschließlich innerhalb von PrismaUserRepository (unten) als
  // roles[0] mitgepflegt, kein Aufrufer dieses Moduls soll sich noch auf
  // sie verlassen.
  roles: string[];
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
  roles: string[];
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
  // PATCH /api/users/:userId/roles (docs/Plans/kampfrichter-modul-plan.md,
  // Abschnitt 1.4) — ersetzt die vollständige Rollenmenge, kein
  // Add/Remove-Diff.
  roles?: string[];
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
  // Widerruft das Token atomar NUR, wenn es noch nicht widerrufen ist, und
  // meldet, ob DIESER Aufruf es widerrufen hat. refresh() liefert ein neues
  // Token-Paar nur bei `true` aus — sonst lösen zwei gleichzeitige Anfragen
  // mit demselben Token beide ein (lesen → prüfen → schreiben).
  consume(id: string): Promise<boolean>;
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
  // Markiert das Token atomar NUR, wenn es noch unbenutzt ist, und meldet,
  // ob DIESER Aufruf es eingelöst hat — zwei gleichzeitige Einlöseversuche
  // desselben Links können so nicht beide erfolgreich sein.
  consume(id: string): Promise<boolean>;
  // Entwertet zusätzlich jeden ANDEREN offenen Reset-Link des Kontos: nach
  // einem Passwortwechsel (Reset oder regulär) soll keiner davon erneut
  // einen Wechsel samt Auto-Login auslösen können.
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
  // Schreibt zusätzlich zu "roles" weiterhin die transitionelle "role"-
  // Spalte (roles[0] — der "primäre" Wert) mit, damit die Datenbank-
  // Constraint (NOT NULL, kein Default, siehe schema.prisma) erfüllt
  // bleibt und ein direkter SQL-Blick auf "role" währenddessen einen
  // plausiblen Wert zeigt. Kein Aufrufer außerhalb dieser Klasse kennt
  // "role" noch (siehe UserRecord-Kommentar oben) — wird entfernt, sobald
  // die Spalte selbst per eigener Migration verschwindet (docs/
  // kampfrichter-modul-plan.md, Abschnitt 1.3, "Contract").
  async create(input: CreateUserInput): Promise<UserRecord> {
    const { roles, ...rest } = input;
    return this.prisma.user.create({ data: { ...rest, role: roles[0]!, roles, athleteId: input.athleteId ?? null } });
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
    // Spiegelt roles[0] weiterhin in die transitionelle "role"-Spalte,
    // analog zu create() oben — nur wenn roles tatsächlich Teil dieses
    // Patches ist (sonst bliebe "role" sonst fälschlich auf dem alten
    // Wert stehenbleiben, was hier aber ohnehin unverändert bliebe, da
    // updateMany() nur die im data-Objekt genannten Felder ändert; die
    // explizite Ergänzung dient nur der Lesbarkeit).
    const data = input.roles ? { ...input, role: input.roles[0]! } : input;
    const result = await this.prisma.user.updateMany({ where: { id, deletedAt: null }, data });
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
  async consume(id: string): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
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
  async consume(id: string): Promise<boolean> {
    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  async markAllUsedForUser(userId: string): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  }
}
