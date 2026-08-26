// apps/api/src/plugins/authenticate.ts
//
// Stellt `app.authenticate` als preHandler bereit, den geschützte Routen
// (z. B. GET/PATCH /api/me) referenzieren. Liest den Access Token aus dem
// "Authorization: Bearer <token>"-Header, verifiziert ihn (RS256) und
// hängt die Claims als `request.user` an — siehe Abschnitt 5.2 des
// Backend-Entwicklungsplans.
//
// BEWUSSTE ENTSCHEIDUNG (Sicherheitsreview 2026-08, Befund N4): diese
// Prüfung liest AUSSCHLIESSLICH die JWT-Signatur/Gültigkeit, fragt nie die
// Datenbank ab. Ein Soft-Delete (requestErasure() setzt User.deletedAt und
// widerruft alle Refresh Tokens) oder eine künftige Rollenänderung wirkt
// sich dadurch erst aus, sobald das bereits ausgestellte Access Token
// regulär abläuft (Standard JWT_ACCESS_TTL_SECONDS: 15 Minuten) — auch
// /api/sync/push und /api/sync/pull (sync.route.ts) konsultieren den
// Nutzer-Datensatz nicht, ein gerade gelöschtes Konto könnte in diesem
// Fenster also weiterhin Vereinsdaten lesen/schreiben. Dies ist der
// übliche, akzeptierte Trade-off kurzlebiger, zustandsloser Access Tokens
// (die Alternative — ein DB-Lookup je authentifizierter Anfrage,
// einschließlich der beiden genannten Sync-Endpunkte, die den Kern der
// App-Last tragen — würde genau den Performance-Vorteil aufheben, den
// kurzlebige Tokens gegenüber einer serverseitigen Session-Prüfung bei
// jeder Anfrage bieten sollen) und wird HIER bewusst dokumentiert, statt
// stillschweigend hingenommen zu werden. Das Refresh Token bleibt der
// eigentliche Durchsetzungspunkt: es ist bereits beim Soft-Delete
// widerrufen, ein erneuter Login/Refresh ist ab dann nicht mehr möglich.
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
