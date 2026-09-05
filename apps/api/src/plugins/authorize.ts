// apps/api/src/plugins/authorize.ts
//
// Rollenbasierte Zugriffskontrolle, ergänzend zu app.authenticate (das nur
// prüft, OB jemand eingeloggt ist). requireAnyRole(...) prüft zusätzlich,
// WER es ist. Muss immer NACH app.authenticate als preHandler stehen, da es
// sich auf request.user verlässt.
//
// docs/kampfrichter-modul-plan.md, Abschnitt 1.4: vormals requireRole() mit
// Gleichheitsprüfung ("die eine Rolle") — ein Konto kann jetzt mehrere
// Rollen gleichzeitig haben (request.user.roles: Role[]), die Prüfung ist
// daher eine Mengen-Überschneidung ("mindestens eine der Rollen"). Bewusst
// umbenannt statt eines stillen Drop-in-Ersatzes: jede der bestehenden
// Aufrufstellen sollte beim Kompilieren auffallen und einzeln auf die neue
// Semantik geprüft werden, statt sich unbemerkt zu ändern.
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@lane1/shared-types';

export function requireAnyRole(...allowed: Role[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const roles = request.user?.roles;
    if (!roles || !allowed.some((role) => roles.includes(role))) {
      return reply.code(403).send({
        error: 'forbidden',
        message: `Für diese Aktion ist eine der folgenden Rollen erforderlich: ${allowed.join(', ')}.`,
      });
    }
  };
}
