// Auswahl der Ansicht (siehe views.js) — zwei Darstellungen desselben
// Kartenrasters:
//   - showViewPicker(): bildschirmfüllend beim App-Start, liefert die Wahl
//     als Promise (app.js/app-demo.js warten darauf, bevor die Shell
//     aufgebaut wird);
//   - viewCardGrid(): das Raster allein, von shell.js: openViewSwitcher()
//     im Modal "Ansicht wechseln" wiederverwendet.
// Beide zeigen dasselbe Häkchen "Immer in dieser Ansicht starten", über
// das die Auswahl beim Start abbestellt (und wieder bestellt) wird.
import { el, icon } from './dom.js';
import { t } from './i18n.js';

export function viewCardGrid(views, { selectedId, onSelect }) {
  return el('div', { class: 'view-card-grid' }, views.map((v) => el('button', {
    type: 'button',
    class: 'view-card' + (v.id === selectedId ? ' selected' : ''),
    'data-view': v.id,
    'aria-current': v.id === selectedId ? 'true' : undefined,
    onclick: () => onSelect(v.id),
  }, [
    icon(v.icon, { class: 'view-card-icon' }),
    el('span', { class: 'view-card-name' }, t(`views.${v.id}.name`)),
    el('span', { class: 'view-card-desc' }, t(`views.${v.id}.desc`)),
  ])));
}

export function alwaysStartCheckbox(checked, onChange) {
  const input = el('input', { type: 'checkbox', onchange: () => onChange?.(input.checked) });
  input.checked = !!checked;
  return {
    input,
    node: el('label', { class: 'consent-checkbox view-always-start' }, [
      input, el('span', {}, t('views.alwaysStart')),
    ]),
  };
}

export function showViewPicker({ views, selectedId, skip }) {
  return new Promise((resolve) => {
    const appShell = document.getElementById('app-shell');
    const checkbox = alwaysStartCheckbox(skip);
    const screen = el('div', {
      class: 'view-picker-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'view-picker-title',
    }, el('div', { class: 'view-picker-box' }, [
      el('h1', { id: 'view-picker-title', class: 'view-picker-title' }, t('views.pickerTitle')),
      el('p', { class: 'hint' }, t('views.pickerIntro')),
      viewCardGrid(views, { selectedId, onSelect: choose }),
      checkbox.node,
      el('p', { class: 'hint' }, t('views.switchLaterHint')),
    ]));
    appShell?.setAttribute('inert', '');
    document.body.appendChild(screen);
    (screen.querySelector('.view-card.selected') || screen.querySelector('.view-card'))?.focus();

    function choose(viewId) {
      screen.remove();
      appShell?.removeAttribute('inert');
      resolve({ viewId, skip: checkbox.input.checked });
    }
  });
}
