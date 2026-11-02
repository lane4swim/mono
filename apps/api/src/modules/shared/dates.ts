// Zentrale Datums-Hilfsfunktionen für serverseitige Berechnungen in UTC.

// Mitternacht (UTC) des Kalendertags von `date` — z. B. als Untergrenze
// für "ab heute" oder als Basis eines täglichen Termins.
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
