// Team-Filter (Gruppen) für Kalender, Einheiten- und Wettkampfliste:
// Auswahl einer oder mehrerer Gruppen als Chip-Reihe, je Person und Ansicht
// gemerkt. Keine Auswahl = alle Teams.
//
// Ein Datensatz trägt dafür eine Liste von Gruppen-IDs (`groupIds`) oder
// `null`, wenn er an kein Team gebunden ist (Ferien, vereinsweite Pläne,
// Wettkämpfe noch ohne Meldungen …) — solche Datensätze bleiben bei jeder
// Auswahl sichtbar, sonst verschwänden sie gerade dann, wenn man nur auf
// das eigene Team schaut.
import { el, clear } from './dom.js';
import { t } from './i18n.js';

export function matchesTeams(groupIds, selected) {
  if (!selected || selected.size === 0) return true;
  if (!groupIds || groupIds.length === 0) return true;
  return groupIds.some((id) => selected.has(id));
}

// Teams eines Wettkampfs = Gruppen der gemeldeten Athlet:innen; ohne
// Meldungen (oder nur mit gruppenlosen Athlet:innen) an kein Team gebunden.
export function competitionGroupIds(entries, athleteGroup) {
  const ids = new Set();
  for (const e of entries) {
    const groupId = athleteGroup.get(e.athleteId);
    if (groupId) ids.add(groupId);
  }
  return ids.size ? [...ids] : null;
}

export function athleteGroupMap(athletes = []) {
  return new Map(athletes.map((a) => [a.id, a.groupId || null]));
}

const STORAGE_PREFIX = 'lane1.teamFilter.';

// Gespeicherte Auswahl, beschränkt auf noch vorhandene Gruppen (eine
// gelöschte Gruppe soll nicht unsichtbar weiterfiltern).
export function loadTeamSelection(view, user, groups) {
  if (!user?.id) return new Set();
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${view}.${user.id}`) || '[]');
    const valid = new Set(groups.map((g) => g.id));
    return new Set(Array.isArray(stored) ? stored.filter((id) => valid.has(id)) : []);
  } catch {
    return new Set();
  }
}

export function saveTeamSelection(view, user, selected) {
  if (!user?.id) return;
  try { globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${view}.${user.id}`, JSON.stringify([...selected])); } catch { /* Speicher nicht verfügbar — gilt dann nur für diese Sitzung */ }
}

// Chip-Reihe "Teams: [A] [B] … [Alle Teams]". Zeichnet sich bei jeder
// Änderung selbst neu und meldet die neue Auswahl an `onChange`. Bei
// höchstens einer Gruppe gibt es nichts zu filtern — dann ein leerer
// Container.
export function teamFilterChips(groups, selected, onChange) {
  const host = el('div', { class: 'team-filter', role: 'group', 'aria-label': t('teamFilter.label') });
  let current = new Set(selected);
  function draw() {
    clear(host);
    if (groups.length < 2) return;
    host.appendChild(el('span', { class: 'team-filter-label' }, t('teamFilter.label')));
    for (const g of groups) {
      const on = current.has(g.id);
      host.appendChild(el('button', {
        type: 'button', class: `team-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on),
        onclick: () => {
          const next = new Set(current);
          if (on) next.delete(g.id); else next.add(g.id);
          set(next);
        },
      }, g.name));
    }
    host.appendChild(el('button', {
      type: 'button', class: `team-chip team-chip-all ${current.size === 0 ? 'on' : ''}`, 'aria-pressed': String(current.size === 0),
      onclick: () => set(new Set()),
    }, t('teamFilter.all')));
  }
  function set(next) {
    current = next;
    draw();
    onChange(next);
  }
  draw();
  return host;
}
