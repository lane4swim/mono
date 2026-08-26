// apps/api/src/modules/sync/sync.athleteScope.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei). Rollen-Scopierung
// beim Pull auf Zeilen-/Feld-Ebene — zusätzlich zur Store-Ebene in
// sync.permissions.ts — nur für Rolle "athlete": "actionItems" auf eigene
// Einträge gefiltert, "sessions" auf die eigene Zeile im attendance-Array
// reduziert bzw. komplett ausgeblendet, "athletes" um das "notes"-Feld
// redigiert. Diese Feinheiten hängen vom KONKRETEN Dateninhalt ab, nicht
// nur von Rolle+Store, und bleiben deshalb bewusst getrennt von
// sync.permissions.ts.
import type { SyncChange } from '@lane1/shared-types';

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
    const payload = change.payload as { attendance?: unknown[] } | null;
    const attendance = Array.isArray(payload?.attendance) ? payload!.attendance : [];
    const ownRecord = attendance.find((a) => isOwnAttendanceRecord(a, athleteId));
    if (!ownRecord) return null; // diese Einheit betrifft die anfragende Person gar nicht
    // Die übrigen `attendance`-Einträge (Anwesenheit/RPE/Notiz anderer
    // Athlet:innen) werden entfernt — nur der eigene Eintrag bleibt.
    return { ...change, payload: { ...(payload as object), attendance: [ownRecord] } };
  }

  if (change.store === 'athletes') {
    // "notes" ist ein freies Trainer:innen-Notizfeld (siehe
    // apps/web/js/modules/athletes.js — das einzige Modul, das dieses
    // Feld überhaupt anzeigt, ist auf roles: ['trainer','admin']
    // beschränkt). Für Rolle "athlete" bleibt der restliche Athletendatensatz
    // (Name, Gruppe, …) sichtbar — der wird für Team-weite Ansichten wie
    // Zeiten/Trainingspläne gebraucht (siehe times.js/plans.js) — nur
    // "notes" wird redigiert, und zwar sowohl bei fremden als auch beim
    // eigenen Datensatz (die Notiz ist grundsätzlich coach-intern, nicht
    // athletenspezifisch geheim vs. offen).
    const payload = change.payload as Record<string, unknown> | null;
    if (!payload) return change;
    return { ...change, payload: { ...payload, notes: '' } };
  }

  return change;
}
