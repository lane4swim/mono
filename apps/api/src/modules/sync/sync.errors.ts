// apps/api/src/modules/sync/sync.errors.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei).
import { FOREIGN_ENTITY_ERROR } from './sync.foreignKeys.js';

// Generische Meldung für jeden Fehler, der KEINEM der unten explizit
// behandelten Prisma-Fehlercodes entspricht (siehe describeSyncError()).
const GENERIC_SYNC_ERROR_MESSAGE = 'Der Vorgang konnte nicht angewendet werden (interner Fehler).';

// Prismas Fremdschlüssel-Verletzung (Fehlercode "P2003") tritt konkret
// dann auf, wenn ein Event auf eine Person verweist, die zwischenzeitlich
// endgültig gelöscht wurde (siehe jobs/purgeExpiredDeletions.ts) — die
// referenzierte Zeile existiert dann physisch nicht mehr. Statt der
// rohen, technischen Postgres-Meldung ("Foreign key constraint failed on
// the field: ...") bekommt der Client eine verständliche Erklärung.
// Bewusst als eigenständige, exportierte Funktion (statt
// Prisma.PrismaClientKnownRequestError zu importieren) — so lässt sie
// sich direkt testen, ohne einen echten generierten Prisma-Client zu
// brauchen, und funktioniert unabhängig davon, welche konkrete
// Fehlerklasse eine Gateway-Implementierung tatsächlich wirft.
//
// Jeder Fehler ohne erkannten Code wird nur generisch beantwortet, statt
// `err.message` unverändert an den Client zurückzugeben: Prismas rohe
// Fehlertexte (z. B. "Unique constraint failed on the fields:
// (`tokenHash`)" bei P2002, oder die Meldung zu "P2025" — Record not
// found, tritt z. B. bei einem clubId-fremden update()/softDelete() auf,
// siehe sync.gateway.ts) nennen Spalten-/Tabellen-/Constraint-Namen aus
// dem internen Datenbankschema — ein Informationsleck, das der Rest
// dieses Moduls bewusst vermeidet (siehe InvalidCredentialsError,
// FOREIGN_ENTITY_ERROR in sync.foreignKeys.ts, beide absichtlich generisch
// formuliert — bewusst DIESELBE Konstante wie hier, siehe deren
// Kommentar). Jeder nicht explizit behandelte Fehler wird daher
// stattdessen serverseitig geloggt und nur generisch beantwortet.
export function describeSyncError(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;

  if (code === 'P2003') {
    return FOREIGN_ENTITY_ERROR;
  }

  if (err !== undefined) {
    console.error('[sync] Fehler beim Anwenden eines Sync-Events:', err);
  }
  return GENERIC_SYNC_ERROR_MESSAGE;
}
