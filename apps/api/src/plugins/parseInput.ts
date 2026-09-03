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

// `ZodType<T, any, any>` statt `ZodType<T>` (== `ZodType<T, ZodTypeDef, T>`):
// ein Schema mit einem `.default(...)`-Feld hat einen abweichenden
// Input-Typ (das Feld optional) und Output-Typ (das Feld immer gesetzt).
// Mit `ZodType<T>` bindet TypeScript `T` an BEIDE Positionen gleichzeitig
// und leitet daraus die Vereinigung aus Input- und Output-Typ ab (z. B.
// `note: string | undefined` statt `note: string`) — der Rückgabewert
// erschien dadurch optional, obwohl `.safeParse()` zur Laufzeit den
// Default längst angewendet hat. Das dritte Typargument fixiert die
// Input-Position auf `any`, sodass ausschließlich die Output-Position
// (die tatsächliche Form von `parsed.data`) die Inferenz von `T` bestimmt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- siehe Kommentar oben
export function parseInput<T>(schema: ZodType<T, any, any>, data: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
  return null;
}
