// apps/api/src/plugins/security.ts
//
// Bündelt die sicherheitsrelevanten Fastify-Plugins aus Abschnitt 9 des
// Backend-Entwicklungsplans (CORS, Security-Header, Rate-Limiting).
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Env } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance, env: Env) {
  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
}
