// "Rechtliches & Datenschutz" / "Legal & Privacy"
//
// Deliberately NOT restricted via `roles` on the module (see profile.js
// for the same pattern) — this page must be reachable from every view,
// regardless of role, so it appears in the main nav (sidenav + mobile
// bottom tabs) for everyone.
//
// The actual content-building function (`buildLegalContent`) is exported
// separately so authScreens.js can reuse the exact same content in a
// modal BEFORE login — Impressum-style legal notices are required to be
// reachable independent of login state (§5 TMG/§5 DDG). authScreens.js
// calls it WITHOUT the `legalInfo` argument (there is no authenticated
// clubId yet at that point) and therefore always sees the generic
// placeholder text, by design (see docs/Plans/club-legal-info-plan.md,
// Abschnitt "Vorab-Anzeige ohne Login bleibt generisch") — duplicating
// the text in two places would be a maintenance trap, but per-club data
// simply isn't available pre-login.
//
// Post-login (this module's own render()), the placeholder text is
// progressively replaced with the actual club's data once
// GET /api/clubs/:id/legal-info resolves (see fetchOwnClubLegalInfo()
// below) — club admins maintain it via modules/userManagement.js.
import { el, clear, beginRender } from '../dom.js';
import { laneWave } from '../ui.js';
import { t } from '../i18n.js';
import { getCurrentUser } from '../state.js';
import { IS_DEMO } from '../demoMode.js';
import * as api from '../apiClient.js';

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

    // Placeholder-Inhalt zuerst rendern (sofortige, funktionsfähige Seite,
    // auch offline/im Demo-Modus) — der Abruf der echten Vereinsangaben
    // unten ersetzt ihn erst, sobald er erfolgreich war.
    const legalHost = el('div');
    legalHost.appendChild(buildLegalContent());
    wrap.appendChild(legalHost);
    container.appendChild(wrap);

    const legalInfo = await fetchOwnClubLegalInfo();
    if (!isCurrent() || !legalInfo) return;
    clear(legalHost);
    legalHost.appendChild(buildLegalContent(legalInfo));
  },
};

// null, wenn keine Anzeige der echten Vereinsangaben möglich/nötig ist
// (Demo-Modus ohne Backend, Superadmin ohne eigenen Verein, offline/
// Netzwerkfehler) — der Aufrufer bleibt in diesem Fall einfach bei der
// generischen Platzhalter-Anzeige, siehe render() oben.
async function fetchOwnClubLegalInfo() {
  if (IS_DEMO) return null;
  const user = getCurrentUser();
  if (!user?.clubId) return null;
  try {
    const { legalInfo } = await api.getClubLegalInfo(user.clubId);
    return legalInfo;
  } catch {
    return null;
  }
}

// One `<details>` per collapsible section; a plain (always-open) block
// for the Impressum, since that one must stay permanently visible rather
// than collapsed by default.
//
// `legalInfo` (optional, `{ legalInfo }` aus GET /api/clubs/:id/legal-info,
// siehe fetchOwnClubLegalInfo() oben): fehlt es (pre-login in
// authScreens.js, oder solange der Abruf noch läuft/fehlschlägt), zeigen
// beide betroffenen Abschnitte weiterhin die bisherigen, generischen
// i18n-Platzhaltertexte.
export function buildLegalContent(legalInfo = null) {
  const host = el('div');
  host.appendChild(buildImprintSection(legalInfo));
  host.appendChild(buildCollapsibleSection('gdpr', t('legal.gdprTitle'), buildGdprBody(legalInfo)));
  host.appendChild(buildCollapsibleSection('cookies', t('legal.cookieTitle'), buildCookieBody()));
  host.appendChild(buildCollapsibleSection('terms', t('legal.termsTitle'), buildTermsBody()));
  return host;
}

// Liefert den übergebenen Wert, sofern er ein nicht-leerer String ist,
// sonst den Platzhalter-Text — EIN Feld nach dem anderen, statt eines
// Alles-oder-nichts-Umschaltens zwischen "komplett Platzhalter" und
// "komplett echte Daten": ein Verein, das erst einen Teil der Angaben
// gepflegt hat, sieht die restlichen Felder trotzdem sofort als
// erkennbare, auszufüllende Platzhalter statt einer leeren Zeile.
function orPlaceholder(value, placeholderKey) {
  return value && value.trim() ? value : t(placeholderKey);
}

function buildImprintSection(legalInfo) {
  const address = legalInfo && (legalInfo.addressLine1 || legalInfo.postalCode || legalInfo.city)
    ? [legalInfo.addressLine1, [legalInfo.postalCode, legalInfo.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : t('legal.imprintPlaceholderAddress');
  const contact = legalInfo && (legalInfo.contactEmail || legalInfo.contactPhone)
    ? [legalInfo.contactEmail, legalInfo.contactPhone].filter(Boolean)
    : [t('legal.imprintPlaceholderEmail'), t('legal.imprintPlaceholderPhone')];
  const register = legalInfo && (legalInfo.registerNumber || legalInfo.registerCourt)
    ? [legalInfo.registerNumber, legalInfo.registerCourt].filter(Boolean).join(', ')
    : t('legal.imprintPlaceholderRegister');

  const box = el('div', { class: 'legal-static' }, [
    el('h3', { class: 'mt-0' }, t('legal.imprintTitle')),
    el('h4', {}, t('legal.imprintServiceProvider')),
    el('p', {}, [el('strong', {}, legalInfo ? legalInfo.name : t('legal.imprintPlaceholderClub')), el('br'), address]),
    el('h4', {}, t('legal.imprintRepresented')),
    el('p', {}, orPlaceholder(legalInfo?.representativeName, 'legal.imprintPlaceholderRep')),
    el('h4', {}, t('legal.imprintContact')),
    el('p', {}, contact.flatMap((line, i) => (i === 0 ? [line] : [el('br'), line]))),
    el('h4', {}, t('legal.imprintRegister')),
    el('p', {}, register),
    el('h4', {}, t('legal.imprintResponsible')),
    // Kein eigenes Feld für "inhaltlich Verantwortliche:r" (§ 18 Abs. 2
    // MStV) — bei einem Verein dieser Größenordnung ist das in aller
    // Regel dieselbe Person wie die/der Vertretungsberechtigte oben,
    // ein zusätzliches Formularfeld nur für diesen Sonderfall wäre
    // unverhältnismäßig (siehe docs/Plans/club-legal-info-plan.md).
    el('p', {}, orPlaceholder(legalInfo?.representativeName, 'legal.imprintPlaceholderResponsible')),
    ...(legalInfo?.vatId ? [el('h4', {}, t('legal.imprintVatId')), el('p', {}, legalInfo.vatId)] : []),
    ...(!legalInfo ? [el('p', { class: 'hint', style: 'margin-top:14px' }, t('legal.imprintNote'))] : []),
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

function buildGdprBody(legalInfo) {
  // Datenschutzanfragen-Adresse: bevorzugt privacyContactEmail, fällt auf
  // contactEmail zurück, wenn nur dieses gesetzt ist (Art. 13 Abs. 1
  // Buchst. a DSGVO), siehe ClubLegalInfoSchema-Kommentar in
  // packages/shared-types/src/invitation.ts.
  const privacyContact = legalInfo?.privacyContactEmail || legalInfo?.contactEmail;
  const dpoLine = legalInfo?.dpoRequired && (legalInfo.dpoName || legalInfo.dpoContact)
    ? [legalInfo.dpoName, legalInfo.dpoContact].filter(Boolean).join(', ')
    : null;

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
    el('p', {}, orPlaceholder(privacyContact, 'legal.gdprPlaceholderContact')),
    // Art. 13 Abs. 2 Buchst. d DSGVO — Recht auf Beschwerde bei einer
    // Aufsichtsbehörde. Nur bei vorhandener Angabe gezeigt (kein
    // Platzhalter-Fallback): eine falsch geratene Behörde wäre
    // irreführender als das komplette Fehlen der Angabe.
    ...(legalInfo?.supervisoryAuthority ? [el('h4', {}, t('legal.gdprAuthorityTitle')), el('p', {}, legalInfo.supervisoryAuthority)] : []),
    ...(dpoLine ? [el('h4', {}, t('legal.gdprDpoTitle')), el('p', {}, dpoLine)] : []),
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
