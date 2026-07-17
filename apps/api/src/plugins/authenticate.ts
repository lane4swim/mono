// apps/api/src/plugins/authenticate.ts
//
// Stellt `app.authenticate` als preHandler bereit, den geschützte Routen
// (z. B. GET/PATCH /api/me) referenzieren. Liest den Access Token aus dem
// "Authorization: Bearer <token>"-Header, verifiziert ihn (RS256) und
// hängt die Claims als `request.user` an — siehe Abschnitt 5.2 des
// Backend-Entwicklungsplans.
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenClaims } from '@lane1/shared-types';
import { verifyAccessToken, InvalidAccessTokenError } from '../auth/tokens.js';
import type { KeyPair } from '../auth/keys.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AccessTokenClaims;
  }
}

export default fp(async function authenticatePlugin(app: FastifyInstance, opts: { keyPair: KeyPair }) {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Fehlender oder ungültiger Authorization-Header.' });
    }
    const token = header.slice('Bearer '.length);
    try {
      request.user = await verifyAccessToken(token, opts.keyPair);
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) {
        return reply.code(401).send({ error: 'unauthorized', message: err.message });
      }
      throw err;
    }
  });
});
