// Prüfung importierter JSON-Dateien (planTransfer.js, libraryTransfer.js)
// gegen dieselben Grenzen, die der Server beim Sync erzwingt
// (packages/shared-types/src/entities.ts: ExerciseSchema, TemplateSchema,
// SectionTemplateSchema, PlanSchema, PlainSetSchema, RepeatBlockSchema,
// SectionSchema). apps/web hat keinen Build-Schritt und kann Zod nicht
// direkt laden; IMPORT_LIMITS spiegelt die Werte deshalb, und
// test/importValidation.test.js prüft sie gegen die Schemas.
//
// Eine Datei, die die Grenzen verletzt, wird als Ganzes abgelehnt, bevor
// irgendetwas geschrieben wird. Sonst entstünden Datensätze, die nur auf
// diesem Gerät existieren: der Server lehnt jeden Push davon ab, und nach
// MAX_SYNC_ATTEMPTS bleibt der Eintrag in der Sync-Warteschlange als
// "failed" liegen (Issue #133). Fehlende optionale Felder sind erlaubt —
// die Importer setzen dafür dieselben Standardwerte wie bisher.
export const IMPORT_LIMITS = Object.freeze({
  nameLength: 200,
  categoryLength: 100,
  strokeLength: 100,
  descriptionLength: 5000,
  setDescriptionLength: 2000,
  intensityLength: 200,
  labelLength: 200,
  headingLength: 200,
  tagLength: 100,
  tagCount: 50,
  equipmentCount: 50,
  entriesCount: 200,
  blockSetsCount: 50,
  planDaysCount: 60,
});

const COURSE_VALUES = new Set(['LCM', 'SCM']);
const PLAN_STATUS_VALUES = new Set(['aktiv', 'archiv']);

export class ImportValidationError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'ImportValidationError';
    this.path = path;
    this.reason = reason;
  }
}

function fail(path, reason) {
  throw new ImportValidationError(path, reason);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function requireObject(value, path) {
  if (!isObject(value)) fail(path, 'object-expected');
}

// `required`: muss vorhanden und nicht leer sein. Sonst darf das Feld
// fehlen (undefined), ist es aber da, muss es ein String sein.
function checkString(obj, key, path, max, { required = false, nullable = false } = {}) {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) {
    if (required) fail(`${path}.${key}`, 'required');
    return;
  }
  if (typeof value !== 'string') fail(`${path}.${key}`, 'string-expected');
  if (required && !value.trim()) fail(`${path}.${key}`, 'required');
  if (value.length > max) fail(`${path}.${key}`, 'too-long');
}

function checkInt(obj, key, path, { min, nullable = false }) {
  const value = obj[key];
  if (value === undefined || (nullable && value === null)) return;
  if (!Number.isInteger(value) || value < min) fail(`${path}.${key}`, 'invalid-number');
}

function checkStringArray(obj, key, path, { maxItems, maxLength }) {
  const value = obj[key];
  if (value === undefined) return;
  if (!Array.isArray(value)) fail(`${path}.${key}`, 'array-expected');
  if (value.length > maxItems) fail(`${path}.${key}`, 'too-many');
  value.forEach((item, i) => {
    if (typeof item !== 'string') fail(`${path}.${key}[${i}]`, 'string-expected');
    if (item.length > maxLength) fail(`${path}.${key}[${i}]`, 'too-long');
  });
}

function checkArray(value, path, maxItems, { required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail(path, 'array-expected');
  if (value.length > maxItems) fail(path, 'too-many');
  return value;
}

function checkIsoDate(value, path) {
  if (typeof value !== 'string') fail(path, 'date-expected');
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) fail(path, 'date-expected');
}

const L = IMPORT_LIMITS;

function validatePlainSet(entry, path) {
  checkString(entry, 'description', path, L.setDescriptionLength);
  checkInt(entry, 'distance', path, { min: 0, nullable: true });
  checkInt(entry, 'durationSec', path, { min: 1, nullable: true });
  checkInt(entry, 'reps', path, { min: 1 });
  checkString(entry, 'intensity', path, L.intensityLength);
  checkInt(entry, 'restSec', path, { min: 0 });
  checkString(entry, 'exerciseId', path, Infinity, { nullable: true });
  checkStringArray(entry, 'equipment', path, { maxItems: L.equipmentCount, maxLength: L.tagLength });
}

function validateBlock(entry, path) {
  checkString(entry, 'label', path, L.labelLength);
  checkInt(entry, 'repeatCount', path, { min: 1 });
  checkArray(entry.sets, `${path}.sets`, L.blockSetsCount).forEach((s, i) => validateEntry(s, `${path}.sets[${i}]`, ['set']));
}

function validateSection(entry, path) {
  checkString(entry, 'heading', path, L.headingLength);
  checkArray(entry.entries, `${path}.entries`, L.entriesCount).forEach((s, i) => validateEntry(s, `${path}.entries[${i}]`, ['set', 'block']));
}

// Abschnitte und Blöcke verschachteln sich nicht (siehe SectionSchema in
// entities.ts): `allowed` grenzt die zulässigen Arten je Ebene ein.
function validateEntry(entry, path, allowed) {
  requireObject(entry, path);
  if (!allowed.includes(entry.kind)) fail(`${path}.kind`, 'invalid-kind');
  if (entry.kind === 'block') validateBlock(entry, path);
  else if (entry.kind === 'section') validateSection(entry, path);
  else validatePlainSet(entry, path);
}

function validateEntries(value, path, allowed) {
  checkArray(value, path, L.entriesCount, { required: false }).forEach((e, i) => validateEntry(e, `${path}[${i}]`, allowed));
}

function validateTags(obj, path) {
  checkStringArray(obj, 'tags', path, { maxItems: L.tagCount, maxLength: L.tagLength });
}

// `requireId`: im Plan-Export dient die exportierte id als Referenz für
// sets[].exerciseId und ist dort Pflicht.
export function validateExerciseFile(ex, path, { requireId = false } = {}) {
  requireObject(ex, path);
  checkString(ex, 'id', path, Infinity, { required: requireId });
  checkString(ex, 'name', path, L.nameLength, { required: true });
  checkString(ex, 'category', path, L.categoryLength, { required: true });
  checkString(ex, 'stroke', path, L.strokeLength, { nullable: true });
  checkString(ex, 'description', path, L.descriptionLength);
  checkInt(ex, 'defaultDistance', path, { min: 1, nullable: true });
  checkInt(ex, 'defaultDurationSec', path, { min: 1, nullable: true });
  validateTags(ex, path);
  checkStringArray(ex, 'equipment', path, { maxItems: L.equipmentCount, maxLength: L.tagLength });
}

export function validatePlanFile(dump) {
  const plan = dump.plan;
  requireObject(plan, 'plan');
  checkString(plan, 'name', 'plan', L.nameLength);
  if (plan.weekStart !== undefined) checkIsoDate(plan.weekStart, 'plan.weekStart');
  if (plan.status !== undefined && !PLAN_STATUS_VALUES.has(plan.status)) fail('plan.status', 'invalid-value');
  checkString(plan, 'groupName', 'plan', L.nameLength, { nullable: true });
  checkArray(plan.days, 'plan.days', L.planDaysCount, { required: false }).forEach((day, i) => {
    const path = `plan.days[${i}]`;
    requireObject(day, path);
    checkIsoDate(day.date, `${path}.date`);
    if (day.poolLength !== undefined && day.poolLength !== null && !COURSE_VALUES.has(day.poolLength)) fail(`${path}.poolLength`, 'invalid-value');
    validateEntries(day.sets, `${path}.sets`, ['set', 'block', 'section']);
  });
  checkArray(dump.exercises, 'exercises', Infinity, { required: false }).forEach((ex, i) => validateExerciseFile(ex, `exercises[${i}]`, { requireId: true }));
}

export function validateLibraryFile(dump) {
  checkArray(dump.exercises, 'exercises', Infinity, { required: false }).forEach((ex, i) => validateExerciseFile(ex, `exercises[${i}]`));
  checkArray(dump.templates, 'templates', Infinity, { required: false }).forEach((tpl, i) => {
    const path = `templates[${i}]`;
    requireObject(tpl, path);
    checkString(tpl, 'id', path, Infinity);
    checkString(tpl, 'name', path, L.nameLength, { required: true });
    checkString(tpl, 'description', path, L.descriptionLength);
    validateTags(tpl, path);
    validateEntries(tpl.sets, `${path}.sets`, ['set', 'block', 'section']);
  });
  checkArray(dump.sectionTemplates, 'sectionTemplates', Infinity, { required: false }).forEach((st, i) => {
    const path = `sectionTemplates[${i}]`;
    requireObject(st, path);
    checkString(st, 'id', path, Infinity);
    checkString(st, 'name', path, L.nameLength, { required: true });
    checkString(st, 'description', path, L.descriptionLength);
    validateTags(st, path);
    validateEntries(st.entries, `${path}.entries`, ['set', 'block']);
  });
}
