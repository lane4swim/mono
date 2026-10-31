// Zentrale Stelle für das Durchlaufen der SetEntry-Struktur (siehe
// packages/shared-types/src/entities.ts: PlainSetSchema, RepeatBlockSchema,
// SectionSchema), die Template.sets, SectionTemplate.entries und jeder
// Plan-Tag (Plan.days[].sets) tragen:
//
//   - "set":     ein einzelner Satz (trägt u. a. exerciseId und comments)
//   - "block":   mehrere Sätze in `sets` (keine verschachtelten Blöcke)
//   - "section": mehrere Sätze/Blöcke in `entries` (keine verschachtelten
//                Abschnitte)
//
// Jede Stelle, die einzelne Sätze erreichen muss (Fremdschlüssel-Prüfung
// der exerciseIds, Autor:innen-Prüfung und Anonymisierung von Kommentaren),
// nutzt forEachPlainSet()/mapPlainSets(), statt die Rekursion selbst
// nachzubauen. Die Funktionen arbeiten auf `unknown`: geprüft werden
// sowohl Zod-validierte Payloads als auch roh aus der Datenbank gelesene
// JSONB-Werte, unerwartete Formen werden übersprungen statt zu werfen.

// Ein JSON-Objekt — bewusst OHNE Arrays, die in JavaScript ebenfalls
// `typeof 'object'` sind.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Ruft `visit` für jeden einzelnen Satz (kind "set") einer SetEntry[]-Liste
// auf, auch für Sätze in Blöcken und Abschnitten.
export function forEachPlainSet(entries: unknown, visit: (set: Record<string, unknown>) => void): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry.kind === 'set') visit(entry);
    else if (entry.kind === 'block') forEachPlainSet(entry.sets, visit);
    else if (entry.kind === 'section') forEachPlainSet(entry.entries, visit);
  }
}

export interface MapResult {
  changed: boolean;
  value: unknown;
}

// Bildet jeden einzelnen Satz einer SetEntry[]-Liste über `map` ab. `map`
// liefert den ersetzten Satz oder `null` für "unverändert". Unveränderte
// Einträge, Blöcke und Abschnitte behalten ihre Objekt-Identität;
// `changed` meldet, ob irgendein Satz ersetzt wurde.
export function mapPlainSets(entries: unknown, map: (set: Record<string, unknown>) => Record<string, unknown> | null): MapResult {
  if (!Array.isArray(entries)) return { changed: false, value: entries };
  let changed = false;
  const value = entries.map((entry) => {
    if (!isRecord(entry)) return entry;
    if (entry.kind === 'set') {
      const replaced = map(entry);
      if (replaced === null) return entry;
      changed = true;
      return replaced;
    }
    const childKey = entry.kind === 'block' ? 'sets' : entry.kind === 'section' ? 'entries' : null;
    if (childKey === null || !Array.isArray(entry[childKey])) return entry;
    const child = mapPlainSets(entry[childKey], map);
    if (!child.changed) return entry;
    changed = true;
    return { ...entry, [childKey]: child.value };
  });
  return { changed, value };
}
