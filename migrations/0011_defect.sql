-- Defect equipment: marked at a scan or in the warehouse, cleared when repaired.
ALTER TABLE assets ADD COLUMN defect INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN defect_note TEXT;
ALTER TABLE assets ADD COLUMN defect_at TEXT;
