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

// `ZodType<T>` bindet `T` nur an den Output-Typ (die tatsächliche Form von
// `parsed.data`, mit angewendeten `.default(...)`-Werten); der Input-Typ ist
// seit zod 4 standardmäßig `unknown` und beeinflusst die Inferenz nicht.
export function parseInput<T>(schema: ZodType<T>, data: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
  return null;
}

// Zentrale Umwandlung der ISO-Datumsstrings aus validierten Request-Bodies
// in `Date` — jede Route nutzt diese beiden Funktionen, statt die
// Fallunterscheidung selbst auszuschreiben.
//
// Beim Anlegen: ein fehlendes oder `null` gesetztes optionales Datum wird
// gespeichert als "kein Datum" (`null`).
export function toDateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

// Bei einem PATCH: `undefined` (Feld weggelassen) heißt "unverändert
// lassen", `null` heißt "Datum entfernen" — beides muss erhalten bleiben.
export function toDatePatch(value: string | undefined): Date | undefined;
export function toDatePatch(value: string | null | undefined): Date | null | undefined;
export function toDatePatch(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(value);
}
