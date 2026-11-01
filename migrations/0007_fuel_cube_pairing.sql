-- Fuel cubes are tracked equipment, linked to the generator they feed.
-- A reading records which unit it was connected to at that moment.
ALTER TABLE readings ADD COLUMN linked_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO asset_types (id, name, fields) VALUES (
  'fuel-cube',
  'Fuel cube',
  '[
    {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":25,"unit":"%","alert":{"atMost":25}}
  ]'
);

-- Answering "Fuel cube connected: Yes" on a generator asks to scan the fuel cube.
UPDATE asset_types
SET fields = (
  SELECT json_group_array(
    CASE WHEN json_extract(f.value, '$.key') = 'fuel_cube'
      THEN json_set(f.value, '$.pairWith', 'fuel-cube')
      ELSE json(f.value) END)
  FROM json_each(asset_types.fields) AS f
)
WHERE id = 'generator';
