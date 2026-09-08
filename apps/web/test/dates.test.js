// Regressionstest für den Zeitzonen-Fehler in isoAddDays()/startOfWeek()
// (Code-Review dieses Branches): beide rundeten früher über toISOString()
// nach UTC, nachdem lokal gerechnet wurde — östlich von UTC ging dadurch
// ein Tag verloren. Läuft bewusst unter mehreren TZ, nicht nur der
// TZ der CI/Sandbox (meist UTC, wo der Fehler unsichtbar bleibt).
import { describe, it, expect, afterEach } from 'vitest';
import { isoAddDays, startOfWeek } from '../js/dates.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

describe.each(['UTC', 'Europe/Berlin', 'Pacific/Kiritimati' /* UTC+14 */, 'Etc/GMT+12' /* UTC-12 */])('isoAddDays()/startOfWeek() unter TZ=%s', (tz) => {
  it('bleiben zeitzonenunabhängig', () => {
    process.env.TZ = tz;
    expect(isoAddDays('2026-01-05', 0)).toBe('2026-01-05');
    expect(isoAddDays('2026-01-05', 7)).toBe('2026-01-12');
    expect(isoAddDays('2026-01-05', -1)).toBe('2026-01-04');
    expect(startOfWeek('2026-01-08')).toBe('2026-01-05'); // Donnerstag -> Montag derselben Woche
    expect(startOfWeek('2026-01-05')).toBe('2026-01-05'); // Montag bleibt Montag
  });
});
