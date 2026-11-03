-- Billing: what each project pays, invoices and their numbering.
ALTER TABLE projects ADD COLUMN billing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN billing_start TEXT;              -- first billed month (date)
ALTER TABLE projects ADD COLUMN billing_end TEXT;                -- last billed month (date), optional
ALTER TABLE projects ADD COLUMN billing_startup_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN billing_monthly_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN billing_company TEXT;
ALTER TABLE projects ADD COLUMN billing_address TEXT;
ALTER TABLE projects ADD COLUMN billing_vat_id TEXT;
ALTER TABLE projects ADD COLUMN billing_vat_mode TEXT NOT NULL DEFAULT 'standard'; -- standard | reverse | exempt
ALTER TABLE projects ADD COLUMN billing_email TEXT;
ALTER TABLE projects ADD COLUMN billing_reference TEXT;          -- customer PO / cost code

CREATE TABLE billing_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per year; numbers are 2026-0001, 2026-0002 ... assigned when an invoice is issued.
CREATE TABLE invoice_counters (
  year INTEGER PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
  id             TEXT PRIMARY KEY,
  number         TEXT UNIQUE,                 -- null while a draft
  project_id     TEXT NOT NULL,
  period         TEXT,                        -- 'YYYY-MM' for subscription invoices, null for manual ones
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','sent','paid','void')),
  issue_date     TEXT,
  due_date       TEXT,
  currency       TEXT NOT NULL DEFAULT 'EUR',
  customer       TEXT NOT NULL DEFAULT '{}',  -- snapshot (JSON)
  seller         TEXT NOT NULL DEFAULT '{}',  -- snapshot at issue (JSON)
  lines          TEXT NOT NULL DEFAULT '[]',  -- [{description, qty, unit_cents}]
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  vat_percent    REAL NOT NULL DEFAULT 0,
  vat_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  vat_note       TEXT,
  reference      TEXT,
  notes          TEXT,
  token          TEXT NOT NULL UNIQUE,        -- unguessable key of the customer's invoice link
  auto           INTEGER NOT NULL DEFAULT 0,
  sent_at        TEXT,
  sent_to        TEXT,
  send_error     TEXT,
  paid_at        TEXT,
  voided_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- A project is billed once per period (a voided invoice frees the period again).
CREATE UNIQUE INDEX idx_invoices_period ON invoices(project_id, period) WHERE period IS NOT NULL AND status <> 'void';
CREATE INDEX idx_invoices_status ON invoices(status);
