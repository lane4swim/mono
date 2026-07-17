// apps/api/test/prisma/seedData.test.ts
import { describe, it, expect } from 'vitest';
import { buildDemoData } from '../../prisma/seed.js';

describe('buildDemoData — referenzielle Integrität', () => {
  const data = buildDemoData();

  it('jede Gruppe gehört zum erzeugten Verein', () => {
    data.groups.forEach((g) => expect(g.clubId).toBe(data.club.id));
  });

  it('jede:r Athlet:in gehört zum erzeugten Verein und einer bekannten Gruppe', () => {
    const groupIds = new Set(data.groups.map((g) => g.id));
    data.athletes.forEach((a) => {
      expect(a.clubId).toBe(data.club.id);
      expect(groupIds.has(a.groupId)).toBe(true);
    });
  });

  it('jede:r Nutzer:in mit clubId ungleich null gehört zum erzeugten Verein', () => {
    data.users.forEach((u) => {
      if (u.clubId !== null) expect(u.clubId).toBe(data.club.id);
    });
  });

  it('genau ein Superadmin-Konto, dessen clubId null ist', () => {
    const superadmins = data.users.filter((u) => u.role === 'superadmin');
    expect(superadmins).toHaveLength(1);
    expect(superadmins[0].clubId).toBeNull();
  });

  it('das Athlet:innen-Konto verweist über athleteId auf ein tatsächlich existierendes Athletenprofil', () => {
    const athleteUser = data.users.find((u) => u.role === 'athlete')!;
    expect(athleteUser.athleteId).not.toBeNull();
    expect(data.athletes.some((a) => a.id === athleteUser.athleteId)).toBe(true);
  });

  it('jede Übungs-Referenz (exerciseId) in Vorlagen-Sätzen zeigt auf eine existierende Übung', () => {
    const exerciseIds = new Set(data.exercises.map((e) => e.id));
    data.templates.forEach((tpl) => {
      tpl.sets.forEach((entry) => {
        const setsToCheck = entry.kind === 'block' ? entry.sets : [entry];
        setsToCheck.forEach((s) => {
          if ('exerciseId' in s && s.exerciseId) {
            expect(exerciseIds.has(s.exerciseId)).toBe(true);
          }
        });
      });
    });
  });

  it('der Trainingsplan verweist auf eine existierende Gruppe', () => {
    const groupIds = new Set(data.groups.map((g) => g.id));
    data.plans.forEach((p) => {
      if (p.groupId) expect(groupIds.has(p.groupId)).toBe(true);
    });
  });

  it('jede Trainingseinheit verweist auf eine existierende Gruppe und (falls gesetzt) einen existierenden Plan', () => {
    const groupIds = new Set(data.groups.map((g) => g.id));
    const planIds = new Set(data.plans.map((p) => p.id));
    data.sessions.forEach((s) => {
      if (s.groupId) expect(groupIds.has(s.groupId)).toBe(true);
      if (s.planId) expect(planIds.has(s.planId)).toBe(true);
      s.attendance.forEach((rec) => {
        expect(data.athletes.some((a) => a.id === rec.athleteId)).toBe(true);
      });
    });
  });

  it('jedes Handlungsfeld verweist auf eine existierende Athletin/einen existierenden Athleten', () => {
    const athleteIds = new Set(data.athletes.map((a) => a.id));
    data.actionItems.forEach((item) => expect(athleteIds.has(item.athleteId)).toBe(true));
  });

  it('alle erzeugten IDs sind innerhalb der Demo-Daten eindeutig', () => {
    const allIds = [
      data.club.id,
      ...data.groups.map((g) => g.id),
      ...data.athletes.map((a) => a.id),
      ...data.users.map((u) => u.id),
      ...data.exercises.map((e) => e.id),
      ...data.templates.map((t) => t.id),
      ...data.plans.map((p) => p.id),
      ...data.sessions.map((s) => s.id),
      ...data.actionItems.map((a) => a.id),
      ...data.competitions.map((c) => c.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('jede Wiederholungsblock-Distanz-Struktur enthält nur einfache Sätze (keine verschachtelten Blöcke)', () => {
    data.templates.forEach((tpl) => {
      tpl.sets.forEach((entry) => {
        if (entry.kind === 'block') {
          entry.sets.forEach((s) => expect(s.kind).toBe('set'));
        }
      });
    });
  });

  it('erzeugt bei zwei Aufrufen unterschiedliche IDs (kein versehentliches globales Caching)', () => {
    const data2 = buildDemoData();
    expect(data2.club.id).not.toBe(data.club.id);
  });
});
