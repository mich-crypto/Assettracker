// Admin → Billing: invoice list and actions, billing settings, per-project billing.
import { api, esc, toast } from './app.js';
import { fmtMoney, invoiceNumber, isOverdue, isoDate, lineTotal, monthKey, parseMoney, totals, validLines, duePeriods } from './billing.js';

const $ = (id) => document.getElementById(id);
const money = (c) => (c / 100).toFixed(2);

export function initBilling({ getProjects, reloadProjects }) {
  let settings = null, invoices = [], editing = null, current = null;
  const today = () => isoDate(new Date());

  // ------------------------------------------------------------ settings
  const S = { name: 'seller_name', vat: 'seller_vat_id', address: 'seller_address', coc: 'seller_coc', iban: 'seller_iban', bic: 'seller_bic',
    currency: 'currency', vatpct: 'vat_percent', days: 'payment_days', prefix: 'number_prefix', footer: 'footer_note', auto: 'auto_mode', from: 'email_from', site: 'site_url' };

  async function loadSettings() {
    const r = await api('/api/billing/settings');
    settings = r.settings;
    for (const [id, key] of Object.entries(S)) $(`bs-${id}`).value = settings[key] ?? '';
    $('bs-startup').value = money(Number(settings.default_startup_cents) || 0);
    $('bs-monthly').value = money(Number(settings.default_monthly_cents) || 0);
    if (!settings.site_url) $('bs-site').placeholder = location.origin;
    $('bs-mail-state').textContent = r.email_ready
      ? 'E-mail is ready: invoices are sent through Resend.'
      : 'E-mail is not set up yet. Add the RESEND_API_KEY secret to the Worker and a sender address here. Until then, copy the invoice link and send it yourself.';
    $('bl-settings-hint').textContent = r.seller_ready ? '' : '· fill in your company details before issuing invoices';
    if (!r.seller_ready) $('bl-settings-box').open = true;
    prefixExample();
  }
  const prefixExample = () => { $('bs-prefix-ex').textContent = invoiceNumber($('bs-prefix').value.trim(), new Date().getUTCFullYear(), 1); };
  $('bs-prefix').oninput = prefixExample;

  $('bl-settings').onsubmit = async (e) => {
    e.preventDefault();
    $('bs-error').textContent = '';
    const body = {};
    for (const [id, key] of Object.entries(S)) body[key] = $(`bs-${id}`).value;
    body.currency = body.currency.toUpperCase();
    const st = parseMoney($('bs-startup').value || '0'), mo = parseMoney($('bs-monthly').value || '0');
    if (st === null || mo === null) { $('bs-error').textContent = 'Enter the default fees as amounts, for example 1250.00'; return; }
    body.default_startup_cents = String(st); body.default_monthly_cents = String(mo);
    try { await api('/api/billing/settings', { method: 'PUT', body }); await loadSettings(); toast('Billing settings saved', 'ok'); }
    catch (err) { $('bs-error').textContent = err.message; }
  };

  // ------------------------------------------------------------ invoice list
  async function loadInvoices() {
    ({ invoices } = await api('/api/billing/invoices'));
    renderTiles(); renderRows();
  }

  const statusOf = (i) => (isOverdue(i, today()) ? 'overdue' : i.status);
  const BADGE = { draft: ['draft', ''], issued: ['issued', 'badge-warn'], sent: ['sent', 'badge-warn'], overdue: ['overdue', 'badge-danger'], paid: ['paid', 'badge-ok'], void: ['void', ''] };

  function renderTiles() {
    const open = invoices.filter((i) => i.status === 'issued' || i.status === 'sent');
    const sum = (list) => list.reduce((s, i) => s + i.total_cents, 0);
    const cur = settings?.currency || 'EUR';
    const overdue = open.filter((i) => isOverdue(i, today()));
    const drafts = invoices.filter((i) => i.status === 'draft');
    const monthly = getProjects().filter((p) => p.billing_enabled && p.status === 'active').reduce((s, p) => s + (p.billing_monthly_cents || 0), 0);
    const year = String(new Date().getUTCFullYear());
    const paidYear = invoices.filter((i) => i.status === 'paid' && (i.paid_at || '').startsWith(year));
    const tile = (label, value, sub) => `<div class="tile"><span>${label}</span><b>${value}</b><span>${sub}</span></div>`;
    $('bl-tiles').innerHTML =
      tile('Monthly recurring', fmtMoney(monthly, cur), 'excl. VAT, active projects') +
      tile('Outstanding', fmtMoney(sum(open), cur), `${open.length} unpaid invoice${open.length === 1 ? '' : 's'}`) +
      tile('Overdue', fmtMoney(sum(overdue), cur), `${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`) +
      tile('Drafts to check', String(drafts.length), drafts.length ? 'issue or send them' : 'nothing waiting') +
      tile(`Paid in ${year}`, fmtMoney(sum(paidYear), cur), `${paidYear.length} invoice${paidYear.length === 1 ? '' : 's'}`);
  }

  function filtered() {
    const f = $('bl-filter').value;
    return invoices.filter((i) => {
      const st = statusOf(i);
      if (f === 'todo') return st === 'draft' || st === 'overdue' || (i.status === 'issued');
      if (f === 'open') return i.status === 'issued' || i.status === 'sent';
      return !f || st === f;
    });
  }

  function actions(i) {
    const st = statusOf(i);
    const b = (act, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="${act}" data-id="${esc(i.id)}">${label}</button>`;
    const view = `<a class="btn" href="/invoice/${esc(i.token)}" target="_blank" rel="noopener">View</a>`;
    if (i.status === 'draft') return view + b('edit', 'Edit') + b('issue', 'Issue', 'btn-primary') + b('delete', 'Delete');
    if (i.status === 'issued' || i.status === 'sent') {
      return view + b('send', i.status === 'sent' ? 'Resend' : 'Send', st === 'overdue' ? '' : 'btn-primary') +
        b('copy', 'Copy link') + (st === 'overdue' ? b('remind', 'Reminder', 'btn-primary') : '') + b('paid', 'Mark paid') + b('void', 'Void');
    }
    return view + b('copy', 'Copy link');
  }

  function renderRows() {
    const list = filtered();
    $('bl-rows').innerHTML = list.map((i) => {
      const st = statusOf(i), [label, cls] = BADGE[st] || [st, ''];
      return `<tr>
        <td><b>${esc(i.number || 'Draft')}</b><div class="muted">${esc(i.period || 'manual')}${i.auto ? ' · automatic' : ''}</div></td>
        <td>${esc(i.project_name)}<div class="muted mono">/${esc(i.project_slug)}</div></td>
        <td>${esc(i.issue_date || '')}</td><td>${esc(i.due_date || '')}</td>
        <td class="num">${esc(fmtMoney(i.total_cents, i.currency))}</td>
        <td><span class="badge ${cls}">${label}</span>${i.send_error ? `<div class="muted" style="color:var(--danger)">${esc(i.send_error)}</div>` : ''}${i.sent_at ? `<div class="muted">to ${esc(i.sent_to)}</div>` : ''}${i.paid_at ? `<div class="muted">${esc(i.paid_at)}</div>` : ''}</td>
        <td><div class="row" style="gap:6px;justify-content:flex-end">${actions(i)}</div></td></tr>`;
    }).join('');
    $('bl-empty').textContent = list.length ? '' : invoices.length ? 'No invoices match this filter.' : 'No invoices yet. Switch billing on for a project (open the project below), then press "Create due invoices now".';
    $('bl-rows').querySelectorAll('button[data-act]').forEach((b) => (b.onclick = () => onAction(b.dataset.act, invoices.find((i) => i.id === b.dataset.id))));
  }
  $('bl-filter').onchange = renderRows;

  async function onAction(act, inv) {
    if (!inv) return;
    const link = `${settings?.site_url || location.origin}/invoice/${inv.token}`;
    try {
      if (act === 'edit') return openEditor(inv);
      if (act === 'copy') { await navigator.clipboard?.writeText(link); return toast('Invoice link copied', 'ok'); }
      if (act === 'issue') {
        if (!confirm(`Issue this invoice for ${inv.project_name} (${fmtMoney(inv.total_cents, inv.currency)})? It gets its number now and can no longer be edited.`)) return;
        await api(`/api/billing/invoices/${inv.id}/issue`, { method: 'POST' }); toast('Invoice issued', 'ok');
      } else if (act === 'send' || act === 'remind') {
        if (!settings.email_ready) { return mailFallback(inv, link, act === 'remind'); }
        await api(`/api/billing/invoices/${inv.id}/send`, { method: 'POST', body: { reminder: act === 'remind' } }); toast(`Sent to ${inv.customer.email}`, 'ok');
      } else if (act === 'paid') {
        const date = prompt('Date received (YYYY-MM-DD)', today());
        if (!date) return;
        await api(`/api/billing/invoices/${inv.id}/paid`, { method: 'POST', body: { date } }); toast('Marked as paid', 'ok');
      } else if (act === 'void') {
        if (!confirm(`Void invoice ${inv.number}? The number stays used; a new invoice can be created for the same month.`)) return;
        await api(`/api/billing/invoices/${inv.id}/void`, { method: 'POST' }); toast('Invoice voided', 'ok');
      } else if (act === 'delete') {
        if (!confirm('Delete this draft?')) return;
        await api(`/api/billing/invoices/${inv.id}`, { method: 'DELETE' }); toast('Draft deleted', 'ok');
      }
    } catch (err) { toast(err.message, 'error'); }
    await loadInvoices();
  }

  function mailFallback(inv, link, reminder) {
    const subject = `${reminder ? 'Reminder: invoice' : 'Invoice'} ${inv.number}`;
    const body = `Hello,\n\n${reminder ? `Invoice ${inv.number} (${fmtMoney(inv.total_cents, inv.currency)}) is still open.` : `Please find invoice ${inv.number} for ${inv.customer.project}.`}\n\nView and download it here: ${link}\n\nKind regards,\n${inv.seller?.name || settings.seller_name}`;
    location.href = `mailto:${encodeURIComponent(inv.customer.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast('Opening your e-mail program. Automatic sending needs the RESEND_API_KEY secret.', 'info');
  }

  $('bl-run').onclick = async () => {
    try {
      const r = await api('/api/billing/run', { method: 'POST' });
      toast(r.created ? `${r.created} invoice${r.created === 1 ? '' : 's'} created${r.issued ? `, ${r.issued} issued` : ''}${r.sent ? `, ${r.sent} sent` : ''}` : 'Nothing is due right now', r.created ? 'ok' : 'info');
      if (r.problems.length) toast(r.problems[0], 'error');
      await loadInvoices();
    } catch (err) { toast(err.message, 'error'); }
  };

  $('bl-csv').onclick = (e) => {
    e.preventDefault();
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['number', 'status', 'project', 'period', 'issue_date', 'due_date', 'paid_at', 'subtotal', 'vat', 'total', 'currency', 'customer']]
      .concat(filtered().map((i) => [i.number || '', statusOf(i), i.project_slug, i.period || '', i.issue_date || '', i.due_date || '', i.paid_at || '',
        money(i.subtotal_cents), money(i.vat_cents), money(i.total_cents), i.currency, i.customer.name]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `invoices-${today()}.csv`; a.click();
  };

  // ------------------------------------------------------------ draft editor (also for manual invoices)
  function lineRow(l = { description: '', qty: 1, unit_cents: 0 }) {
    const div = document.createElement('div');
    div.className = 'grid-2'; div.style.gridTemplateColumns = '1fr 70px 110px auto';
    div.innerHTML = `<input type="text" class="l-desc" maxlength="200" placeholder="Description" aria-label="Description" value="${esc(l.description)}">
      <input type="text" class="l-qty" inputmode="decimal" aria-label="Quantity" value="${esc(l.qty)}">
      <input type="text" class="l-price" inputmode="decimal" aria-label="Unit price" value="${money(l.unit_cents)}">
      <button type="button" class="btn" aria-label="Remove line">✕</button>`;
    div.querySelector('button').onclick = () => { div.remove(); sum(); };
    div.querySelectorAll('input').forEach((i) => (i.oninput = sum));
    return div;
  }
  function readLines() {
    return [...$('inv-lines').children].map((r) => ({
      description: r.querySelector('.l-desc').value.trim(),
      qty: Number(r.querySelector('.l-qty').value.replace(',', '.')),
      unit_cents: parseMoney(r.querySelector('.l-price').value),
    }));
  }
  function sum() {
    const lines = readLines().map((l) => ({ ...l, unit_cents: l.unit_cents ?? 0, qty: l.qty || 0 }));
    const pid = editing?.project_id || $('inv-project').value;
    const p = getProjects().find((x) => x.id === pid);
    const t = totals(lines, settings.vat_percent, p?.billing_vat_mode || 'standard');
    $('inv-sum').textContent = `Subtotal ${fmtMoney(t.subtotal_cents, settings.currency)} · VAT ${fmtMoney(t.vat_cents, settings.currency)} · Total ${fmtMoney(t.total_cents, settings.currency)}`;
  }
  function openEditor(inv = null, projectId = null) {
    editing = inv;
    $('inv-title').textContent = inv ? `Edit draft, ${inv.project_name}` : 'Manual invoice';
    $('inv-project-row').classList.toggle('hidden', !!inv);
    $('inv-project').innerHTML = getProjects().map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (/${esc(p.slug)})</option>`).join('');
    if (projectId) $('inv-project').value = projectId;
    $('inv-project').onchange = sum;
    $('inv-lines').replaceChildren(...(inv ? inv.lines : [{ description: '', qty: 1, unit_cents: 0 }]).map(lineRow));
    $('inv-ref').value = inv?.reference || ''; $('inv-notes').value = inv?.notes || '';
    $('inv-error').textContent = ''; sum();
    $('inv-dialog').showModal();
  }
  $('bl-new').onclick = () => { if (!getProjects().length) return toast('Create a project first', 'error'); openEditor(null, current?.id); };
  $('inv-addline').onclick = () => { $('inv-lines').append(lineRow({ description: '', qty: 1, unit_cents: 0 })); };
  $('inv-cancel').onclick = () => $('inv-dialog').close();
  $('inv-form').onsubmit = async (e) => {
    e.preventDefault();
    const lines = readLines();
    if (lines.some((l) => l.unit_cents === null)) { $('inv-error').textContent = 'Enter prices as amounts, for example 1250.00'; return; }
    const bad = validLines(lines);
    if (bad) { $('inv-error').textContent = bad; return; }
    const body = { lines, reference: $('inv-ref').value, notes: $('inv-notes').value };
    try {
      if (editing) await api(`/api/billing/invoices/${editing.id}`, { method: 'PATCH', body });
      else await api('/api/billing/invoices', { method: 'POST', body: { ...body, project_id: $('inv-project').value } });
      $('inv-dialog').close(); toast('Draft saved', 'ok'); await loadInvoices();
    } catch (err) { $('inv-error').textContent = err.message; }
  };

  // ------------------------------------------------------------ per project
  const PB = { start: 'billing_start', end: 'billing_end', company: 'billing_company', vatid: 'billing_vat_id', address: 'billing_address', vatmode: 'billing_vat_mode', email: 'billing_email', ref: 'billing_reference' };

  function pbHint() {
    if (!current) return;
    const mo = parseMoney($('pb-monthly').value || '0'), st = parseMoney($('pb-startup').value || '0');
    const start = $('pb-start').value;
    if (!$('pb-enabled').checked) { $('pb-hint').textContent = 'Billing is off for this project.'; return; }
    if (!start) { $('pb-hint').textContent = 'Choose the first billed month.'; return; }
    if (mo === null || st === null) { $('pb-hint').textContent = 'Enter fees as amounts, for example 1250.00'; return; }
    const due = duePeriods({ start, end: $('pb-end').value || null, today: today(), existing: [] });
    $('pb-hint').textContent = start > today()
      ? `The first invoice (${fmtMoney(st + mo, settings?.currency)} excl. VAT, startup fee and first month) is created on ${monthKey(start)}-01.`
      : `${due.length} invoice${due.length === 1 ? ' is' : 's are'} due now (up to ${12} months back are created). Each month after that is created on the 1st.`;
  }

  function showProject(p) {
    current = p;
    const on = !!p.billing_enabled;
    $('pb-enabled').checked = on;
    for (const [id, key] of Object.entries(PB)) $(`pb-${id}`).value = p[key] || (id === 'vatmode' ? 'standard' : '');
    $('pb-startup').value = money(on || p.billing_startup_cents ? p.billing_startup_cents : Number(settings?.default_startup_cents) || 0);
    $('pb-monthly').value = money(on || p.billing_monthly_cents ? p.billing_monthly_cents : Number(settings?.default_monthly_cents) || 0);
    if (!p.billing_start) $('pb-start').value = '';
    $('pb-company').placeholder = p.client || p.name; $('pb-error').textContent = '';
    pbHint();
  }
  ['pb-enabled', 'pb-start', 'pb-end', 'pb-startup', 'pb-monthly'].forEach((id) => ($(id).oninput = pbHint));

  $('pp-billing').onsubmit = async (e) => {
    e.preventDefault();
    $('pb-error').textContent = '';
    const st = parseMoney($('pb-startup').value || '0'), mo = parseMoney($('pb-monthly').value || '0');
    if (st === null || mo === null) { $('pb-error').textContent = 'Enter fees as amounts, for example 1250.00'; return; }
    if ($('pb-enabled').checked && !$('pb-start').value) { $('pb-error').textContent = 'Choose the first billed month'; return; }
    const body = { billing_enabled: $('pb-enabled').checked, billing_startup_cents: st, billing_monthly_cents: mo };
    for (const [id, key] of Object.entries(PB)) body[key] = $(`pb-${id}`).value;
    try {
      await api(`/api/projects/${current.id}`, { method: 'PATCH', body });
      toast('Billing saved', 'ok');
      const id = current.id; await reloadProjects(); current = getProjects().find((p) => p.id === id); showProject(current); renderTiles();
    } catch (err) { $('pb-error').textContent = err.message; }
  };
  $('pb-invoices').onclick = () => { $('bl-filter').value = ''; document.getElementById('billing-card').scrollIntoView({ behavior: 'smooth' }); };

  loadSettings().then(loadInvoices).catch((e) => toast(e.message, 'error'));
  return { showProject };
}
