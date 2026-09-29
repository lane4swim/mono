// Fehlversuchs-Grenze je Anmeldeversuch (Issue #97): nach
// MAX_FAILED_ATTEMPTS falschen Codes ist das mfaToken verbraucht, und die
// Person muss sich erneut mit dem Passwort anmelden. Ein erfolgreich
// eingelöstes mfaToken lässt sich nicht ein zweites Mal verwenden.
//
// Bewusst im Prozessspeicher: jedes dokumentierte Deployment betreibt genau
// EINE API-Instanz, und ein mfaToken lebt nur 5 Minuten. Ein Neustart setzt
// die Zähler zurück — das routenseitige Rate-Limit (auth.route.ts) begrenzt
// die Versuche unabhängig davon. Bei mehreren Instanzen gehört dieser
// Zustand in die Datenbank.
export const MAX_FAILED_ATTEMPTS = 5;

interface ChallengeState {
  failures: number;
  consumed: boolean;
  expiresAt: number;
}

export class MfaChallengeStore {
  private states = new Map<string, ChallengeState>();

  private stateFor(jti: string, expiresAt: Date): ChallengeState {
    const now = Date.now();
    for (const [key, state] of this.states) {
      if (state.expiresAt <= now) this.states.delete(key);
    }
    let state = this.states.get(jti);
    if (!state) {
      state = { failures: 0, consumed: false, expiresAt: expiresAt.getTime() };
      this.states.set(jti, state);
    }
    return state;
  }

  // Darf mit diesem mfaToken noch ein Code versucht werden?
  isUsable(jti: string, expiresAt: Date): boolean {
    const state = this.stateFor(jti, expiresAt);
    return !state.consumed && state.failures < MAX_FAILED_ATTEMPTS;
  }

  // Zählt einen Fehlversuch; true, wenn das mfaToken damit erschöpft ist.
  recordFailure(jti: string, expiresAt: Date): boolean {
    const state = this.stateFor(jti, expiresAt);
    state.failures += 1;
    return state.failures >= MAX_FAILED_ATTEMPTS;
  }

  // Markiert das mfaToken als eingelöst; false, wenn es das schon war.
  consume(jti: string, expiresAt: Date): boolean {
    const state = this.stateFor(jti, expiresAt);
    if (state.consumed) return false;
    state.consumed = true;
    return true;
  }
}
