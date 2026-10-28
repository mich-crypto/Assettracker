// Renders form inputs from an asset type's field definitions, so new
// equipment types or extra data points need no front-end changes.
import { esc } from './app.js';

export function renderFields(container, defs, scope, values = {}) {
  const fields = defs.filter((f) => f.scope === scope);
  container.innerHTML = fields.map((f) => fieldHtml(f, values[f.key])).join('') ||
    '<p class="muted">No extra fields for this type.</p>';
  // Range + number pairs stay in step (big slider for gloves, exact box for precision).
  container.querySelectorAll('[data-range-for]').forEach((range) => {
    const box = container.querySelector(`[name="${range.dataset.rangeFor}"]`);
    range.oninput = () => { box.value = range.value; };
    box.addEventListener('input', () => { range.value = box.value; });
  });
}

function fieldHtml(f, value) {
  const id = `f_${f.scope}_${f.key}`;
  const req = f.required ? ' required' : '';
  const label = `${esc(f.label)}${f.unit ? ` <span class="muted">(${esc(f.unit)})</span>` : ''}${f.required ? ' <span class="req">*</span>' : ''}`;
  let input;
  switch (f.type) {
    case 'number': {
      const attrs = `${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}`;
      const slider = f.min != null && f.max != null && f.max - f.min <= 1000
        ? `<input type="range" data-range-for="${f.key}" step="1"${attrs} value="${esc(value ?? f.min)}">` : '';
      input = `<div class="num-row">${slider}<input id="${id}" name="${f.key}" type="number" inputmode="decimal" step="any"${attrs}${req} value="${esc(value ?? '')}"></div>`;
      break;
    }
    case 'boolean':
      input = `<div class="segmented" role="radiogroup" aria-labelledby="${id}_l">
        <label><input type="radio" name="${f.key}" value="true"${value === true ? ' checked' : ''}${req}><span>Yes</span></label>
        <label><input type="radio" name="${f.key}" value="false"${value === false ? ' checked' : ''}><span>No</span></label>
      </div>`;
      return `<fieldset class="field"><legend id="${id}_l">${label}</legend>${input}<div class="field-error" data-error-for="${f.key}"></div></fieldset>`;
    case 'select':
      input = `<select id="${id}" name="${f.key}"${req}><option value="">Select…</option>${f.options.map((o) =>
        `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      break;
    case 'multiselect':
      input = `<div class="chips">${f.options.map((o) =>
        `<label class="chip"><input type="checkbox" name="${f.key}" value="${esc(o)}"${(value || []).includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
      return `<fieldset class="field"><legend>${label}</legend>${input}<div class="field-error" data-error-for="${f.key}"></div></fieldset>`;
    case 'date':
      input = `<input id="${id}" name="${f.key}" type="date"${req} value="${esc(value ?? '')}">`;
      break;
    default:
      input = `<input id="${id}" name="${f.key}" type="text"${req} value="${esc(value ?? '')}">`;
  }
  return `<div class="field"><label for="${id}">${label}</label>${input}<div class="field-error" data-error-for="${f.key}"></div></div>`;
}

/** Reads raw values back; validation happens in fields.js normalizeValues. */
export function collectFields(container, defs, scope) {
  const out = {};
  for (const f of defs.filter((d) => d.scope === scope)) {
    if (f.type === 'multiselect') {
      out[f.key] = [...container.querySelectorAll(`[name="${f.key}"]:checked`)].map((i) => i.value);
    } else if (f.type === 'boolean') {
      const c = container.querySelector(`[name="${f.key}"]:checked`);
      out[f.key] = c ? c.value === 'true' : null;
    } else {
      const el = container.querySelector(`[name="${f.key}"]:not([type=range])`);
      out[f.key] = el ? el.value : null;
    }
  }
  return out;
}

export function showErrors(container, errors = {}) {
  container.querySelectorAll('[data-error-for]').forEach((el) => {
    el.textContent = errors[el.dataset.errorFor] || '';
  });
  const first = Object.keys(errors)[0];
  if (first) container.querySelector(`[name="${first}"]`)?.focus();
}
