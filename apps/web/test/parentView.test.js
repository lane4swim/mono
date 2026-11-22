// Eltern-Übersicht (Issue #145): Meldedetails eines Wettkampfs — nur, was
// erfasst ist.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/modules/calendar.js', () => ({ openChildCalendar: vi.fn() }));
vi.mock('../js/apiClient.js', () => ({ getParentOverview: vi.fn(), describeError: (e) => String(e) }));

const { entryDetails } = await import('../js/modules/parentView.js');
const { t } = await import('../js/i18n.js');

describe('entryDetails()', () => {
  it('zeigt Wettkampfnummer, Lauf, Bahn und Meldezeit', () => {
    const text = entryDetails({ eventNumber: '12', heat: 3, lane: 4, seedTime: 72.35 });
    expect(text).toContain(t('parentView.eventNumber', { n: '12' }));
    expect(text).toContain(t('parentView.heat', { n: 3 }));
    expect(text).toContain(t('parentView.lane', { n: 4 }));
    expect(text).toContain('1:12');
  });

  it('lässt fehlende Angaben weg', () => {
    expect(entryDetails({ eventNumber: '', heat: null, lane: null, seedTime: null })).toBe('');
    expect(entryDetails({ eventNumber: '', heat: 2, lane: null, seedTime: null })).toBe(t('parentView.heat', { n: 2 }));
  });
});
