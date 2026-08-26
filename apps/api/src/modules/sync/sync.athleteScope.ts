// apps/api/src/modules/sync/sync.athleteScope.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei). Rollen-Scopierung
// beim Pull auf Zeilen-/Feld-Ebene — zusätzlich zur Store-Ebene in
// sync.permissions.ts — nur für Rolle "athlete": "actionItems" auf eigene
// Einträge gefiltert, "sessions" auf die eigene Zeile im attendance-Array
// reduziert bzw. komplett ausgeblendet (plus "trainerNote" redigiert),
// "athletes" für fremde Datensätze auf ein Allowlist-Feldset reduziert.
// Diese Feinheiten hängen vom KONKRETEN Dateninhalt ab, nicht nur von
// Rolle+Store, und bleiben deshalb bewusst getrennt von
// sync.permissions.ts.
import type { SyncChange } from '@lane1/shared-types';

// Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M2): der
// restliche Athletendatensatz ging bislang für Rolle "athlete"
// vollständig heraus (nur "notes" wurde redigiert) — inklusive
// "birthdate"/"gender"/"joinDate" FREMDER Athlet:innen. Eine Suche über
// das gesamte Frontend zeigt: diese drei Felder werden AUSSCHLIESSLICH in
// apps/web/js/modules/athletes.js gelesen (roles: ['trainer','admin']) —
// kein Team-weites Modul (times.js/plans.js/sessions.js/dashboard.js/
// actionItems.js) braucht sie. Diese Liste ist bewusst eine ALLOWLIST
// (nicht "alles außer X"), analog zum Whitelist-Prinzip in
// sync.permissions.ts — ein künftig neues Athletenfeld ist damit per
// Default NICHT für Rolle "athlete" sichtbar, bis es hier explizit
// aufgenommen wird.
//
// Gilt NUR für FREMDE Datensätze (siehe scopeChangeForAthlete() unten) —
// das eigene, verknüpfte Athletenprofil bleibt vollständig (minus
// "notes") sichtbar: apps/web/js/modules/profile.js' collectMyData()
// nutzt genau diesen lokal gesynchten Datensatz als Offline-Ausweichlösung
// für den DSGVO-Auskunftsexport (Art. 15) der eigenen Person — eine
// Allowlist auch hier würde der betroffenen Person ihre EIGENEN
// Personendaten (Geburtsdatum, Geschlecht, Beitrittsdatum) vorenthalten.
const TEAM_VISIBLE_ATHLETE_FIELDS = [
  'id',
  'clubId',
  'firstName',
  'lastName',
  'groupId',
  'active',
  'createdAt',
  'updatedAt',
] as const;

// Prüft, ob eine Rolle="athlete" auf ein Attendance-Element eines
// TrainingSession-Payloads zugreifen darf (nur das eigene).
function isOwnAttendanceRecord(record: unknown, athleteId: string | null): boolean {
  return (
    !!athleteId &&
    typeof record === 'object' &&
    record !== null &&
    (record as { athleteId?: unknown }).athleteId === athleteId
  );
}

// Entscheidet für einen einzelnen Pull-Change, ob (und in welcher Form) er
// an eine Person mit Rolle "athlete" ausgeliefert werden darf. Gibt `null`
// zurück, wenn der Change komplett unterdrückt werden soll.
export function scopeChangeForAthlete(change: SyncChange, athleteId: string | null): SyncChange | null {
  if (change.action === 'delete') {
    // Tombstones enthalten kein Payload (nur die entityId) — daraus lässt
    // sich keine Eigentümerschaft mehr ableiten. Sie werden unverändert
    // durchgereicht: eine gelöschte fremde entityId ohne Inhalt ist keine
    // schützenswerte Information.
    return change;
  }

  if (change.store === 'actionItems') {
    const payload = change.payload as { athleteId?: unknown } | null;
    if (payload?.athleteId !== athleteId) return null;
    return change;
  }

  if (change.store === 'sessions') {
    const payload = change.payload as { attendance?: unknown[]; trainerNote?: unknown } | null;
    const attendance = Array.isArray(payload?.attendance) ? payload!.attendance : [];
    const ownRecord = attendance.find((a) => isOwnAttendanceRecord(a, athleteId));
    if (!ownRecord) return null; // diese Einheit betrifft die anfragende Person gar nicht
    // Die übrigen `attendance`-Einträge (Anwesenheit/RPE/Notiz anderer
    // Athlet:innen) werden entfernt — nur der eigene Eintrag bleibt.
    //
    // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M1):
    // "trainerNote" ist — analog zu "athletes.notes" — ein freies
    // Trainer:innen-Notizfeld (siehe apps/web/js/modules/sessions.js:
    // renderDetail() zeigt es nur dort, renderAthleteView() für Rolle
    // "athlete" nie) und wurde bislang unverändert durchgereicht, obwohl
    // dieselbe Redaktions-Begründung wie bei "athletes.notes" zutrifft.
    return { ...change, payload: { ...(payload as object), trainerNote: '', attendance: [ownRecord] } };
  }

  if (change.store === 'athletes') {
    const payload = change.payload as Record<string, unknown> | null;
    if (!payload) return change;

    // "notes" ist ein freies Trainer:innen-Notizfeld (siehe
    // apps/web/js/modules/athletes.js — das einzige Modul, das dieses
    // Feld überhaupt anzeigt, ist auf roles: ['trainer','admin']
    // beschränkt) — bleibt sowohl am fremden als auch am eigenen
    // Datensatz redigiert (die Notiz ist grundsätzlich coach-intern,
    // nicht athletenspezifisch geheim vs. offen).
    if (payload.id === athleteId) {
      // Eigenes, verknüpftes Athletenprofil: bleibt vollständig (minus
      // "notes") sichtbar — siehe Begründung bei
      // TEAM_VISIBLE_ATHLETE_FIELDS oben (Offline-DSGVO-Export in
      // profile.js braucht die eigenen Personendaten vollständig).
      return { ...change, payload: { ...payload, notes: '' } };
    }

    // Fremdes Athletenprofil: nur die Team-weit tatsächlich genutzten
    // Felder (siehe TEAM_VISIBLE_ATHLETE_FIELDS oben) — insbesondere
    // "birthdate"/"gender"/"joinDate" fremder Personen werden NICHT mehr
    // ausgeliefert (Datenminimierung, Art. 5 Abs. 1 lit. c DSGVO).
    const scoped: Record<string, unknown> = {};
    for (const field of TEAM_VISIBLE_ATHLETE_FIELDS) {
      if (field in payload) scoped[field] = payload[field];
    }
    return { ...change, payload: scoped };
  }

  return change;
}
