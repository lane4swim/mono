// @vitest-environment jsdom
//
// Gegenprobe zu test/views.test.js gegen die ECHTE Modulliste
// (moduleRegistry.js): jedes registrierte Modul muss in mindestens einer
// Ansicht stehen oder gemeinsam sein — ein neues Modul, das in views.js
// vergessen wurde, wäre sonst bei gewählter Ansicht aus der Navigation
// verschwunden.
import { describe, it, expect } from 'vitest';
import { MODULES } from '../js/router.js';
import { registerAllModules } from '../js/moduleRegistry.js';
import { VIEWS, COMMON_MODULE_IDS } from '../js/views.js';

registerAllModules();

describe('views.js gegen moduleRegistry.js', () => {
  it('jedes registrierte Modul ist einer Ansicht zugeordnet oder gemeinsam', () => {
    const covered = new Set([...COMMON_MODULE_IDS, ...VIEWS.flatMap((v) => v.moduleIds)]);
    expect(MODULES.map((m) => m.id).filter((id) => !covered.has(id))).toEqual([]);
  });

  it('views.js verweist nur auf tatsächlich registrierte Module', () => {
    const registered = new Set(MODULES.map((m) => m.id));
    expect([...COMMON_MODULE_IDS, ...VIEWS.flatMap((v) => v.moduleIds)].filter((id) => !registered.has(id))).toEqual([]);
  });
});
