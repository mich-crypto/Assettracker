-- Projects: every wind farm project has its own link (/BLP, /HD ...) and sees only
-- its own locations and equipment. Equipment types stay shared.
--
-- Existing data moves into a project called DEMO, which can be deleted from the
-- admin page once real projects exist.

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- the link: /<slug>
  name          TEXT NOT NULL,
  client        TEXT,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  -- 'test': the phone's GPS only suggests a location, and "here" (anywhere) is allowed.
  -- 'live': outside the wind farm area the location must be chosen by hand.
  geo_mode      TEXT NOT NULL DEFAULT 'test' CHECK (geo_mode IN ('test', 'live')),
  gps_radius_m  REAL NOT NULL DEFAULT 300,             -- a phone this close to a WTG is "at" it
  farm_radius_km REAL NOT NULL DEFAULT 20,             -- beyond this from every WTG = outside the farm
  nfc_enabled   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO projects (id, slug, name, client) VALUES ('proj-demo', 'DEMO', 'Demo project', 'Demo');

ALTER TABLE assets ADD COLUMN project_id TEXT NOT NULL DEFAULT 'proj-demo';
CREATE INDEX assets_project ON assets(project_id);

-- Location names were unique across the whole database; they must only be unique
-- within a project (two farms can both have a "WTG A01").
CREATE TABLE locations_new (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'proj-demo',
  kind       TEXT NOT NULL CHECK (kind IN ('WTG', 'SOV')),
  name       TEXT NOT NULL COLLATE NOCASE,
  lat        REAL,
  lon        REAL,
  radius_m   REAL NOT NULL DEFAULT 300,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, name)
);
INSERT INTO locations_new (id, project_id, kind, name, lat, lon, radius_m, notes, active, created_at)
  SELECT id, 'proj-demo', kind, name, lat, lon, radius_m, notes, active, created_at FROM locations;

-- readings point at locations with a foreign key, so they are detached while the
-- old table is dropped (D1 does not allow deferring the check), then re-attached.
ALTER TABLE readings ADD COLUMN location_id_keep TEXT;
UPDATE readings SET location_id_keep = location_id, location_id = NULL;
DROP TABLE locations;
ALTER TABLE locations_new RENAME TO locations;
UPDATE readings SET location_id = location_id_keep;
ALTER TABLE readings DROP COLUMN location_id_keep;
CREATE INDEX locations_project ON locations(project_id);

-- Things for the warehouse supervisor to look into (a fuel cube reported missing,
-- a label that does not match its equipment ...), raised from the field app.
CREATE TABLE issues (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  type             TEXT NOT NULL,   -- cube_missing | cube_conflict | label_mismatch | unknown_tag
  asset_id         TEXT REFERENCES assets(id) ON DELETE CASCADE,
  related_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  tag_code         TEXT,
  location_id      TEXT,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at       TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE INDEX issues_project_status ON issues(project_id, status);

-- No personal names are recorded on readings.
UPDATE readings SET recorded_by = NULL, device_id = NULL;
