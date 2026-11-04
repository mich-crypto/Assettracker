-- A hybrid setup is three units that travel together on a turbine: the generator, a battery pack and a
-- fuel cube. On the vessel they are separate items. A reading can now be linked to several units.
ALTER TABLE readings ADD COLUMN linked_asset_ids TEXT;   -- JSON array of the units it was connected to
UPDATE readings SET linked_asset_ids = json_array(linked_asset_id) WHERE linked_asset_id IS NOT NULL;

INSERT OR IGNORE INTO asset_types (id, name, fields) VALUES (
  'battery-pack',
  'Battery pack',
  '[{"key":"capacity","label":"Capacity","type":"number","scope":"asset","min":1,"max":5000,"unit":"kWh"},{"key":"manufacturer","label":"Manufacturer","type":"text","scope":"asset"},{"key":"inspection_due","label":"Lifting points inspection due","type":"date","scope":"asset","required":true,"dueWarnDays":30},{"key":"battery_level","label":"Battery level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":20,"unit":"%","alert":{"atMost":20}}]'
);

-- The hybrid generator no longer has a battery of its own: the battery pack is scanned and linked.
UPDATE asset_types SET fields = '[{"key":"kva","label":"Rating","type":"select","scope":"asset","required":true,"options":["30 kVA","350 kVA"]},{"key":"manufacturer","label":"Manufacturer","type":"text","scope":"asset"},{"key":"inspection_due","label":"Lifting points inspection due","type":"date","scope":"asset","required":true,"dueWarnDays":30},{"key":"alarms","label":"Active alarms","type":"multiselect","scope":"check","options":["Low fuel","Low battery","Battery fault","High temperature","Low oil pressure","Overload","Emergency stop","Other"],"alert":{"any":true}},{"key":"fuel_cube","label":"Fuel cube connected","type":"boolean","scope":"check","required":true,"sovValue":false,"pairWith":"fuel-cube"},{"key":"battery_pack","label":"Battery pack connected","type":"boolean","scope":"check","required":true,"sovValue":false,"pairWith":"battery-pack"},{"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":25,"unit":"%","alert":{"atMost":25}}]'
WHERE id = 'hybrid-generator';

-- Projects with their own copy of the types get the same.
INSERT OR IGNORE INTO asset_types (id, name, fields, active, project_id)
SELECT lower(p.slug) || '-battery-pack', t.name, t.fields, 1, p.id
FROM projects p, asset_types t
WHERE t.id = 'battery-pack' AND EXISTS (SELECT 1 FROM asset_types o WHERE o.project_id = p.id);

UPDATE asset_types
SET fields = replace(replace((SELECT fields FROM asset_types WHERE id = 'hybrid-generator'),
    '"pairWith":"fuel-cube"', '"pairWith":"' || substr(id, 1, length(id) - 16) || 'fuel-cube"'),
    '"pairWith":"battery-pack"', '"pairWith":"' || substr(id, 1, length(id) - 16) || 'battery-pack"')
WHERE project_id IS NOT NULL AND id LIKE '%-hybrid-generator';
