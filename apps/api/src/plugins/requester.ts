// Zentrale Stelle für den Anfrage-Kontext "wer ruft auf" — jede Route, die
// einem Service die anfragende Person übergibt, bildet ihn über
// requesterFrom() statt ein eigenes Objekt-Literal aus `request.user` zu
// bauen, und jeder Service beschreibt seinen Parameter über `Requester`
// (bzw. ein `Pick<Requester, …>`) statt einer eigenen Interface-Kopie.
// Kommt ein Feld hinzu oder ändert sich seine Herkunft im Access Token,
// geschieht das nur hier.
import type { FastifyRequest } from 'fastify';

export interface Requester {
  // User-ID aus dem `sub`-Claim des Access Tokens.
  id: string;
  // Alle Rollen des Kontos (ein Konto kann mehrere tragen, siehe
  // plugins/authorize.ts: requireAnyRole()). Bewusst `string[]` statt
  // `Role[]`, damit Services und Tests einen Requester auch aus einem
  // UserRecord (dessen `roles` ebenfalls `string[]` ist) bilden können.
  roles: string[];
  // `null` nur für superadmin (gehört zu keinem Verein).
  clubId: string | null;
}

// Liest den Kontext aus den bereits verifizierten Access-Token-Claims.
// Darf nur in Handlern hinter `app.authenticate` aufgerufen werden — dort
// ist `request.user` garantiert gesetzt; ohne Authentifizierung ist ein
// Aufruf ein Programmierfehler, kein Anwendungsfall.
export function requesterFrom(request: Pick<FastifyRequest, 'user'>): Requester {
  const user = request.user!;
  return { id: user.sub, roles: user.roles, clubId: user.clubId };
}
