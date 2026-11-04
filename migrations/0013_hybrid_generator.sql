-- Hybrid generator: a generator with a battery. Both the battery level and the fuel level are tracked.
-- Battery is asked before fuel (fuel level is always the last question).
INSERT OR IGNORE INTO asset_types (id, name, fields) VALUES (
  'hybrid-generator',
  'Hybrid generator',
  '[
    {"key":"kva","label":"Rating","type":"select","scope":"asset","required":true,"options":["30 kVA","350 kVA"]},
    {"key":"manufacturer","label":"Manufacturer","type":"text","scope":"asset"},
    {"key":"battery_kwh","label":"Battery capacity","type":"number","scope":"asset","min":1,"max":5000,"unit":"kWh"},
    {"key":"inspection_due","label":"Lifting points inspection due","type":"date","scope":"asset","required":true,"dueWarnDays":30},
    {"key":"alarms","label":"Active alarms","type":"multiselect","scope":"check","options":["Low fuel","Low battery","Battery fault","High temperature","Low oil pressure","Overload","Emergency stop","Other"],"alert":{"any":true}},
    {"key":"fuel_cube","label":"Fuel cube connected","type":"boolean","scope":"check","required":true,"sovValue":false,"pairWith":"fuel-cube"},
    {"key":"battery_level","label":"Battery level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":20,"unit":"%","alert":{"atMost":20}},
    {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":25,"unit":"%","alert":{"atMost":25}}
  ]'
);

-- Projects that already have their own copy of the types get the new type too.
INSERT OR IGNORE INTO asset_types (id, name, fields, active, project_id)
SELECT lower(p.slug) || '-hybrid-generator', t.name,
       replace(t.fields, '"pairWith":"fuel-cube"', '"pairWith":"' || lower(p.slug) || '-fuel-cube"'), 1, p.id
FROM projects p, asset_types t
WHERE t.id = 'hybrid-generator'
  AND EXISTS (SELECT 1 FROM asset_types o WHERE o.project_id = p.id);
