-- Asset tracking schema.
--
-- Extensibility: equipment-specific data is NOT modelled as columns. Each
-- asset_type carries a JSON list of field definitions (see public/js/fields.js):
--   scope "asset" -> static attributes set when the tag is linked (e.g. kVA rating)
--   scope "check" -> values captured on every scan (e.g. fuel level, alarms)
-- Adding a new kind of equipment, or a new field, is a data change only.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'supervisor', 'technician')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE asset_types (
  id         TEXT PRIMARY KEY,            -- slug, e.g. 'generator'
  name       TEXT NOT NULL,
  fields     TEXT NOT NULL DEFAULT '[]',  -- JSON array of field definitions
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- WTG positions are fixed; an SOV moves, so its lat/lon is optional and only
-- informative (readings taken on board carry their own GPS fix).
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('WTG', 'SOV')),
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  lat        REAL,
  lon        REAL,
  radius_m   REAL NOT NULL DEFAULT 300,  -- how close a GPS fix must be to count as "at" this WTG
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  type_id    TEXT NOT NULL REFERENCES asset_types(id),
  serial     TEXT NOT NULL,
  name       TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',  -- JSON, values for the type's "asset" fields
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (type_id, serial)
);

-- One asset can carry several identifiers (a QR label and an NFC tag).
CREATE TABLE tags (
  code       TEXT PRIMARY KEY COLLATE NOCASE,
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('qr', 'nfc')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tags_asset ON tags(asset_id);

-- A reading is one scan in the field. The id is generated on the phone so an
-- offline reading synced twice is stored once.
CREATE TABLE readings (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  recorded_at     TEXT NOT NULL,          -- device time of the scan
  received_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id         TEXT REFERENCES users(id),
  location_id     TEXT REFERENCES locations(id),
  location_source TEXT NOT NULL CHECK (location_source IN ('gps', 'manual')),
  gps_status      TEXT NOT NULL CHECK (gps_status IN ('ok', 'poor_accuracy', 'no_fix', 'implausible', 'unavailable')),
  lat             REAL,
  lon             REAL,
  accuracy_m      REAL,
  distance_m      REAL,                   -- distance from GPS fix to the chosen WTG
  data            TEXT NOT NULL DEFAULT '{}',  -- JSON, values for the type's "check" fields
  notes           TEXT,
  tag_code        TEXT,
  device_id       TEXT
);
CREATE INDEX readings_asset_time ON readings(asset_id, recorded_at DESC);
CREATE INDEX readings_location ON readings(location_id);

INSERT INTO asset_types (id, name, fields) VALUES (
  'generator',
  'Generator',
  '[
    {"key":"kva","label":"Rating","type":"select","scope":"asset","required":true,"options":["30 kVA","350 kVA"]},
    {"key":"manufacturer","label":"Manufacturer","type":"text","scope":"asset"},
    {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"unit":"%","alert":{"below":25}},
    {"key":"fuel_cube","label":"Fuel cube connected","type":"boolean","scope":"check","required":true},
    {"key":"running_hours","label":"Running hours","type":"number","scope":"check","min":0,"unit":"h"},
    {"key":"alarms","label":"Active alarms","type":"multiselect","scope":"check","options":["Low fuel","High temperature","Low oil pressure","Battery fault","Overload","Emergency stop","Other"],"alert":{"any":true}}
  ]'
);
