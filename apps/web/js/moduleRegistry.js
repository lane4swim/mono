// ============================================================
// moduleRegistry.js — die vollständige Liste der Feature-Module, die
// app.js UND app-demo.js gleichermaßen einbinden (Wartbarkeits-Review,
// Befund R3). Vormals in beiden Dateien wortgleich als 14 Imports +
// `.forEach(registerModule)` ausgeschrieben — ein neues Modul musste an
// ZWEI Stellen registriert werden; vergaß man app-demo.js, fehlte es dort
// lautlos.
// ============================================================
import { registerModule } from './router.js';

import { dashboardModule } from './modules/dashboard.js';
import { athletesModule } from './modules/athletes.js';
import { competitionsModule } from './modules/competitions.js';
import { timesModule } from './modules/times.js';
import { plansModule } from './modules/plans.js';
import { templatesModule } from './modules/templates.js';
import { catalogModule } from './modules/catalog.js';
import { sessionsModule } from './modules/sessions.js';
import { actionItemsModule } from './modules/actionItems.js';
import { statsModule } from './modules/stats.js';
import { syncQueueModule } from './modules/syncQueue.js';
import { profileModule } from './modules/profile.js';
import { userManagementModule } from './modules/userManagement.js';
import { infoModule } from './modules/info.js';

const ALL_MODULES = [
  dashboardModule, athletesModule, competitionsModule, timesModule, plansModule,
  templatesModule, catalogModule, sessionsModule, actionItemsModule, statsModule,
  syncQueueModule, profileModule, userManagementModule, infoModule,
];

export function registerAllModules() {
  ALL_MODULES.forEach(registerModule);
}
