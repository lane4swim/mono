// @vitest-environment jsdom
//
// Statuskarte der Hintergrundjobs (js/modules/backgroundJobs.js,
// docs/future-features-brainstorm.md, 6.4).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getJobsStatus = vi.fn();
vi.mock('../js/apiClient.js', () => ({
  getJobsStatus: () => getJobsStatus(),
  describeError: (err) => String(err?.message || err),
}));

const jobs = await import('../js/modules/backgroundJobs.js');
const { t } = await import('../js/i18n.js');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function job(overrides = {}) {
  return {
    name: 'purge-deleted-data',
    schedule: { kind: 'daily', hourUtc: 2 },
    running: false,
    runningSince: null,
    lastStartedAt: '2026-10-11T02:00:00.000Z',
    lastFinishedAt: '2026-10-11T02:00:01.000Z',
    lastStatus: 'success',
    lastSummary: { purgedAccounts: 1 },
    lastError: null,
    consecutiveFailures: 0,
    nextDueAt: '2099-01-01T02:00:00.000Z',
    stale: false,
    ...overrides,
  };
}

beforeEach(() => { getJobsStatus.mockReset(); });

describe('Hilfsfunktionen', () => {
  it('beschriftet bekannte Jobs, unbekannte mit Rohnamen', () => {
    expect(jobs.jobLabel('notify-upcoming-sessions')).toBe(t('jobs.name.notifyUpcomingSessions'));
    expect(jobs.jobLabel('neuer-job')).toBe('neuer-job');
  });

  it('beschreibt Intervall- und Tagespläne', () => {
    expect(jobs.describeSchedule({ kind: 'interval', hours: 6 })).toBe(t('jobs.scheduleInterval', { hours: 6 }));
    expect(jobs.describeSchedule({ kind: 'daily', hourUtc: 2 })).toMatch(/\d{2}:00/);
  });

  it('übersetzt bekannte Zähler und zeigt unbekannte roh', () => {
    expect(jobs.describeSummary({ remindersSent: 3, extra: 1 })).toBe(`${t('jobs.summary.remindersSent')}: 3, extra: 1`);
    expect(jobs.describeSummary({})).toBe('—');
  });

  it('ordnet die Zähler fest, unabhängig von der Schlüsselreihenfolge aus der Datenbank', () => {
    expect(jobs.describeSummary({ failed: 0, remindersSent: 2 })).toBe(`${t('jobs.summary.remindersSent')}: 2, ${t('jobs.summary.failed')}: 0`);
  });

  it('zeigt "Auffällig" zusätzlich zum Status des letzten Laufs', () => {
    const texts = jobs.statusBadges(job({ lastStatus: 'failed', stale: true })).map((b) => b.textContent);
    expect(texts).toEqual([t('jobs.statusFailed'), t('jobs.statusStale')]);
    expect(jobs.statusBadges(job({ lastStatus: null })).map((b) => b.textContent)).toEqual([t('jobs.statusNever')]);
    expect(jobs.statusBadges(job({ running: true })).map((b) => b.textContent)).toEqual([t('jobs.statusRunning')]);
  });
});

describe('renderBackgroundJobsCard', () => {
  it('zeigt je Job eine Zeile mit Status, Ergebnis und Fehlermeldung', async () => {
    getJobsStatus.mockResolvedValue({
      schedulerEnabled: true,
      jobs: [job(), job({ name: 'notify-upcoming-sessions', lastStatus: 'failed', lastError: 'SMTP down', consecutiveFailures: 3, stale: true })],
    });
    const card = jobs.renderBackgroundJobsCard();
    await flush();
    const rows = card.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(t('jobs.name.purgeDeletedData'));
    expect(rows[0].textContent).toContain(`${t('jobs.summary.purgedAccounts')}: 1`);
    expect(rows[1].textContent).toContain('SMTP down');
    expect(rows[1].textContent).toContain(t('jobs.statusStale'));
    expect(card.textContent).toContain(t('jobs.schedulerEnabled'));
  });

  it('warnt, wenn der Scheduler abgeschaltet ist', async () => {
    getJobsStatus.mockResolvedValue({ schedulerEnabled: false, jobs: [job()] });
    const card = jobs.renderBackgroundJobsCard();
    await flush();
    expect(card.querySelector('.form-error').textContent).toBe(t('jobs.schedulerDisabled'));
    expect(card.querySelector('tbody tr').textContent).toContain(t('jobs.nextRunCronOnly'));
  });

  it('zeigt Ladefehler an und lädt per "Aktualisieren" neu', async () => {
    getJobsStatus.mockRejectedValueOnce(new Error('Server nicht erreichbar'));
    const card = jobs.renderBackgroundJobsCard();
    await flush();
    expect(card.textContent).toContain('Server nicht erreichbar');

    getJobsStatus.mockResolvedValueOnce({ schedulerEnabled: true, jobs: [job()] });
    card.querySelector('button').click();
    await flush();
    expect(card.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(getJobsStatus).toHaveBeenCalledTimes(2);
  });
});
