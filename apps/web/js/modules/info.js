// ============================================================
// modules/info.js — "Rechtliches & Datenschutz" / "Legal & Privacy"
//
// Deliberately NOT restricted via `roles` on the module (see profile.js
// for the same pattern) — this page must be reachable from every view,
// regardless of role, so it appears in the main nav (sidenav + mobile
// bottom tabs) for everyone.
//
// The actual content-building function (`buildLegalContent`) is exported
// separately so authScreens.js can reuse the exact same content in a
// modal BEFORE login — Impressum-style legal notices are required to be
// reachable independent of login state (§5 TMG), and duplicating the
// text in two places would be a maintenance trap.
// ============================================================
import { el, clear, laneWave, beginRender } from '../utils.js';
import { t } from '../i18n.js';

export const infoModule = {
  id: 'info',
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    if (!isCurrent()) return;

    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [el('div', { class: 'page-eyebrow' }, t('legal.pageEyebrow')), el('h1', { class: 'mt-0' }, t('legal.pageTitle'))]),
    ]));
    wrap.appendChild(laneWave());
    wrap.appendChild(el('p', {}, t('legal.pageIntro')));
    wrap.appendChild(buildLegalContent());
    container.appendChild(wrap);
  },
};

// One `<details>` per collapsible section; a plain (always-open) block
// for the Impressum, since that one must stay permanently visible rather
// than collapsed by default.
export function buildLegalContent() {
  const host = el('div');
  host.appendChild(buildImprintSection());
  host.appendChild(buildCollapsibleSection('gdpr', t('legal.gdprTitle'), buildGdprBody()));
  host.appendChild(buildCollapsibleSection('cookies', t('legal.cookieTitle'), buildCookieBody()));
  host.appendChild(buildCollapsibleSection('terms', t('legal.termsTitle'), buildTermsBody()));
  return host;
}

function buildImprintSection() {
  const box = el('div', { class: 'legal-static' }, [
    el('h3', { class: 'mt-0' }, t('legal.imprintTitle')),
    el('h4', {}, t('legal.imprintServiceProvider')),
    el('p', {}, [el('strong', {}, t('legal.imprintPlaceholderClub')), el('br'), t('legal.imprintPlaceholderAddress')]),
    el('h4', {}, t('legal.imprintRepresented')),
    el('p', {}, t('legal.imprintPlaceholderRep')),
    el('h4', {}, t('legal.imprintContact')),
    el('p', {}, [t('legal.imprintPlaceholderEmail'), el('br'), t('legal.imprintPlaceholderPhone')]),
    el('h4', {}, t('legal.imprintRegister')),
    el('p', {}, t('legal.imprintPlaceholderRegister')),
    el('h4', {}, t('legal.imprintResponsible')),
    el('p', {}, t('legal.imprintPlaceholderResponsible')),
    el('p', { class: 'hint', style: 'margin-top:14px' }, t('legal.imprintNote')),
  ]);
  return box;
}

function buildCollapsibleSection(key, title, bodyNode) {
  const details = el('details', { class: 'legal-section', id: `legal-${key}` });
  details.appendChild(el('summary', {}, title));
  const body = el('div', { class: 'legal-body' }, bodyNode);
  details.appendChild(body);
  return details;
}

function labeledParagraph(titleKey, textKey) {
  return [el('h4', {}, t(titleKey)), el('p', {}, t(textKey))];
}

function bulletList(items) {
  return el('ul', {}, (items || []).map((item) => el('li', {}, item)));
}

function buildGdprBody() {
  return [
    el('p', {}, t('legal.gdprIntro')),
    ...labeledParagraph('legal.gdprResponsibleTitle', 'legal.gdprResponsibleText'),
    el('h4', {}, t('legal.gdprDataTitle')),
    bulletList(t('legal.gdprDataList')),
    ...labeledParagraph('legal.gdprPurposeTitle', 'legal.gdprPurposeText'),
    ...labeledParagraph('legal.gdprStorageTitle', 'legal.gdprStorageText'),
    ...labeledParagraph('legal.gdprRetentionTitle', 'legal.gdprRetentionText'),
    ...labeledParagraph('legal.gdprRightsTitle', 'legal.gdprRightsText'),
    el('h4', {}, t('legal.gdprContactTitle')),
    el('p', {}, t('legal.gdprPlaceholderContact')),
  ];
}

function buildCookieBody() {
  return [
    el('p', {}, t('legal.cookieIntro')),
    ...labeledParagraph('legal.cookieStorageTitle', 'legal.cookieStorageText'),
    el('h4', {}, t('legal.cookieListTitle')),
    bulletList(t('legal.cookieList')),
    el('p', {}, t('legal.cookieNoThirdParty')),
  ];
}

function buildTermsBody() {
  return [
    ...labeledParagraph('legal.termsScopeTitle', 'legal.termsScopeText'),
    ...labeledParagraph('legal.termsAccountTitle', 'legal.termsAccountText'),
    ...labeledParagraph('legal.termsUseTitle', 'legal.termsUseText'),
    ...labeledParagraph('legal.termsAvailabilityTitle', 'legal.termsAvailabilityText'),
    ...labeledParagraph('legal.termsLiabilityTitle', 'legal.termsLiabilityText'),
    ...labeledParagraph('legal.termsChangesTitle', 'legal.termsChangesText'),
  ];
}
