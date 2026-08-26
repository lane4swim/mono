// packages/shared-types/test/modules.test.ts
import { describe, it, expect } from 'vitest';
import { MODULE_PACKAGES, MODULE_KEYS, ROUTE_TO_PACKAGE, ModuleKeySchema } from '../src/modules.js';
import { ENTITY_STORE_NAMES } from '../src/entities.js';

describe('MODULE_PACKAGES', () => {
  it('jeder Store in MODULE_PACKAGES[*].stores ist ein bekannter EntityStoreName', () => {
    for (const key of MODULE_KEYS) {
      for (const store of MODULE_PACKAGES[key].stores) {
        expect(ENTITY_STORE_NAMES).toContain(store);
      }
    }
  });

  it('"results" gehört bewusst zu KEINEM Paket (siehe STORE_MODULE_MAP-Sonderfall in sync.permissions.ts)', () => {
    for (const key of MODULE_KEYS) {
      expect(MODULE_PACKAGES[key].stores).not.toContain('results');
    }
  });

  it('MODULE_KEYS und ModuleKeySchema stimmen überein', () => {
    for (const key of MODULE_KEYS) {
      expect(ModuleKeySchema.safeParse(key).success).toBe(true);
    }
    expect(ModuleKeySchema.safeParse('nicht-existierendes-modul').success).toBe(false);
  });
});

describe('ROUTE_TO_PACKAGE', () => {
  it('jede Router-ID aus einem Paket zeigt zurück auf dessen eigenen Paket-Key', () => {
    for (const key of MODULE_KEYS) {
      for (const routeId of MODULE_PACKAGES[key].routeIds) {
        expect(ROUTE_TO_PACKAGE[routeId]).toBe(key);
      }
    }
  });
});
