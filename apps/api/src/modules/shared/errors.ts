// Modulübergreifende Fehlerklassen. plugins/httpErrorHandler.ts bildet sie
// per `instanceof` auf HTTP-Antworten ab — eine Unterklasse (z. B.
// QualificationForbiddenError) erbt dadurch automatisch die Abbildung
// ihrer Basisklasse und braucht keinen eigenen Registry-Eintrag.

// Zentrale "fehlende Berechtigung"-Klasse (HTTP 403, Code `forbidden`).
// Module, die eine eigene, unterscheidbare Klasse brauchen (für gezielte
// Tests oder Logs), leiten von ihr ab, statt eine unabhängige Kopie
// anzulegen.
export class ForbiddenError extends Error {
  constructor(message = 'Für diese Aktion fehlt die Berechtigung.') {
    super(message);
  }
}
