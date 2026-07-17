// apps/api/src/plugins/authorize.ts
//
// Rollenbasierte Zugriffskontrolle, ergänzend zu app.authenticate (das nur
// prüft, OB jemand eingeloggt ist). requireRole(...) prüft zusätzlich, WER
// es ist. Muss immer NACH app.authenticate als preHandler stehen, da es
// sich auf request.user verlässt.
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@lane1/shared-types';

export function requireRole(...allowed: Role[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const role = request.user?.role;
    if (!role || !allowed.includes(role)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: `Für diese Aktion ist eine der folgenden Rollen erforderlich: ${allowed.join(', ')}.`,
      });
    }
  };
}
