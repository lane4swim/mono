// apps/api/src/modules/invitations/invitations.service.ts
//
// Geschäftslogik für den einladungsbasierten Registrierungsprozess:
//   - createClub(): NUR superadmin. Legt einen Verein an und erzeugt in
//     einem Zug die Einladung für dessen ersten Admin, inkl. E-Mail-Versand.
//   - createInvitation(): admin lädt trainer/athlete für den EIGENEN Verein
//     ein; superadmin lädt admin für einen BESTEHENDEN Verein ein (und darf,
//     als Obermenge der Admin-Rechte, auch trainer/athlete für einen
//     beliebigen Verein einladen — muss dafür clubId explizit angeben, da
//     ein Superadmin selbst zu keinem Verein gehört).
//   - listClubs(): liefert für die Superadmin-Oberfläche ("/admin") je
//     Verein zusätzlich die Anzahl aktiver Admins/Trainer:innen/Athlet:innen.
import type { CreateInvitationRequest, InvitationRole } from '@lane1/shared-types';
import type { ClubRepository, InvitationRepository, InvitationRecord, ClubRecord, ClubMemberCounts, AthleteRepository } from './invitations.repository.js';
import { generateInvitationToken, hashInvitationToken } from '../../auth/tokens.js';
import type { MailSender } from '../../mail/mailer.js';
import type { UserRepository } from '../auth/auth.repository.js';

export class ForbiddenError extends Error {
  constructor(message = 'Für diese Aktion fehlt die Berechtigung.') {
    super(message);
  }
}
export class ClubNotFoundError extends Error {
  constructor() {
    super('Verein wurde nicht gefunden.');
  }
}
export class AthleteNotFoundError extends Error {
  constructor() {
    super('Das referenzierte Athletenprofil wurde nicht gefunden.');
  }
}
export class AthleteClubMismatchError extends Error {
  constructor() {
    super('Das referenzierte Athletenprofil gehört nicht zum Zielverein dieser Einladung.');
  }
}
export class InvitationNotFoundError extends Error {
  constructor() {
    super('Einladung wurde nicht gefunden.');
  }
}
export class InvitationExpiredError extends Error {
  constructor() {
    super('Diese Einladung ist abgelaufen.');
  }
}
export class InvitationAlreadyUsedError extends Error {
  constructor() {
    super('Diese Einladung wurde bereits verwendet.');
  }
}
export class InvitationRevokedError extends Error {
  constructor() {
    super('Diese Einladung wurde widerrufen.');
  }
}

export interface RequesterContext {
  id: string;
  role: string; // 'superadmin' | 'admin' | 'trainer' | 'athlete'
  clubId: string | null;
}

export interface InvitationsServiceDeps {
  clubs: ClubRepository;
  invitations: InvitationRepository;
  // Für die Validierung einer mitgeschickten athleteId gegen den
  // Zielverein (siehe Sicherheitsreview, Punkt 3) — verhindert, dass ein
  // Admin ein neues Konto an das Athletenprofil eines FREMDEN Vereins
  // koppelt.
  athletes: AthleteRepository;
  // Nur für den Blick auf die Locale der einladenden Person (siehe
  // resolveRequesterLocale() unten) — keine sonstige Nutzerverwaltung
  // gehört in diesen Service.
  users: UserRepository;
  mailer: MailSender;
  // Basis-URL des Frontends, um den Einladungslink zu bauen (z. B.
  // "https://training.mein-verein.de") — die eigentliche Annahme-Seite
  // liegt im normalen Frontend unter "#/accept-invite/<token>", NICHT
  // unter "/admin" (die Superadmin-Oberfläche dient nur dem Anlegen).
  frontendBaseUrl: string;
  clubInvitationTtlDays: number;
  memberInvitationTtlDays: number;
}

function buildInviteUrl(frontendBaseUrl: string, token: string): string {
  return `${frontendBaseUrl.replace(/\/+$/, '')}/#/accept-invite/${token}`;
}

// Die eingeladene Person hat noch kein Konto und damit keine eigene
// Locale — die Sprache der einladenden Person (User.locale) ist die
// einzige zu diesem Zeitpunkt bekannte, plausible Wahl für die
// Einladungs-E-Mail (Code-Review, Befund W9). mailer.ts fällt bei einer
// unbekannten/fehlenden Locale ohnehin auf Deutsch zurück, daher hier
// bewusst kein weiterer Fallback nötig.
async function resolveRequesterLocale(users: UserRepository, requesterId: string): Promise<string | undefined> {
  const requesterUser = await users.findById(requesterId);
  return requesterUser?.locale;
}

// Zentrale Gültigkeitsprüfung — von preview() UND von authService beim
// tatsächlichen Registrieren (acceptInvitation) genutzt, damit beide
// Stellen exakt dieselbe Definition von "gültig" verwenden. Als
// eigenständige Funktion (statt Methode auf dem von
// createInvitationsService() zurückgegebenen Objekt) definiert: preview()
// unten rief sie zuvor als `this.findValidByToken(...)` auf — die einzige
// Stelle im ganzen Service, an der eine Methode von einer korrekten
// `this`-Bindung abhing, während jede andere Stelle ausschließlich über
// `deps` auf Abhängigkeiten zugreift. Das bricht lautlos bei
// Destrukturierung (`const { preview } = service`) oder Weitergabe als
// Callback (Code-Review, Befund W10).
async function findValidByToken(deps: InvitationsServiceDeps, plainToken: string): Promise<InvitationRecord> {
  const tokenHash = hashInvitationToken(plainToken);
  const invitation = await deps.invitations.findByTokenHash(tokenHash);
  if (!invitation) throw new InvitationNotFoundError();
  if (invitation.revokedAt) throw new InvitationRevokedError();
  if (invitation.usedAt) throw new InvitationAlreadyUsedError();
  if (invitation.expiresAt.getTime() < Date.now()) throw new InvitationExpiredError();
  return invitation;
}

// Entfernt tokenHash aus der Antwort von list() — der Hash des
// Einladungs-Tokens ist zwar nicht direkt umkehrbar (kein Klartext-Leak),
// aber es gibt keinen legitimen Grund, ihn über die API überhaupt
// auszuliefern (Datenminimierung; siehe Sicherheitsreview). Analog zu
// toPublicUser() in auth.service.ts.
function toPublicInvitation(invitation: InvitationRecord): Omit<InvitationRecord, 'tokenHash'> {
  const { tokenHash: _tokenHash, ...publicInvitation } = invitation;
  return publicInvitation;
}

// Analog zu STORE_PERMISSIONS in sync.service.ts: EINE Stelle, die für jede
// einfache (nicht datenabhängige — "welche Rolle darf diese Aktion
// überhaupt ausführen", unabhängig vom konkreten Datensatz) Aktion dieses
// Moduls festlegt, welche Rollen sie ausführen dürfen — statt denselben
// Rollenvergleich als rohen String-Vergleich an jeder einzelnen Stelle neu
// zu schreiben (vormals u. a. in createClub(), listClubs() und beiden
// Zweigen von assertCanIssueRole() dupliziert, mit leicht unterschiedlicher
// Formulierung). list() und revoke() bleiben bewusst AUSSERHALB dieser
// Tabelle: sie kombinieren die Rolle zusätzlich mit einer datenabhängigen
// Scopierung (eigener Verein bzw. Eigentümerschaft der Einladung) — genau
// die Art Prüfung, die sync.service.ts aus demselben Grund ebenfalls
// bewusst nicht in STORE_PERMISSIONS aufnimmt (siehe dortiger Kommentar).
const ACTION_ROLES = {
  createClub: new Set(['superadmin']),
  listClubs: new Set(['superadmin']),
  issueAdminInvitation: new Set(['superadmin']),
  issueMemberInvitation: new Set(['admin', 'superadmin']),
} as const satisfies Record<string, ReadonlySet<string>>;

function requireActionRole(requester: RequesterContext, allowed: ReadonlySet<string>, message: string) {
  if (!allowed.has(requester.role)) throw new ForbiddenError(message);
}

function assertCanIssueRole(requester: RequesterContext, role: InvitationRole, targetClubId: string | null) {
  if (role === 'admin') {
    requireActionRole(requester, ACTION_ROLES.issueAdminInvitation, 'Nur Superadministrator:innen dürfen Admin-Einladungen ausstellen.');
    if (!targetClubId) {
      throw new ForbiddenError('Für eine Admin-Einladung muss ein bestehender Verein angegeben werden.');
    }
    return;
  }
  // role === 'trainer' | 'athlete'
  requireActionRole(requester, ACTION_ROLES.issueMemberInvitation, 'Nur Admins (oder Superadministrator:innen) dürfen Trainer:innen/Athlet:innen einladen.');
  if (requester.role === 'admin' && !requester.clubId) {
    // Sollte praktisch nie vorkommen (jeder Admin gehört zu einem Verein),
    // aber defensiv geprüft.
    throw new ForbiddenError('Dem einladenden Admin-Konto ist kein Verein zugeordnet.');
  }
  if (requester.role === 'superadmin' && !targetClubId) {
    throw new ForbiddenError('Als Superadministrator:in muss der Ziel-Verein (clubId) explizit angegeben werden.');
  }
}

// Ein Admin lädt immer in den EIGENEN Verein ein — eine im Request
// mitgeschickte abweichende clubId wird bewusst ignoriert, statt einen
// Fehler zu werfen, damit ein Frontend nicht extra zwischen den Rollen
// unterscheiden muss.
function resolveTargetClubId(requester: RequesterContext, role: InvitationRole, requestedClubId?: string): string | null {
  if (role === 'admin') return requestedClubId ?? null;
  if (requester.role === 'admin') return requester.clubId;
  return requestedClubId ?? null; // superadmin lädt trainer/athlete ein
}

export function createInvitationsService(deps: InvitationsServiceDeps) {
  return {
    async createClub(input: { name: string; adminEmail: string; adminName: string }, requester: RequesterContext) {
      requireActionRole(requester, ACTION_ROLES.createClub, 'Nur Superadministrator:innen dürfen Vereine anlegen.');
      const { plainToken, tokenHash, expiresAt } = generateInvitationToken(deps.clubInvitationTtlDays);
      // Atomar (Code-Review): Verein + erste Admin-Einladung entstehen in
      // EINER Transaktion (siehe ClubRepository.createWithAdminInvitation()
      // für die Begründung) — vormals zwei unabhängige Aufrufe, bei denen
      // ein Fehlschlag der Einladung einen für niemanden erreichbaren,
      // nicht über die API reparierbaren Verein hinterlassen konnte. Der
      // E-Mail-Versand bleibt bewusst AUSSERHALB dieser Transaktion (siehe
      // unten) — ein Fehlschlag dort soll den bereits erfolgreich
      // angelegten, gültigen Einladungs-Datensatz nicht rückgängig machen;
      // die Einladung bleibt über die Nutzerverwaltung erneut versendbar.
      const { club, invitation } = await deps.clubs.createWithAdminInvitation(
        { name: input.name },
        (createdClub) => ({
          tokenHash,
          email: input.adminEmail,
          role: 'admin',
          clubId: createdClub.id,
          athleteId: null,
          invitedById: requester.id,
          expiresAt,
        }),
      );

      await deps.mailer.sendInvitationEmail({
        to: input.adminEmail,
        recipientName: input.adminName,
        role: 'admin',
        clubName: club.name,
        inviteUrl: buildInviteUrl(deps.frontendBaseUrl, plainToken),
        expiresAt,
        locale: await resolveRequesterLocale(deps.users, requester.id),
      });

      return {
        club,
        invitation: {
          id: invitation.id,
          token: plainToken,
          email: invitation.email,
          role: 'admin' as const,
          clubId: club.id,
          expiresAt: invitation.expiresAt,
        },
      };
    },

    async createInvitation(input: CreateInvitationRequest, requester: RequesterContext) {
      const targetClubId = resolveTargetClubId(requester, input.role, input.clubId);
      assertCanIssueRole(requester, input.role, targetClubId);

      let club = null;
      if (targetClubId) {
        club = await deps.clubs.findById(targetClubId);
        if (!club) throw new ClubNotFoundError();
      }

      // Sicherheitsrelevante Prüfung: eine mitgeschickte athleteId muss
      // tatsächlich zum ZIELVEREIN dieser Einladung gehören. Ohne diese
      // Prüfung könnte ein Admin (der createInvitation nur für den
      // eigenen Verein aufrufen darf) ein neues Nutzerkonto an das
      // Athletenprofil eines FREMDEN Vereins koppeln, indem er dessen
      // athleteId einfach mitschickt — targetClubId wird ja unabhängig
      // davon aus requester.clubId abgeleitet (siehe resolveTargetClubId),
      // die athleteId selbst wurde bislang nicht gegengeprüft.
      if (input.athleteId) {
        const athlete = await deps.athletes.findById(input.athleteId);
        if (!athlete) throw new AthleteNotFoundError();
        if (athlete.clubId !== targetClubId) throw new AthleteClubMismatchError();
      }

      const ttlDays = input.role === 'admin' ? deps.clubInvitationTtlDays : deps.memberInvitationTtlDays;
      const { plainToken, tokenHash, expiresAt } = generateInvitationToken(ttlDays);
      const invitation = await deps.invitations.create({
        tokenHash,
        email: input.email,
        role: input.role,
        clubId: targetClubId,
        athleteId: input.athleteId ?? null,
        invitedById: requester.id,
        expiresAt,
      });

      await deps.mailer.sendInvitationEmail({
        to: input.email,
        role: input.role,
        clubName: club?.name ?? '(neuer Verein)',
        inviteUrl: buildInviteUrl(deps.frontendBaseUrl, plainToken),
        expiresAt,
        locale: await resolveRequesterLocale(deps.users, requester.id),
      });

      return {
        id: invitation.id,
        token: plainToken,
        email: invitation.email,
        role: input.role,
        clubId: invitation.clubId,
        expiresAt: invitation.expiresAt,
      };
    },

    async preview(plainToken: string) {
      const invitation = await findValidByToken(deps, plainToken);
      const club = invitation.clubId ? await deps.clubs.findById(invitation.clubId) : null;
      return {
        email: invitation.email,
        role: invitation.role as InvitationRole,
        clubName: club?.name ?? null,
        expiresAt: invitation.expiresAt,
      };
    },

    findValidByToken: (plainToken: string) => findValidByToken(deps, plainToken),

    async markUsed(id: string): Promise<void> {
      await deps.invitations.markUsed(id);
    },

    async list(requester: RequesterContext): Promise<Array<Omit<InvitationRecord, 'tokenHash'>>> {
      if (requester.role === 'superadmin') return (await deps.invitations.listAll()).map(toPublicInvitation);
      if (requester.role === 'admin' && requester.clubId) return (await deps.invitations.listByClub(requester.clubId)).map(toPublicInvitation);
      throw new ForbiddenError('Nur Admins/Superadministrator:innen dürfen Einladungen einsehen.');
    },

    async revoke(id: string, requester: RequesterContext): Promise<void> {
      const invitation = await deps.invitations.findById(id);
      if (!invitation) throw new InvitationNotFoundError();
      const allowed =
        requester.role === 'superadmin' ||
        (requester.role === 'admin' && requester.clubId && invitation.clubId === requester.clubId);
      if (!allowed) throw new ForbiddenError('Diese Einladung gehört nicht zu Ihrem Verein.');
      await deps.invitations.revoke(id);
    },

    // Für die Superadmin-Oberfläche ("/admin"): jeder Verein inkl. Anzahl
    // aktiver Admins/Trainer:innen/Athlet:innen. Rückgabe nutzt bewusst die
    // internen Date-Objekte (nicht die ISO-String-Wire-Form aus
    // shared-types) — Fastifys JSON-Serialisierung wandelt Date -> String
    // an der HTTP-Grenze automatisch um, wie überall sonst im Backend.
    async listClubs(requester: RequesterContext): Promise<Array<ClubRecord & { memberCounts: ClubMemberCounts }>> {
      requireActionRole(requester, ACTION_ROLES.listClubs, 'Nur Superadministrator:innen dürfen alle Vereine einsehen.');
      const clubs = await deps.clubs.list();
      const counts = await deps.clubs.countMembersForClubs(clubs.map((c) => c.id));
      return clubs.map((club) => ({
        ...club,
        memberCounts: counts.get(club.id) ?? { admin: 0, trainer: 0, athlete: 0 },
      }));
    },
  };
}

export type InvitationsService = ReturnType<typeof createInvitationsService>;
