// Fehlerklassen der Zwei-Faktor-Anmeldung (Issue #97) — eigene Datei ohne
// Abhängigkeiten, damit auth.service.ts und mfa.service.ts sie ohne
// Zirkelbezug nutzen können. HTTP-Zuordnung in plugins/httpErrorHandler.ts.
export class MfaAlreadyEnabledError extends Error {
  constructor() {
    super('Die Zwei-Faktor-Anmeldung ist bereits eingerichtet.');
  }
}
export class MfaSetupNotStartedError extends Error {
  constructor() {
    super('Bitte die Einrichtung zuerst starten.');
  }
}
export class MfaNotEnabledError extends Error {
  constructor() {
    super('Die Zwei-Faktor-Anmeldung ist für dieses Konto nicht eingerichtet.');
  }
}
export class InvalidMfaCodeError extends Error {
  constructor() {
    super('Der Code ist ungültig oder bereits verwendet.');
  }
}
// Wer selbst TOTP nutzt, bestätigt heikle Aktionen zusätzlich mit einem Code.
export class MfaCodeRequiredError extends Error {
  constructor() {
    super('Bitte zusätzlich einen aktuellen Code aus der Authenticator-App angeben.');
  }
}
// Die Vereinspflicht darf nur einschalten, wer TOTP selbst eingerichtet hat.
export class MfaRequiredForActionError extends Error {
  constructor() {
    super('Für diese Aktion muss die Zwei-Faktor-Anmeldung für das eigene Konto eingerichtet sein.');
  }
}
