// Zentrale Hilfsfunktionen für die *.repository.memory.ts-Testdoubles,
// damit sich jedes Double bei Updates und Soft-Deletes genauso verhält wie
// seine Prisma-Implementierung — statt dieselbe Nachbildung je Double zu
// kopieren.

// Wie Prisma: ein `undefined`-Feld im Patch bedeutet "unverändert", nicht
// "leeren"; `updatedAt` wird gesetzt (wie `@updatedAt` im Schema).
export function applyDefinedPatch<T extends { updatedAt: Date }>(row: T, patch: object): T {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return Object.assign(row, defined, { updatedAt: new Date() });
}

// Markiert eine Zeile als gelöscht; eine unbekannte ID ist ein No-op (wie
// Prismas `updateMany` mit leerer Treffermenge).
export function softDeleteRow(rows: ReadonlyArray<{ id: string; deletedAt: Date | null }>, id: string): void {
  const row = rows.find((r) => r.id === id);
  if (row) row.deletedAt = new Date();
}
