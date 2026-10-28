// Dynamic field definitions for asset types.
//
// Shared by the browser (form rendering, offline validation) and the Worker
// (server-side validation), so the rules live in exactly one place.
//
// A field definition looks like:
//   { key, label, type, scope, required?, options?, min?, max?, unit?, alert? }
//   type:  number | text | boolean | select | multiselect | date
//   scope: asset (set once when linking) | check (captured on every scan)
//   step:  numbers only, value must be min + k*step (e.g. fuel in 25% steps)
//   alert: { below: n } | { atMost: n } | { above: n } | { equals: value } | { any: true }

export const FIELD_TYPES = ['number', 'text', 'boolean', 'select', 'multiselect', 'date'];
export const FIELD_SCOPES = ['asset', 'check'];

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Checks a type's field list; returns a list of human-readable problems. */
export function validateFieldDefs(defs) {
  if (!Array.isArray(defs)) return ['fields must be a list'];
  const errors = [];
  const seen = new Set();
  defs.forEach((f, i) => {
    const where = `field ${i + 1}${f && f.key ? ` (${f.key})` : ''}`;
    if (!f || typeof f !== 'object') return errors.push(`${where}: not an object`);
    if (!KEY_RE.test(f.key || '')) errors.push(`${where}: key must be lowercase letters, digits or _ and start with a letter`);
    if (seen.has(f.key)) errors.push(`${where}: duplicate key`);
    seen.add(f.key);
    if (!f.label || typeof f.label !== 'string') errors.push(`${where}: label is required`);
    if (!FIELD_TYPES.includes(f.type)) errors.push(`${where}: type must be one of ${FIELD_TYPES.join(', ')}`);
    if (!FIELD_SCOPES.includes(f.scope)) errors.push(`${where}: scope must be asset or check`);
    if ((f.type === 'select' || f.type === 'multiselect') &&
        (!Array.isArray(f.options) || f.options.length === 0 || f.options.some((o) => typeof o !== 'string' || !o))) {
      errors.push(`${where}: options must be a non-empty list of text values`);
    }
    if (f.step != null && !(typeof f.step === 'number' && f.step > 0)) errors.push(`${where}: step must be a positive number`);
    for (const k of ['min', 'max']) {
      if (f[k] != null && typeof f[k] !== 'number') errors.push(`${where}: ${k} must be a number`);
    }
  });
  return errors;
}

function isBlank(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Validates and coerces input values for the fields of one scope.
 * Unknown keys are dropped. Returns { values, errors } where errors maps key -> message.
 */
export function normalizeValues(defs, scope, input) {
  const values = {};
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const f of defs.filter((d) => d.scope === scope)) {
    let v = src[f.key];
    if (isBlank(v)) {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n)) { errors[f.key] = `${f.label} must be a number`; continue; }
        if (f.min != null && n < f.min) { errors[f.key] = `${f.label} must be at least ${f.min}`; continue; }
        if (f.max != null && n > f.max) { errors[f.key] = `${f.label} must be at most ${f.max}`; continue; }
        if (f.step && Math.abs(((n - (f.min ?? 0)) / f.step) - Math.round((n - (f.min ?? 0)) / f.step)) > 1e-9) {
          errors[f.key] = `${f.label} must be in steps of ${f.step}${f.unit ? ` ${f.unit}` : ''}`;
          continue;
        }
        values[f.key] = n;
        break;
      }
      case 'boolean':
        if (typeof v === 'boolean') values[f.key] = v;
        else if (['true', 'yes', '1', 'on'].includes(String(v).toLowerCase())) values[f.key] = true;
        else if (['false', 'no', '0', 'off'].includes(String(v).toLowerCase())) values[f.key] = false;
        else errors[f.key] = `${f.label} must be yes or no`;
        break;
      case 'select':
        if (f.options.includes(String(v))) values[f.key] = String(v);
        else errors[f.key] = `${f.label} must be one of: ${f.options.join(', ')}`;
        break;
      case 'multiselect': {
        const list = (Array.isArray(v) ? v : [v]).map(String);
        const bad = list.filter((o) => !f.options.includes(o));
        if (bad.length) errors[f.key] = `${f.label}: unknown option ${bad.join(', ')}`;
        else values[f.key] = [...new Set(list)];
        break;
      }
      case 'date':
        if (/^\d{4}-\d{2}-\d{2}/.test(String(v)) && !Number.isNaN(Date.parse(v))) values[f.key] = String(v);
        else errors[f.key] = `${f.label} must be a date`;
        break;
      default: {
        const s = String(v).trim().slice(0, 2000);
        if (s) values[f.key] = s;
        else if (f.required) errors[f.key] = `${f.label} is required`;
      }
    }
  }
  return { values, errors };
}

/** Returns the fields whose alert rule is triggered by these values. */
export function evaluateAlerts(defs, values) {
  const out = [];
  if (!values) return out;
  for (const f of defs) {
    const a = f.alert;
    const v = values[f.key];
    if (!a || isBlank(v)) continue;
    let hit = false;
    if (a.below != null && typeof v === 'number' && v < a.below) hit = true;
    if (a.atMost != null && typeof v === 'number' && v <= a.atMost) hit = true;
    if (a.above != null && typeof v === 'number' && v > a.above) hit = true;
    if ('equals' in a && v === a.equals) hit = true;
    if (a.any && Array.isArray(v) && v.length > 0) hit = true;
    if (hit) out.push({ key: f.key, label: f.label, value: v, text: `${f.label}: ${formatValue(f, v)}` });
  }
  return out;
}

export function formatValue(f, v) {
  if (isBlank(v)) return '—';
  if (f.type === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  return f.unit ? `${v} ${f.unit}` : String(v);
}
