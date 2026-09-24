// Geschäftslogik für das Audit-Log sicherheitsrelevanter Aktionen (docs/
// Plans/vereinsverwaltung-phase3-plan.md, Abschnitt 2):
//   - record(): interner Schreibpfad, von invitationsService/authService
//     nach einer erfolgreichen sicherheitsrelevanten Aktion aufgerufen
//     (NICHT über einen eigenen REST-Endpunkt erreichbar).
//   - list(): admin sieht die Einträge des EIGENEN Vereins, superadmin
//     alle (optional nach clubId gefiltert).
import type { AuditLogRepository, AuditLogEntryRecord } from './auditLog.repository.js';

// docs/Plans/vereinsverwaltung-phase3-plan.md, Abschnitt 2.2 — die vier
// Aktionstypen dieser Phase. Als Union statt freiem String, damit ein Tippfehler
// an einer Aufrufstelle (invitations.service.ts/auth.service.ts) einen
// Compile-Fehler wirft statt einen stillen, nie gefilterten Log-Eintrag zu
// erzeugen.
export type AuditLogAction =
  | 'invitation.created'
  | 'invitation.revoked'
  | 'user.rolesChanged'
  | 'user.deletionRequested'
  // Anmeldung/Konto (Issue #96). Erfolgreiche Logins werden bewusst NICHT
  // protokolliert (Routine, würde das Log für Admins unlesbar machen) —
  // nur Fehlversuche für bestehende Konten und Auffälligkeiten.
  | 'auth.loginFailed'
  | 'auth.refreshTokenReuse'
  | 'auth.passwordResetRequested'
  | 'auth.passwordReset'
  | 'user.passwordChanged'
  | 'user.emailChanged'
  // Vereinsverwaltung durch superadmin/admin (Issue #96).
  | 'club.created'
  | 'club.modulesChanged'
  | 'club.identityChanged'
  | 'club.legalInfoChanged'
  | 'parentLink.added'
  | 'parentLink.removed'
  | 'qualification.created'
  | 'qualification.updated'
  | 'qualification.deleted'
  | 'refereeAssignment.created'
  | 'refereeAssignment.updated'
  | 'refereeAssignment.deleted';

// Akteur:innen-Label für Einträge ohne angemeldete Person (Fehlversuch mit
// unbekanntem Absender, vom Server erkannte Auffälligkeit). Sprachneutrale
// Marker wie ANONYMIZED_COMMENT_AUTHOR — apps/web/js/modules/auditLog.js
// übersetzt sie zur Anzeigezeit.
export const UNKNOWN_ACTOR_LABEL = '__unknown__';
export const SYSTEM_ACTOR_LABEL = '__system__';

// Schnappschuss-Label "Name <E-Mail>" (siehe AuditLogEntry.actorLabel in
// schema.prisma) — eine Stelle statt je Aufrufer eigener Formatierung.
export function userLabel(user: { name: string; email: string }): string {
  return `${user.name} <${user.email}>`;
}

export interface RecordAuditLogEntryInput {
  clubId: string | null;
  actorId: string | null;
  // Ohne Label löst record() actorId/targetId selbst als Konto auf (siehe
  // AuditLogServiceDeps.users) — Aufrufer, die die Person ohnehin schon
  // geladen haben, geben das Label direkt mit.
  actorLabel?: string;
  action: AuditLogAction;
  targetId: string | null;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

// Schlankes Interface, das invitations.service.ts/auth.service.ts als
// Abhängigkeit bekommen (statt des vollen AuditLogService) — analog dazu,
// wie beide bereits heute nur einen schmalen MailSender-Ausschnitt kennen,
// nicht das ganze Mail-Modul.
export interface AuditLogWriter {
  record(input: RecordAuditLogEntryInput): Promise<void>;
}

export interface RequesterContext {
  roles: string[];
  clubId: string | null;
}

export class ClubIdRequiredError extends Error {
  constructor() {
    super('Für diese Aktion ist eine Vereins-Zuordnung erforderlich.');
  }
}

export interface AuditLabelLookup {
  findById(id: string): Promise<{ name: string; email: string } | null>;
}

export interface AuditLogServiceDeps {
  entries: AuditLogRepository;
  // Optional: nur für die Label-Auflösung in record(). Fehlt sie, bleibt ein
  // nicht mitgegebenes Label die ID selbst.
  users?: AuditLabelLookup;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function createAuditLogService(deps: AuditLogServiceDeps) {
  async function resolveUserLabel(id: string | null): Promise<string> {
    if (!id) return '';
    const user = deps.users ? await deps.users.findById(id) : null;
    return user ? userLabel(user) : id;
  }

  return {
    // Wirft nie: record() läuft NACH der eigentlichen Fachaktion (Einladung
    // versendet, Rolle geändert, …). Ein fehlschlagender INSERT darf diese
    // bereits abgeschlossene Aktion nicht als 500 erscheinen lassen — ein
    // automatischer Client-Retry erzeugte sonst z. B. eine zweite Einladung.
    // Stattdessen wird der Fehler geloggt (analog zur Push-Benachrichtigung in
    // sync.route.ts), damit ein ausgefallenes Protokoll im Server-Log auffällt.
    async record(input: RecordAuditLogEntryInput): Promise<void> {
      try {
        const [actorLabel, targetLabel] = await Promise.all([
          input.actorLabel ?? resolveUserLabel(input.actorId),
          input.targetLabel ?? resolveUserLabel(input.targetId),
        ]);
        await deps.entries.create({ ...input, actorLabel, targetLabel, metadata: input.metadata ?? {} });
      } catch (err) {
        console.error(`[auditLog] Eintrag "${input.action}" konnte nicht geschrieben werden (clubId=${input.clubId ?? '—'}, targetId=${input.targetId ?? '—'}):`, err);
      }
    },

    async list(requester: RequesterContext, options: { clubId?: string; before?: Date; limit?: number } = {}): Promise<AuditLogEntryRecord[]> {
      const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      if (requester.roles.includes('superadmin')) {
        return deps.entries.list({ clubId: options.clubId, before: options.before, limit });
      }
      // admin: immer der EIGENE Verein — eine mitgeschickte abweichende
      // clubId wird ignoriert, analog invitations.service.ts: list().
      if (!requester.clubId) throw new ClubIdRequiredError();
      return deps.entries.list({ clubId: requester.clubId, before: options.before, limit });
    },
  };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;
