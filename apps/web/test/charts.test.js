// @vitest-environment jsdom
//
// apps/web/test/charts.test.js
//
// Code-Review 2026-09-02, Befund P2: `color`/`bars[].color` landen in
// svgLineChart()/svgBarChart() direkt in einem SVG-ATTRIBUTWERT
// (`stroke="${color}"`/`fill="${...}"`), gefolgt von `wrap.innerHTML =`,
// das den zusammengebauten String erneut als HTML/SVG parst — ein Wert
// wie `x" onload="alert(1)` bräche dadurch aus dem Attribut aus und
// schleuste ein zusätzliches, ausführbares Element-Attribut ein. Kein
// heutiger Aufrufer (modules/stats.js, modules/times.js) übergibt einen
// solchen Wert, aber genau das ist der Punkt dieses Tests: safeColor()
// muss JEDEN Wert außerhalb des engen erwarteten Formats (CSS-Custom-
// Property-Referenz, Hex-Farbe, CSS-Farbname) abfangen, unabhängig davon,
// ob ein heutiger Aufrufer ihn tatsächlich sendet.
import { describe, it, expect } from 'vitest';
import { svgLineChart, svgBarChart } from '../js/charts.js';

const MALICIOUS_COLOR = 'x" onload="alert(1)';

describe('svgLineChart() — Befund P2 (Farbwert-Injektion)', () => {
  it('übernimmt eine gültige CSS-Custom-Property-Referenz unverändert', () => {
    const wrap = svgLineChart({ points: [{ y: 1, label: 'a' }, { y: 2, label: 'b' }], color: 'var(--c-lane-d)' });
    expect(wrap.innerHTML).toContain('stroke="var(--c-lane-d)"');
  });

  it('verwirft einen bösartigen color-Wert statt ihn in ein SVG-Attribut einzubetten', () => {
    const wrap = svgLineChart({ points: [{ y: 1, label: 'a' }, { y: 2, label: 'b' }], color: MALICIOUS_COLOR });
    expect(wrap.innerHTML).not.toContain('onload');
    // Fällt auf den Funktions-Default zurück statt auf einen leeren/
    // undefinierten Wert — das SVG bleibt ein gültiges, farbiges Diagramm.
    expect(wrap.innerHTML).toContain('stroke="var(--c-chlorine-d)"');
  });

  it('escapt einen Gitterlinien-Beschriftungstext aus einem benutzerdefinierten yFormat', () => {
    const wrap = svgLineChart({
      points: [{ y: 1, label: 'a' }, { y: 2, label: 'b' }],
      yFormat: () => '<b>x</b>',
    });
    expect(wrap.innerHTML).not.toContain('<b>x</b>');
    expect(wrap.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('svgBarChart() — Befund P2 (Farbwert-Injektion)', () => {
  it('übernimmt eine gültige Hex-Farbe für einen einzelnen Balken unverändert', () => {
    const wrap = svgBarChart({ bars: [{ label: 'Jan', value: 3, color: '#ff00ff' }] });
    expect(wrap.innerHTML).toContain('fill="#ff00ff"');
  });

  it('verwirft einen bösartigen color-Wert auf Diagrammebene', () => {
    const wrap = svgBarChart({ bars: [{ label: 'Jan', value: 3 }], color: MALICIOUS_COLOR });
    expect(wrap.innerHTML).not.toContain('onload');
    expect(wrap.innerHTML).toContain('fill="var(--c-petrol)"');
  });

  it('verwirft einen bösartigen color-Wert auf Einzelbalken-Ebene, fällt auf die Diagrammfarbe zurück', () => {
    const wrap = svgBarChart({ bars: [{ label: 'Jan', value: 3, color: MALICIOUS_COLOR }], color: 'var(--c-petrol)' });
    expect(wrap.innerHTML).not.toContain('onload');
    expect(wrap.innerHTML).toContain('fill="var(--c-petrol)"');
  });
});
