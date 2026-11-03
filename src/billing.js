// Billing: settings, invoices (draft -> issued -> sent -> paid, or void), automatic monthly
// creation (called by the daily cron), and e-mail through Resend when RESEND_API_KEY is set.
import { HttpError, json, parseJsonColumn, readJson, str, num } from './http.js';
import {
  VAT_MODES, buildLines, addDays, duePeriods, invoiceNumber, isoDate, totals, validLines, fmtMoney, monthLabel,
} from '../public/js/billing.js';

const DEFAULTS = {
  seller_name: '', seller_address: '', seller_vat_id: '', seller_coc: '', seller_iban: '', seller_bic: '',
  email_from: '', site_url: '', currency: 'EUR', vat_percent: '21', payment_days: '30',
  number_prefix: '', auto_mode: 'draft', footer_note: '', default_startup_cents: '0', default_monthly_cents: '0',
};
const AUTO_MODES = ['draft', 'issue', 'send'];

export async function loadSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM billing_settings').all();
  const s = { ...DEFAULTS };
  for (const r of results) if (r.key in DEFAULTS) s[r.key] = r.value ?? '';
  return s;
}

const sellerReady = (s) => !!(s.seller_name && s.seller_address);
const newToken = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');

function settingsFromBody(b) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (b[k] === undefined) continue;
    out[k] = String(b[k] ?? '').trim();
  }
  const lim = (k, max) => { if (out[k] !== undefined && out[k].length > max) throw new HttpError(400, `${k} is too long`); };
  ['seller_name', 'seller_vat_id', 'seller_coc', 'seller_iban', 'seller_bic', 'number_prefix', 'currency'].forEach((k) => lim(k, 80));
  ['seller_address', 'footer_note'].forEach((k) => lim(k, 600));
  if (out.currency !== undefined && !/^[A-Z]{3}$/.test(out.currency)) throw new HttpError(400, 'Currency must be a 3-letter code such as EUR');
  if (out.email_from !== undefined && out.email_from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$|^[^<]+<[^@\s]+@[^@\s]+\.[^>\s]+>$/.test(out.email_from)) throw new HttpError(400, 'Enter a valid sender e-mail address');
  if (out.site_url !== undefined && out.site_url && !/^https?:\/\/[^\s/]+/.test(out.site_url)) throw new HttpError(400, 'Site address must start with https://');
  if (out.site_url) out.site_url = out.site_url.replace(/\/+$/, '');
  if (out.vat_percent !== undefined) { const n = Number(out.vat_percent); if (!(n >= 0 && n <= 50)) throw new HttpError(400, 'VAT must be between 0 and 50 %'); }
  if (out.payment_days !== undefined) { const n = Number(out.payment_days); if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError(400, 'Payment term must be 0 to 365 days'); }
  if (out.auto_mode !== undefined && !AUTO_MODES.includes(out.auto_mode)) throw new HttpError(400, 'Invalid automatic mode');
  for (const k of ['default_startup_cents', 'default_monthly_cents']) {
    if (out[k] !== undefined && !/^\d{1,10}$/.test(out[k])) throw new HttpError(400, 'Fees must be whole cents');
  }
  return out;
}

function invoiceOut(r, { withSeller = true } = {}) {
  return {
    ...r,
    customer: parseJsonColumn(r.customer, {}),
    seller: withSeller ? parseJsonColumn(r.seller, {}) : undefined,
    lines: parseJsonColumn(r.lines, []),
  };
}

function customerOf(p) {
  return {
    name: p.billing_company || p.client || p.name,
    address: p.billing_address || '',
    vat_id: p.billing_vat_id || '',
    email: p.billing_email || p.contact_email || '',
    project: p.name,
    slug: p.slug,
  };
}

async function projectOf(env, id) {
  const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Project not found');
  return p;
}

async function insertDraft(env, s, project, { period, lines, reference, notes, auto }) {
  const t = totals(lines, s.vat_percent, project.billing_vat_mode);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invoices (id, project_id, period, status, currency, customer, lines, subtotal_cents, vat_percent, vat_cents,
       total_cents, vat_note, reference, notes, token, auto)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, project.id, period, s.currency, JSON.stringify(customerOf(project)), JSON.stringify(lines), t.subtotal_cents, t.vat_percent,
    t.vat_cents, t.total_cents, t.vat_note, reference ?? project.billing_reference ?? null, notes ?? null, newToken(), auto ? 1 : 0).run();
  return id;
}

async function getInvoice(env, id) {
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return inv;
}

/** Assigns the next number, fixes the customer and seller details, and sets the dates. */
export async function issueInvoice(env, id, now = new Date()) {
  const inv = await getInvoice(env, id);
  if (inv.status !== 'draft') throw new HttpError(409, 'Only a draft can be issued');
  const s = await loadSettings(env);
  if (!sellerReady(s)) throw new HttpError(400, 'Fill in your company name and address under Billing settings first');
  const project = await projectOf(env, inv.project_id);
  const lines = parseJsonColumn(inv.lines, []);
  const bad = validLines(lines);
  if (bad) throw new HttpError(400, bad);
  const t = totals(lines, s.vat_percent, project.billing_vat_mode);
  const issueDate = isoDate(now);
  const year = Number(issueDate.slice(0, 4));
  await env.DB.prepare('INSERT OR IGNORE INTO invoice_counters (year, n) VALUES (?, 0)').bind(year).run();
  const row = await env.DB.prepare('UPDATE invoice_counters SET n = n + 1 WHERE year = ? RETURNING n').bind(year).first();
  const seller = {
    name: s.seller_name, address: s.seller_address, vat_id: s.seller_vat_id, coc: s.seller_coc,
    iban: s.seller_iban, bic: s.seller_bic, footer: s.footer_note,
  };
  await env.DB.prepare(
    `UPDATE invoices SET status = 'issued', number = ?, issue_date = ?, due_date = ?, customer = ?, seller = ?, currency = ?,
       subtotal_cents = ?, vat_percent = ?, vat_cents = ?, total_cents = ?, vat_note = ? WHERE id = ? AND status = 'draft'`,
  ).bind(invoiceNumber(s.number_prefix, year, row.n), issueDate, addDays(issueDate, Number(s.payment_days)), JSON.stringify(customerOf(project)),
    JSON.stringify(seller), s.currency, t.subtotal_cents, t.vat_percent, t.vat_cents, t.total_cents, t.vat_note, id).run();
  return getInvoice(env, id);
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function emailReady(env, s) {
  return !!(env.RESEND_API_KEY && s.email_from);
}

/** Sends the invoice link by e-mail (Resend). Records the result on the invoice. */
export async function sendInvoice(env, id, { reminder = false, origin = '', fetchFn = fetch } = {}) {
  const inv = invoiceOut(await getInvoice(env, id));
  if (!['issued', 'sent'].includes(inv.status)) throw new HttpError(409, 'Issue the invoice before sending it');
  const s = await loadSettings(env);
  const fail = async (message) => {
    await env.DB.prepare('UPDATE invoices SET send_error = ? WHERE id = ?').bind(message, id).run();
    throw new HttpError(502, message);
  };
  if (!emailReady(env, s)) return fail('E-mail is not set up yet (needs the RESEND_API_KEY secret and a sender address)');
  if (!inv.customer.email) return fail('This project has no billing e-mail address');
  const base = s.site_url || origin;
  if (!base) return fail('Set the site address under Billing settings first');
  const link = `${base}/invoice/${inv.token}`;
  const amount = fmtMoney(inv.total_cents, inv.currency);
  const subject = `${reminder ? 'Reminder: invoice' : 'Invoice'} ${inv.number} from ${inv.seller.name}`;
  const intro = reminder
    ? `Our records show that invoice ${esc(inv.number)} (${esc(amount)}, due ${esc(inv.due_date)}) has not been paid yet. If you have paid it already, please ignore this message.`
    : `Please find invoice ${esc(inv.number)} for ${esc(inv.customer.project)}: ${esc(amount)}, due ${esc(inv.due_date)}.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b2733">
<p>Hello,</p><p>${intro}</p>
<p><a href="${esc(link)}" style="background:#0b5cad;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">View invoice</a></p>
<p>The page can be printed or saved as PDF. ${inv.seller.iban ? `Payment to IBAN ${esc(inv.seller.iban)}, reference ${esc(inv.number)}.` : ''}</p>
<p>${esc(inv.seller.name)}</p></div>`;
  let res;
  try {
    res = await fetchFn(env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: s.email_from, to: [inv.customer.email], subject, html }),
    });
  } catch { return fail('Could not reach the e-mail service'); }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
    return fail(`The e-mail service refused the message (${res.status}) ${detail}`.trim());
  }
  await env.DB.prepare(`UPDATE invoices SET status = 'sent', sent_at = ?, sent_to = ?, send_error = NULL WHERE id = ?`)
    .bind(new Date().toISOString(), inv.customer.email, id).run();
  return invoiceOut(await getInvoice(env, id));
}

/** Creates the invoices that are due. Idempotent: safe to run every day. */
export async function runBilling(env, { now = new Date(), origin = '' } = {}) {
  const s = await loadSettings(env);
  const today = isoDate(now);
  const { results: projects } = await env.DB.prepare(
    `SELECT * FROM projects WHERE billing_enabled = 1 AND status = 'active' AND billing_start IS NOT NULL AND billing_start <= ?`,
  ).bind(today).all();
  const created = [];
  for (const p of projects) {
    if (!(p.billing_monthly_cents > 0 || p.billing_startup_cents > 0)) continue;
    const { results } = await env.DB.prepare(`SELECT period FROM invoices WHERE project_id = ? AND period IS NOT NULL AND status <> 'void'`).bind(p.id).all();
    for (const period of duePeriods({ start: p.billing_start, end: p.billing_end, today, existing: results.map((r) => r.period) })) {
      const lines = buildLines({ project: p, period });
      if (!lines.length) continue;
      try { created.push({ id: await insertDraft(env, s, p, { period, lines, auto: true }), slug: p.slug, period }); }
      catch (err) { if (!String(err?.message).includes('UNIQUE')) throw err; }
    }
  }
  const outcome = { created: created.length, issued: 0, sent: 0, problems: [] };
  if (s.auto_mode !== 'draft' && sellerReady(s)) {
    for (const c of created) {
      try {
        await issueInvoice(env, c.id, now); outcome.issued++;
        if (s.auto_mode === 'send') { await sendInvoice(env, c.id, { origin }); outcome.sent++; }
      } catch (err) { outcome.problems.push(`${c.slug} ${c.period}: ${err.message}`); }
    }
  } else if (s.auto_mode !== 'draft' && created.length) {
    outcome.problems.push('Invoices were left as drafts: fill in your company details under Billing settings');
  }
  return outcome;
}

export function registerBilling(router, guard) {
  const admin = (handler) => async (ctx) => { guard(ctx.user, 'admin'); return handler(ctx); };

  router.add('GET', '/api/billing/settings', admin(async ({ env }) => {
    const s = await loadSettings(env);
    return json({ settings: s, email_ready: emailReady(env, s), seller_ready: sellerReady(s) });
  }));

  router.add('PUT', '/api/billing/settings', admin(async ({ request, env }) => {
    const v = settingsFromBody(await readJson(request));
    const stmts = Object.entries(v).map(([k, val]) =>
      env.DB.prepare('INSERT INTO billing_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, val));
    if (stmts.length) await env.DB.batch(stmts);
    const s = await loadSettings(env);
    return json({ settings: s, email_ready: emailReady(env, s), seller_ready: sellerReady(s) });
  }));

  router.add('GET', '/api/billing/invoices', admin(async ({ env, url }) => {
    const where = [], vals = [];
    if (url.searchParams.get('project')) { where.push('i.project_id = ?'); vals.push(url.searchParams.get('project')); }
    if (url.searchParams.get('status')) { where.push('i.status = ?'); vals.push(url.searchParams.get('status')); }
    const { results } = await env.DB.prepare(
      `SELECT i.*, p.slug AS project_slug, p.name AS project_name FROM invoices i JOIN projects p ON p.id = i.project_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.created_at DESC, i.number DESC LIMIT 1000`,
    ).bind(...vals).all();
    return json({ invoices: results.map((r) => invoiceOut(r, { withSeller: false })) });
  }));

  // Create the invoices that are due now (the daily cron does the same).
  router.add('POST', '/api/billing/run', admin(async ({ env, url }) => json(await runBilling(env, { origin: url.origin }))));

  // A manual invoice (extra work, a one-off fee) as a draft.
  router.add('POST', '/api/billing/invoices', admin(async ({ request, env }) => {
    const b = await readJson(request);
    const project = await projectOf(env, b.project_id);
    const lines = normaliseLines(b.lines);
    const s = await loadSettings(env);
    const id = await insertDraft(env, s, project, { period: null, lines, reference: str(b.reference, { max: 80 }), notes: str(b.notes, { max: 600 }) });
    return json({ invoice: invoiceOut(await getInvoice(env, id)) }, 201);
  }));

  router.add('GET', '/api/billing/invoices/:id', admin(async ({ env, params }) => json({ invoice: invoiceOut(await getInvoice(env, params.id)) })));

  router.add('PATCH', '/api/billing/invoices/:id', admin(async ({ request, env, params }) => {
    const inv = await getInvoice(env, params.id);
    if (inv.status !== 'draft') throw new HttpError(409, 'Only a draft can be edited. Void the invoice and create a new one instead.');
    const b = await readJson(request);
    const project = await projectOf(env, inv.project_id);
    const s = await loadSettings(env);
    const lines = b.lines !== undefined ? normaliseLines(b.lines) : parseJsonColumn(inv.lines, []);
    const t = totals(lines, s.vat_percent, project.billing_vat_mode);
    await env.DB.prepare(
      `UPDATE invoices SET lines = ?, subtotal_cents = ?, vat_percent = ?, vat_cents = ?, total_cents = ?, vat_note = ?, reference = ?, notes = ?, customer = ? WHERE id = ?`,
    ).bind(JSON.stringify(lines), t.subtotal_cents, t.vat_percent, t.vat_cents, t.total_cents, t.vat_note,
      b.reference !== undefined ? str(b.reference, { max: 80 }) : inv.reference,
      b.notes !== undefined ? str(b.notes, { max: 600 }) : inv.notes, JSON.stringify(customerOf(project)), params.id).run();
    return json({ invoice: invoiceOut(await getInvoice(env, params.id)) });
  }));

  router.add('POST', '/api/billing/invoices/:id/issue', admin(async ({ env, params }) => json({ invoice: invoiceOut(await issueInvoice(env, params.id)) })));

  router.add('POST', '/api/billing/invoices/:id/send', admin(async ({ request, env, params, url }) => {
    let body = {}; try { body = await request.json(); } catch { /* no body */ }
    return json({ invoice: await sendInvoice(env, params.id, { reminder: !!body.reminder, origin: url.origin }) });
  }));

  router.add('POST', '/api/billing/invoices/:id/paid', admin(async ({ request, env, params }) => {
    const inv = await getInvoice(env, params.id);
    if (!['issued', 'sent'].includes(inv.status)) throw new HttpError(409, 'Only an issued invoice can be marked as paid');
    let body = {}; try { body = await request.json(); } catch { /* no body */ }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : isoDate(new Date());
    await env.DB.prepare(`UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?`).bind(date, params.id).run();
    return json({ invoice: invoiceOut(await getInvoice(env, params.id)) });
  }));

  router.add('POST', '/api/billing/invoices/:id/void', admin(async ({ env, params }) => {
    const inv = await getInvoice(env, params.id);
    if (!['issued', 'sent'].includes(inv.status)) throw new HttpError(409, 'Only an issued, unpaid invoice can be voided');
    await env.DB.prepare(`UPDATE invoices SET status = 'void', voided_at = ? WHERE id = ?`).bind(new Date().toISOString(), params.id).run();
    return json({ invoice: invoiceOut(await getInvoice(env, params.id)) });
  }));

  router.add('DELETE', '/api/billing/invoices/:id', admin(async ({ env, params }) => {
    const inv = await getInvoice(env, params.id);
    if (inv.status !== 'draft') throw new HttpError(409, 'Only a draft can be deleted (numbered invoices are void, never deleted)');
    await env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(params.id).run();
    return json({ ok: true });
  }));

  // The customer's page: anyone with the unguessable link can read this one invoice.
  router.add('GET', '/api/invoice/:token', async ({ env, params }) => {
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE token = ?').bind(params.token).first();
    if (!inv) throw new HttpError(404, 'Invoice not found');
    const o = invoiceOut(inv);
    delete o.token; delete o.project_id; delete o.send_error;
    return json({ invoice: o });
  });
}

function normaliseLines(lines) {
  const out = (Array.isArray(lines) ? lines : []).map((l) => ({
    description: String(l.description ?? '').trim().slice(0, 200),
    qty: Number(l.qty),
    unit_cents: Number(l.unit_cents),
  }));
  const bad = validLines(out);
  if (bad) throw new HttpError(400, bad);
  return out;
}

export { VAT_MODES, num, monthLabel };
