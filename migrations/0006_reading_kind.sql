-- 'check': a scan with fuel level etc. 'move': location assigned by hand (e.g. by
-- the site manager from the overview) without new check values.
ALTER TABLE readings ADD COLUMN kind TEXT NOT NULL DEFAULT 'check';
