-- Fuel level is read off the gauge in quarters: 0 / 25 / 50 / 75 / 100 %.
-- Alert at 25 % or less. Running hours stays optional.
UPDATE asset_types SET fields = '[
    {"key":"kva","label":"Rating","type":"select","scope":"asset","required":true,"options":["30 kVA","350 kVA"]},
    {"key":"manufacturer","label":"Manufacturer","type":"text","scope":"asset"},
    {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":25,"unit":"%","alert":{"atMost":25}},
    {"key":"fuel_cube","label":"Fuel cube connected","type":"boolean","scope":"check","required":true},
    {"key":"running_hours","label":"Running hours","type":"number","scope":"check","required":false,"min":0,"unit":"h"},
    {"key":"alarms","label":"Active alarms","type":"multiselect","scope":"check","options":["Low fuel","High temperature","Low oil pressure","Battery fault","Overload","Emergency stop","Other"],"alert":{"any":true}}
  ]'
WHERE id = 'generator';
