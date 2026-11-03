// The customer's view of one invoice: /invoice/<token>. Print it or save it as PDF.
import { fmtMoney, lineTotal } from './billing.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = location.pathname.split('/').pop();
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

async function main() {
  const res = await fetch(`/api/invoice/${encodeURIComponent(token)}`);
  if (!res.ok) { document.getElementById('msg').textContent = 'This invoice link is not valid.'; return; }
  const { invoice: i } = await res.json();
  const c = i.customer || {}, s = i.seller || {};
  const money = (v) => esc(fmtMoney(v, i.currency));
  const stamp = i.status === 'draft' ? 'DRAFT' : i.status === 'paid' ? 'PAID' : i.status === 'void' ? 'VOID' : '';
  document.title = `Invoice ${i.number || '(draft)'}`;
  document.getElementById('sheet').innerHTML = `
    <div class="head">
      <div><h1>Invoice</h1><div class="muted">${esc(i.number || 'Draft, not numbered yet')}</div>${stamp ? `<div class="stamp ${stamp.toLowerCase()}">${stamp}</div>` : ''}</div>
      <div class="addr"><b>${esc(s.name || '')}</b>\n${esc(s.address || '')}${s.vat_id ? `\nVAT ${esc(s.vat_id)}` : ''}${s.coc ? `\nReg. no. ${esc(s.coc)}` : ''}</div>
    </div>
    <div class="meta">
      <div><b>Billed to</b><span class="addr">${esc(c.name || '')}\n${esc(c.address || '')}${c.vat_id ? `\nVAT ${esc(c.vat_id)}` : ''}</span></div>
      <div><b>Project</b>${esc(c.project || '')}</div>
      <div><b>Invoice date</b>${esc(fmtDate(i.issue_date) || '—')}</div>
      <div><b>Due date</b>${esc(fmtDate(i.due_date) || '—')}</div>
      ${i.reference ? `<div><b>Your reference</b>${esc(i.reference)}</div>` : ''}
    </div>
    <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>
      ${i.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${esc(l.qty)}</td><td class="r">${money(l.unit_cents)}</td><td class="r">${money(lineTotal(l))}</td></tr>`).join('')}
    </tbody></table>
    <div class="totals">
      <div><span>Subtotal</span><span>${money(i.subtotal_cents)}</span></div>
      <div><span>VAT ${i.vat_percent ? `${esc(i.vat_percent)} %` : ''}</span><span>${money(i.vat_cents)}</span></div>
      <div class="grand"><span>Total</span><span>${money(i.total_cents)}</span></div>
    </div>
    ${i.vat_note ? `<p class="muted">${esc(i.vat_note)}</p>` : ''}
    ${i.notes ? `<p>${esc(i.notes)}</p>` : ''}
    <div class="pay">
      ${s.iban ? `<div><b>Payment</b> to IBAN ${esc(s.iban)}${s.bic ? `, BIC ${esc(s.bic)}` : ''}, quoting <b>${esc(i.number || '')}</b>.</div>` : ''}
      ${s.footer ? `<div class="muted addr" style="margin-top:6px">${esc(s.footer)}</div>` : ''}
    </div>`;
  document.getElementById('msg').hidden = true;
  document.getElementById('sheet').hidden = false;
  document.getElementById('bar').hidden = false;
  document.getElementById('print').onclick = () => window.print();
}
main().catch(() => { document.getElementById('msg').textContent = 'The invoice could not be loaded.'; });
