// apps/web/test/i18n.test.js
//
// Testet js/i18n.js::t() — bislang ungetestet. Deckt Befund C6
// (Code-Review) ab.
import { describe, it, expect } from 'vitest';
import { t } from '../js/i18n.js';

describe('t() — Platzhalter-Ersetzung', () => {
  it('setzt einen einfachen Wert für {name} ein', () => {
    expect(t('athletes.deleteConfirm', { name: 'Mara Vogel' })).toBe(
      'Mara Vogel wirklich löschen? Zugehörige Zeiten/Notizen bleiben erhalten, verweisen aber ins Leere.',
    );
  });

  // Regressionstest für Befund C6 (Code-Review): String.prototype.replace()
  // interpretiert bei einem STRING als Ersetzung Sonderzeichen wie "$&"
  // (steht für "der gesamte Treffer") — ein Name mit "$&" wäre bislang
  // fälschlich verdoppelt worden, statt den Platzhalter einfach zu
  // ersetzen. Der Fix nutzt eine Ersetzungs-Funktion, für die "$&" nur
  // gewöhnlicher Text ist.
  it('behandelt "$&" im eingesetzten Wert als gewöhnlichen Text (nicht als Sonderzeichen)', () => {
    expect(t('athletes.deleteConfirm', { name: 'Mara $& Vogel' })).toBe(
      'Mara $& Vogel wirklich löschen? Zugehörige Zeiten/Notizen bleiben erhalten, verweisen aber ins Leere.',
    );
  });

  it('fällt bei unbekanntem Key auf den Key selbst zurück', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  // Regressionstest für Befund P8 (Code-Review): die Umstellung auf einen
  // einzigen Durchlauf mit fester RegExp (statt einer neuen RegExp pro
  // Variable) darf das Verhalten bei mehreren Platzhaltern in einem
  // String nicht verändern — alle drei müssen weiterhin korrekt und
  // unabhängig voneinander ersetzt werden.
  it('ersetzt mehrere verschiedene Platzhalter in einem String korrekt', () => {
    expect(t('auth.acceptInviteIntro', { role: 'Trainer:in', club: 'SV Wasserfreunde', email: 'a@b.de' })).toBe(
      'Du wurdest als Trainer:in für "SV Wasserfreunde" eingeladen (a@b.de). Bitte lege ein Passwort fest, um dein Konto zu aktivieren.',
    );
  });

  it('lässt einen Platzhalter unverändert stehen, für den `vars` keinen eigenen Schlüssel enthält', () => {
    expect(t('auth.acceptInviteIntro', { role: 'Trainer:in', club: 'SV Wasserfreunde' })).toBe(
      'Du wurdest als Trainer:in für "SV Wasserfreunde" eingeladen ({email}). Bitte lege ein Passwort fest, um dein Konto zu aktivieren.',
    );
  });
});
