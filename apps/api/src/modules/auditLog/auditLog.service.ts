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
export type AuditLogAction = 'invitation.created' | 'invitation.revoked' | 'user.rolesChanged' | 'user.deletionRequested';

export interface RecordAuditLogEntryInput {
  clubId: string | null;
  actorId: string | null;
  actorLabel: string;
  action: AuditLogAction;
  targetId: string | null;
  targetLabel: string;
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

export interface AuditLogServiceDeps {
  entries: AuditLogRepository;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function createAuditLogService(deps: AuditLogServiceDeps) {
  return {
    // Schreibt NIE einen Fehler an den Aufrufer zurück, der die eigentliche
    // Aktion (Einladung/Rollenänderung/Löschanfrage) rückgängig machen
    // könnte — ein Fehlschlag des Protokolls darf die bereits erfolgreich
    // abgeschlossene Fachaktion nicht ungeschehen machen. Aufrufer rufen
    // dies deshalb bewusst NACH der eigentlichen Transaktion auf; ein
    // Fehler hier propagiert dennoch (kein try/catch-Schlucken) — ein
    // unbemerkt lautlos scheiterndes Sicherheitsprotokoll wäre schlimmer
    // als ein sichtbarer 500er, der zumindest auffällt und behoben wird.
    async record(input: RecordAuditLogEntryInput): Promise<void> {
      await deps.entries.create({ ...input, metadata: input.metadata ?? {} });
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
