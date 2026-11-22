// Altersstand eines verknüpften Kindes (Issue #145). Der Eltern-Zugang
// stützt sich auf die elterliche Sorge für ein minderjähriges Kind
// (docs/Plans/phase2-plan.md, Abschnitt 3.3) — ab dem 18. Geburtstag sehen
// Eltern das Kind daher nicht mehr; Admins sehen die Verknüpfung markiert.
//
// Geburtsdaten liegen als Datum um 00:00 UTC vor, verglichen wird daher in
// UTC: volljährig ab dem Tag, an dem sich der Geburtstag zum 18. Mal jährt
// (am 29. Februar Geborene in Nicht-Schaltjahren ab dem 1. März).
import type { ParentLinkAgeStatus } from '@lane1/shared-types';

export const AGE_OF_MAJORITY = 18;

export function parentLinkAgeStatus(birthdate: Date | null | undefined, now: Date): ParentLinkAgeStatus {
  if (!birthdate || Number.isNaN(birthdate.getTime())) return 'birthdateMissing';
  const majority = Date.UTC(birthdate.getUTCFullYear() + AGE_OF_MAJORITY, birthdate.getUTCMonth(), birthdate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return today >= majority ? 'adult' : 'minor';
}
