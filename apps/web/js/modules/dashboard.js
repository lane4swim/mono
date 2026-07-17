// ============================================================
// modules/dashboard.js
// ============================================================
import { getAll } from '../db.js';
import { el, clear, fmtDateLong, todayISO, fullName, statCard, badge, laneWave, groupBy, average, secToTime, beginRender } from '../utils.js';
import { getRole, getCurrentUser } from '../state.js';
import { navigate } from '../router.js';
import { totalDistance } from './setEditor.js';
import { t, trCode } from '../i18n.js';

export const dashboardModule = {
  id: 'dashboard',
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const role = getRole();
    if (role === 'athlete') return renderAthleteDashboard(container, isCurrent);
    return renderTrainerDashboard(container, isCurrent);
  }
};

async function renderTrainerDashboard(container, isCurrent) {
  const [athletes, groups, plans, sessions, actionItems, competitions] = await Promise.all(
    ['athletes', 'groups', 'plans', 'sessions', 'actionItems', 'competitions'].map(getAll)
  );
  if (!isCurrent()) return;

  const today = todayISO();
  const upcomingComps = competitions.filter(c => c.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const openActions = actionItems.filter(a => a.status !== 'done');
  const recentSessions = [...sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const upcomingPlanDays = [];
  plans.forEach(p => p.days?.forEach(d => { if (d.date >= today) upcomingPlanDays.push({ plan: p, day: d }); }));
  upcomingPlanDays.sort((a, b) => a.day.date.localeCompare(b.day.date));

  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('dashboard.eyebrow')), el('h1', { class: 'mt-0' }, t('dashboard.welcome'))]),
  ]));
  wrap.appendChild(laneWave());

  const stats = el('div', { class: 'grid grid-4 mb-16' }, [
    statCard({ label: t('dashboard.statActiveAthletes'), value: athletes.filter(a => a.active).length, sub: t('dashboard.statGroups', { count: groups.length }) }),
    statCard({ label: t('dashboard.statNextComp'), value: upcomingComps[0] ? fmtDateLong(upcomingComps[0].date) : '—', sub: upcomingComps[0]?.name || t('dashboard.statNoComp'), alt: true }),
    statCard({ label: t('dashboard.statOpenActions'), value: openActions.length, sub: t('dashboard.statActionsTotal', { count: actionItems.length }) }),
    statCard({ label: t('dashboard.statPlannedSessions'), value: upcomingPlanDays.length, sub: t('dashboard.statUpcoming'), alt: true }),
  ]);
  wrap.appendChild(stats);

  const grid = el('div', { class: 'grid grid-2' });

  const planCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.nextSessionsTitle'))]);
  if (upcomingPlanDays.length === 0) {
    planCard.appendChild(el('p', {}, t('dashboard.noUpcomingSessions')));
    planCard.appendChild(el('button', { class: 'btn btn-primary btn-sm', onclick: () => navigate('plans') }, t('dashboard.createPlan')));
  } else {
    upcomingPlanDays.slice(0, 5).forEach(({ plan, day }) => {
      const group = groups.find(g => g.id === plan.groupId);
      planCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('plans', plan.id) }, [
        el('div', { class: 'avatar' }, (group?.name || '?').slice(0, 2).toUpperCase()),
        el('div', { style: 'flex:1' }, [
          el('div', {}, `${fmtDateLong(day.date)}`),
          el('div', { class: 'text-slate text-sm' }, `${plan.name} · ${t('dashboard.metersPlanned', { count: totalDistance(day.sets || []) })}`),
        ]),
      ]));
    });
  }
  grid.appendChild(planCard);

  const compCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.upcomingCompsTitle'))]);
  if (upcomingComps.length === 0) {
    compCard.appendChild(el('p', {}, t('dashboard.noUpcomingComps')));
  } else {
    upcomingComps.slice(0, 4).forEach(c => {
      compCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('competitions', c.id) }, [
        el('div', { style: 'flex:1' }, [
          el('div', {}, c.name),
          el('div', { class: 'text-slate text-sm' }, `${fmtDateLong(c.date)} · ${c.location || '—'}`),
        ]),
        badge(c.course || '', 'neutral'),
      ]));
    });
  }
  compCard.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => navigate('competitions') }, t('dashboard.allComps')));
  grid.appendChild(compCard);

  const actionCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.openActionsTitle'))]);
  if (openActions.length === 0) {
    actionCard.appendChild(el('p', {}, t('dashboard.noOpenActions')));
  } else {
    openActions.slice(0, 5).forEach(a => {
      const athlete = athletes.find(x => x.id === a.athleteId);
      actionCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('actionitems', a.id) }, [
        el('div', { class: 'avatar' }, fullName(athlete).split(' ').map(p => p[0]).join('')),
        el('div', { style: 'flex:1' }, [
          el('div', {}, a.title),
          el('div', { class: 'text-slate text-sm' }, fullName(athlete)),
        ]),
        badge(a.status === 'progress' ? t('refdata.actionStatus.progress') : t('refdata.actionStatus.offen'), a.status === 'progress' ? 'progress' : 'open'),
      ]));
    });
  }
  actionCard.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => navigate('actionitems') }, t('dashboard.allActions')));
  grid.appendChild(actionCard);

  const sessionCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.recentSessionsTitle'))]);
  if (recentSessions.length === 0) {
    sessionCard.appendChild(el('p', {}, t('dashboard.noSessions')));
  } else {
    recentSessions.forEach(s => {
      const present = s.attendance?.filter(a => a.present).length || 0;
      const total = s.attendance?.length || 0;
      const rpeAvg = average(s.attendance?.filter(a => a.present && a.rpe).map(a => a.rpe) || []);
      sessionCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('sessions', s.id) }, [
        el('div', { style: 'flex:1' }, [
          el('div', {}, fmtDateLong(s.date)),
          el('div', { class: 'text-slate text-sm' }, `${t('dashboard.attendanceLine', { present, total })}${rpeAvg ? t('dashboard.avgRpe', { rpe: rpeAvg.toFixed(1) }) : ''}`),
        ]),
      ]));
    });
  }
  sessionCard.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => navigate('sessions') }, t('dashboard.allSessions')));
  grid.appendChild(sessionCard);

  wrap.appendChild(grid);
  container.appendChild(wrap);
}

async function renderAthleteDashboard(container, isCurrent) {
  const user = getCurrentUser();
  const [athletes, results, plans, actionItems, competitions] = await Promise.all(
    ['athletes', 'results', 'plans', 'actionItems', 'competitions'].map(getAll)
  );
  if (!isCurrent()) return;
  const me = athletes.find(a => a.id === user?.athleteId);
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('dashboard.athleteEyebrow')), el('h1', { class: 'mt-0' }, me ? t('dashboard.helloAthlete', { name: me.firstName }) : t('dashboard.welcomeAthlete'))]),
  ]));
  wrap.appendChild(laneWave());

  if (!me) {
    wrap.appendChild(el('p', {}, t('dashboard.noAthleteProfile')));
    container.appendChild(wrap);
    return;
  }

  const myResults = results.filter(r => r.athleteId === me.id).sort((a, b) => b.date.localeCompare(a.date));
  const pbs = groupBy(myResults, r => r.event);
  const today = todayISO();
  const upcomingComps = competitions.filter(c => c.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const myPlans = plans.filter(p => p.groupId === me.groupId);
  const nextDay = [];
  myPlans.forEach(p => p.days?.forEach(d => { if (d.date >= today) nextDay.push({ p, d }); }));
  nextDay.sort((a, b) => a.d.date.localeCompare(b.d.date));
  const myActions = actionItems.filter(a => a.athleteId === me.id);

  wrap.appendChild(el('div', { class: 'grid grid-3 mb-16' }, [
    statCard({ label: t('dashboard.statPBs'), value: Object.keys(pbs).length, sub: t('dashboard.disciplines') }),
    statCard({ label: t('dashboard.statNextSession'), value: nextDay[0] ? fmtDateLong(nextDay[0].d.date) : '—', sub: nextDay[0]?.p.name || '', alt: true }),
    statCard({ label: t('dashboard.statOpenGoals'), value: myActions.filter(a => a.status !== 'done').length, sub: t('dashboard.statActionsTotal', { count: myActions.length }) }),
  ]));

  const grid = el('div', { class: 'grid grid-2' });

  const pbCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.currentPBsTitle'))]);
  if (Object.keys(pbs).length === 0) {
    pbCard.appendChild(el('p', {}, t('dashboard.noTimesYet')));
  } else {
    Object.entries(pbs).forEach(([evt, list]) => {
      const best = list.reduce((a, b) => (a.time < b.time ? a : b));
      pbCard.appendChild(el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, trCode(evt, 'events')),
        el('div', { class: 'data' }, secToTime(best.time)),
      ]));
    });
  }
  grid.appendChild(pbCard);

  const compCard = el('div', { class: 'card' }, [el('h3', {}, t('dashboard.upcomingCompsShort'))]);
  if (upcomingComps.length === 0) compCard.appendChild(el('p', {}, t('dashboard.noneScheduled')));
  else upcomingComps.slice(0, 4).forEach(c => compCard.appendChild(el('div', { class: 'list-row' }, [
    el('div', { style: 'flex:1' }, [el('div', {}, c.name), el('div', { class: 'text-slate text-sm' }, fmtDateLong(c.date))]),
  ])));
  grid.appendChild(compCard);

  wrap.appendChild(grid);
  container.appendChild(wrap);
}
