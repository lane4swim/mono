// apps/api/src/plugins/httpErrorHandler.ts
//
// Zentrale Zuordnung "welche Domänen-Fehlerklasse wird zu welcher
// HTTP-Antwort?" — ersetzt die zuvor in jedem Routen-Handler einzeln
// wiederholte try/catch-Kette aus `if (err instanceof X) return
// reply.code(…).send(…)`-Zeilen. Handler werfen ihre Fehler jetzt
// einfach weiter (kein eigenes catch mehr nötig, sofern keine
// Sonderbehandlung erforderlich ist); registerHttpErrorHandler() fängt
// sie hier an EINER Stelle ab.
//
// Registriert per app.setErrorHandler() auf der WURZEL-Instanz (siehe
// app.ts) — Fastifys Plugin-Kapselung wirkt sich auf setErrorHandler nur
// aus, wenn er innerhalb eines app.register()-Unterkontexts gesetzt wird;
// auf der Wurzelinstanz gilt er automatisch für alle Routen, auch für
// erst SPÄTER registrierte.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  EmailAlreadyRegisteredError,
  AthleteAlreadyLinkedError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  UserNotFoundError,
  InvalidInvitationError,
  ClubIdRequiredError,
  InvalidCurrentPasswordError,
  InvalidOrExpiredResetTokenError,
} from '../modules/auth/auth.service.js';
import { UserNotFoundForExportError, ErasureAlreadyRequestedError } from '../modules/profile/profile.repository.js';
import {
  ForbiddenError,
  ClubNotFoundError,
  AthleteNotFoundError,
  AthleteClubMismatchError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationAlreadyUsedError,
  InvitationRevokedError,
} from '../modules/invitations/invitations.service.js';

interface HttpErrorMapping {
  status: number;
  code: string;
}

// Ein Konstruktor als Schlüssel (nicht der Klassenname als String) —
// `instanceof` bleibt dadurch die einzige Stelle, die über Zuständigkeit
// entscheidet, identisch zum vorherigen Verhalten der einzelnen
// try/catch-Blöcke.
//
// InvitationNotFoundError landet hier bewusst auf 404 ("nicht gefunden"
// — der Fall in invitations.route.ts: revoke()). Bei der
// Einladungsvorschau (invitations.route.ts: preview()) soll dieselbe
// Fehlerklasse dagegen 410 liefern, gemeinsam mit den drei
// Invitation*Error-Klassen darunter — "nicht gefunden"/"abgelaufen"/
// "bereits verwendet"/"widerrufen" sind für eine Vorschau EIN UND
// DIESELBE Nutzerbotschaft ("dieser Link funktioniert nicht mehr"). Das
// lässt sich in einer 1:1-Klasse-zu-Status-Tabelle nicht ausdrücken;
// preview() behält dafür bewusst ein eigenes, lokales catch — sichtbar
// als Ausnahme von der Regel, nicht als Zeile 23 einer 29-zeiligen Kette.
const HTTP_ERROR_REGISTRY = new Map<abstract new (...args: never[]) => Error, HttpErrorMapping>([
  [EmailAlreadyRegisteredError, { status: 409, code: 'email_taken' }],
  [AthleteAlreadyLinkedError, { status: 409, code: 'athlete_already_linked' }],
  [InvalidCredentialsError, { status: 401, code: 'invalid_credentials' }],
  [InvalidRefreshTokenError, { status: 401, code: 'invalid_refresh_token' }],
  [UserNotFoundError, { status: 404, code: 'not_found' }],
  [InvalidInvitationError, { status: 410, code: 'invalid_invitation' }],
  [ClubIdRequiredError, { status: 400, code: 'club_id_required' }],
  // Sicherheitsreview 2026-08, Befund M5 ("Passwort vergessen" +
  // Passwortwechsel). InvalidOrExpiredResetTokenError landet wie
  // InvalidInvitationError auf 410 — "dieser Link funktioniert nicht
  // mehr" ist für POST /auth/reset-password dieselbe einheitliche
  // Nutzerbotschaft, unabhängig vom genauen Grund (siehe dortiger
  // Kommentar in auth.service.ts).
  [InvalidCurrentPasswordError, { status: 401, code: 'invalid_current_password' }],
  [InvalidOrExpiredResetTokenError, { status: 410, code: 'invalid_reset_token' }],
  [UserNotFoundForExportError, { status: 404, code: 'not_found' }],
  [ErasureAlreadyRequestedError, { status: 409, code: 'erasure_already_requested' }],
  [ForbiddenError, { status: 403, code: 'forbidden' }],
  [ClubNotFoundError, { status: 404, code: 'club_not_found' }],
  [AthleteNotFoundError, { status: 404, code: 'athlete_not_found' }],
  [AthleteClubMismatchError, { status: 400, code: 'athlete_club_mismatch' }],
  [InvitationNotFoundError, { status: 404, code: 'not_found' }],
  [InvitationExpiredError, { status: 410, code: 'invalid_invitation' }],
  [InvitationAlreadyUsedError, { status: 410, code: 'invalid_invitation' }],
  [InvitationRevokedError, { status: 410, code: 'invalid_invitation' }],
]);

function sendMappedError(err: Error, mapping: HttpErrorMapping, reply: FastifyReply) {
  return reply.code(mapping.status).send({ error: mapping.code, message: err.message });
}

// Deckt ab, was Fastifys eigene, intern erzeugte Fehler (kaputtes JSON,
// Payload zu groß, …) zusätzlich zu `Error` tragen — ohne einen Import aus
// dem transitiven `@fastify/error`-Paket zu brauchen, das nicht in der
// eigenen package.json steht.
type CaughtError = Error & { statusCode?: number; code?: string };

export function registerHttpErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<CaughtError>((err, request, reply) => {
    for (const [ErrorClass, mapping] of HTTP_ERROR_REGISTRY) {
      if (err instanceof ErrorClass) return sendMappedError(err, mapping, reply);
    }

    // Nicht in der Registry: entweder ein von Fastify selbst erzeugter
    // Fehler (kaputtes JSON, Payload zu groß, falscher Content-Type, …
    // — trägt bereits einen passenden `statusCode`) oder ein echter,
    // unerwarteter Programmfehler. Erstere unverändert durchreichen,
    // Letztere loggen und generisch als 500 beantworten — genau das
    // Verhalten, das Fastifys eigener Default-Error-Handler ohnehin
    // hätte, hier nur mit demselben `{ error, message }`-Antwortformat
    // wie die übrigen Routen dieser API.
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (statusCode >= 500) request.log.error(err);
    return reply.code(statusCode).send({
      error: statusCode < 500 ? (err.code ?? 'bad_request') : 'internal_error',
      message: statusCode < 500 ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.',
    });
  });
}
