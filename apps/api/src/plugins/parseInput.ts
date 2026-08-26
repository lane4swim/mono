// apps/api/src/plugins/parseInput.ts
//
// Ein Aufruf statt der zwei wiederholten Zeilen, die bislang jeden der
// neun Routen-Handler mit Eingabevalidierung einleiteten:
//
//   const parsed = XSchema.safeParse(request.body);
//   if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
//
// `data` wird bewusst als eigenes Argument übergeben (statt `parseInput`
// selbst zwischen `request.body`/`request.query` entscheiden zu lassen) —
// funktioniert dadurch identisch für beide Fälle (acht Routen prüfen
// `request.body`, `GET /api/sync/pull` prüft `request.query`), ohne zwei
// separate Funktionen zu brauchen.
import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';

export function parseInput<T>(schema: ZodType<T>, data: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
  return null;
}
