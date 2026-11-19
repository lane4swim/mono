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

// Ein Verein behält immer mindestens eine aktive Person mit der Rolle
// "admin" — sonst könnte niemand mehr Mitglieder verwalten/einladen oder
// Rollen ändern. Geworfen beim Entzug der Rolle und bei der
// Selbstlöschung (HTTP 409, Code `last_admin`).
export class LastAdminError extends Error {
  constructor() {
    super('Diese Änderung würde den Verein ohne Administrator:in zurücklassen.');
  }
}
